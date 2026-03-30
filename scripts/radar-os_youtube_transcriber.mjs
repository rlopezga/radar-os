#!/usr/bin/env node

import path from "node:path";
import {
  ROOT_DIR,
  buildFrontmatter,
  extractYouTubeVideoId,
  formatTimestamp,
  isoDateString,
  normalizeBoolean,
  normalizeSphere,
  parseCliArgs,
  readJsonResponse,
  requireArg,
  slugify,
  writeTextFile
} from "./lib/common.mjs";
import { runTranscriptPostprocess } from "./lib/radar-os_postprocess.mjs";

async function fetchYouTubeWatchPage(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "accept-language": "en-US,en;q=0.9"
    }
  });

  if (!response.ok) {
    throw new Error(`Could not load YouTube watch page: HTTP ${response.status}`);
  }

  return response.text();
}

function extractPlayerResponse(html) {
  const patterns = [
    /ytInitialPlayerResponse\s*=\s*(\{.+?\})\s*;/s,
    /var\s+ytInitialPlayerResponse\s*=\s*(\{.+?\})\s*;/s
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match) {
      continue;
    }

    try {
      return JSON.parse(match[1]);
    } catch {
      continue;
    }
  }

  return null;
}

async function fetchOEmbedMetadata(videoUrl) {
  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(videoUrl)}&format=json`;
  const response = await fetch(oembedUrl);

  if (!response.ok) {
    return {};
  }

  return readJsonResponse(response);
}

function chooseCaptionTrack(captionTracks = [], preferredLanguage = "en") {
  const preferred = preferredLanguage.toLowerCase();
  const normalizedTracks = captionTracks.filter(Boolean);

  return normalizedTracks.find((track) => track.languageCode === preferred)
    || normalizedTracks.find((track) => track.languageCode?.startsWith(`${preferred}-`))
    || normalizedTracks.find((track) => track.kind === "asr" && track.languageCode === preferred)
    || normalizedTracks.find((track) => track.kind !== "asr")
    || normalizedTracks[0]
    || null;
}

async function fetchCaptionsFromTrack(track) {
  const captionUrl = new URL(track.baseUrl);
  captionUrl.searchParams.set("fmt", "json3");
  const response = await fetch(captionUrl);

  if (!response.ok) {
    throw new Error(`Could not fetch captions: HTTP ${response.status}`);
  }

  return readJsonResponse(response);
}

function normalizeCaptionEvents(captionJson) {
  const events = Array.isArray(captionJson?.events) ? captionJson.events : [];

  return events
    .map((event) => {
      const segments = Array.isArray(event?.segs) ? event.segs : [];
      const text = segments.map((segment) => segment?.utf8 || "").join("").replace(/\s+/g, " ").trim();

      if (!text) {
        return null;
      }

      return {
        startSeconds: Math.round((Number(event.tStartMs) || 0) / 1000),
        text
      };
    })
    .filter(Boolean);
}

function renderTranscriptBody(captionEvents) {
  return captionEvents.map((entry) => `[${formatTimestamp(entry.startSeconds)}] ${entry.text}`).join("\n\n");
}

export async function runYoutubeTranscriber(cliArgs = process.argv.slice(2)) {
  const args = parseCliArgs(cliArgs);
  const url = requireArg(args, "url", "Usage: --url <youtube-url>");
  const sphere = normalizeSphere(args.sphere, "personal");
  const language = String(args.lang || "en").trim().toLowerCase();
  const focus = String(args.focus || "").trim();
  const autoSummary = !normalizeBoolean(args["skip-summary"], false);
  const autoIngestProposal = !normalizeBoolean(args["skip-atenea-proposal"], false);
  const capturedAt = new Date().toISOString();
  const videoId = extractYouTubeVideoId(url);
  const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const html = await fetchYouTubeWatchPage(canonicalUrl);
  const playerResponse = extractPlayerResponse(html);
  const oembed = await fetchOEmbedMetadata(canonicalUrl);
  const videoDetails = playerResponse?.videoDetails || {};
  const captionTracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];

  const transcriptMethod = "captions";
  let chosenTrack = chooseCaptionTrack(captionTracks, language);
  let transcriptEntries = [];

  if (chosenTrack) {
    const captionJson = await fetchCaptionsFromTrack(chosenTrack);
    transcriptEntries = normalizeCaptionEvents(captionJson);
  }

  if (!transcriptEntries.length) {
    throw new Error("No captions were available for this video. Use radar-os_whisperkit_transcriber for local transcription with large-v3-turbo.");
  }

  const title = String(videoDetails?.title || oembed?.title || `youtube-${videoId}`).trim();
  const channel = String(videoDetails?.author || oembed?.author_name || "").trim();
  const transcriptSlug = `${isoDateString()}-${videoId}-${slugify(title, "video")}`;
  const outputPath = path.join(ROOT_DIR, "transcripts", `${transcriptSlug}.md`);
  const markdown = `${buildFrontmatter({
    source_type: "youtube",
    source_url: canonicalUrl,
    video_id: videoId,
    title,
    channel,
    sphere,
    transcript_method: transcriptMethod,
    transcript_language: chosenTrack?.languageCode || language,
    requires_validation: "true",
    captured_at: capturedAt,
    origin_repo: "radar-os"
  })}
# ${title}

## Source

- URL: ${canonicalUrl}
- Channel: ${channel || "Unknown"}
- Sphere: ${sphere}
- Transcript method: ${transcriptMethod}
- Transcript language: ${chosenTrack?.languageCode || language}
- Requires validation: true

## Transcript

${renderTranscriptBody(transcriptEntries)}
`;

  await writeTextFile(outputPath, markdown);
  const postprocess = await runTranscriptPostprocess({
    transcriptPath: outputPath,
    sphere,
    focus,
    autoSummary,
    autoIngestProposal
  });

  return {
    outputPath,
    title,
    videoId,
    sphere,
    transcriptMethod,
    transcriptLanguage: chosenTrack?.languageCode || language,
    entryCount: transcriptEntries.length,
    postprocess
  };
}

const executedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (executedDirectly) {
  runYoutubeTranscriber()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
