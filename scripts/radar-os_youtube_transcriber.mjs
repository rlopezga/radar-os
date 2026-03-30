#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  ROOT_DIR,
  buildFrontmatter,
  ensureDir,
  extractYouTubeVideoId,
  formatTimestamp,
  isoDateString,
  normalizeSphere,
  parseCliArgs,
  readJsonResponse,
  requireArg,
  slugify,
  writeTextFile
} from "./lib/common.mjs";

const execFileAsync = promisify(execFile);

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

async function commandExists(command) {
  try {
    await execFileAsync("sh", ["-lc", `command -v ${command}`]);
    return true;
  } catch {
    return false;
  }
}

async function transcribeViaOpenAiAudio({ videoUrl, tempDir }) {
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  const model = String(process.env.OPENAI_TRANSCRIBE_MODEL || "").trim();

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for ASR fallback.");
  }

  if (!model) {
    throw new Error("OPENAI_TRANSCRIBE_MODEL is required for ASR fallback.");
  }

  const hasYtDlp = await commandExists("yt-dlp");
  if (!hasYtDlp) {
    throw new Error("yt-dlp is not installed, so ASR fallback is not available.");
  }

  await ensureDir(tempDir);
  const outputTemplate = path.join(tempDir, "audio.%(ext)s");

  await execFileAsync("yt-dlp", ["-f", "bestaudio", "--no-playlist", "-o", outputTemplate, videoUrl]);
  const tempFiles = await fs.readdir(tempDir);
  const audioFileName = tempFiles.find((fileName) => fileName.startsWith("audio."));

  if (!audioFileName) {
    throw new Error("yt-dlp did not produce an audio file.");
  }

  const audioPath = path.join(tempDir, audioFileName);
  const fileBlob = await fs.openAsBlob(audioPath);
  const formData = new FormData();
  formData.set("model", model);
  formData.set("file", fileBlob, audioFileName);
  formData.set("response_format", "verbose_json");

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`
    },
    body: formData
  });

  const payload = await readJsonResponse(response);

  if (!response.ok) {
    throw new Error(payload?.error?.message || payload?.message || `ASR request failed with HTTP ${response.status}`);
  }

  const segments = Array.isArray(payload?.segments) ? payload.segments : [];

  if (segments.length) {
    return segments.map((segment) => ({
      startSeconds: Math.round(Number(segment.start) || 0),
      text: String(segment.text || "").replace(/\s+/g, " ").trim()
    })).filter((segment) => segment.text);
  }

  const text = String(payload?.text || "").trim();
  return text ? [{ startSeconds: 0, text }] : [];
}

export async function runYoutubeTranscriber(cliArgs = process.argv.slice(2)) {
  const args = parseCliArgs(cliArgs);
  const url = requireArg(args, "url", "Usage: --url <youtube-url>");
  const sphere = normalizeSphere(args.sphere, "personal");
  const language = String(args.lang || "en").trim().toLowerCase();
  const capturedAt = new Date().toISOString();
  const videoId = extractYouTubeVideoId(url);
  const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const html = await fetchYouTubeWatchPage(canonicalUrl);
  const playerResponse = extractPlayerResponse(html);
  const oembed = await fetchOEmbedMetadata(canonicalUrl);
  const videoDetails = playerResponse?.videoDetails || {};
  const captionTracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];

  let transcriptMethod = "captions";
  let chosenTrack = chooseCaptionTrack(captionTracks, language);
  let transcriptEntries = [];

  if (chosenTrack) {
    const captionJson = await fetchCaptionsFromTrack(chosenTrack);
    transcriptEntries = normalizeCaptionEvents(captionJson);
  }

  if (!transcriptEntries.length) {
    transcriptMethod = "asr";
    const tempDir = path.join(ROOT_DIR, ".tmp", `yt-${videoId}`);
    transcriptEntries = await transcribeViaOpenAiAudio({
      videoUrl: canonicalUrl,
      tempDir
    });
  }

  if (!transcriptEntries.length) {
    throw new Error("No transcript content could be extracted from the video.");
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

  return {
    outputPath,
    title,
    videoId,
    sphere,
    transcriptMethod,
    transcriptLanguage: chosenTrack?.languageCode || language,
    entryCount: transcriptEntries.length
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
