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
  requireArg,
  slugify,
  writeTextFile
} from "./lib/common.mjs";

const execFileAsync = promisify(execFile);
const DEFAULT_WHISPERKIT_MODEL = "large-v3-turbo";
const WHISPERKIT_TURBO_MODEL_ID = "whisper-large-v3-v20240930_turbo_632MB";

function resolveWhisperKitModel(value) {
  const requestedModel = String(value || DEFAULT_WHISPERKIT_MODEL).trim();

  if (!requestedModel || requestedModel === DEFAULT_WHISPERKIT_MODEL) {
    return {
      requestedModel: DEFAULT_WHISPERKIT_MODEL,
      resolvedModel: WHISPERKIT_TURBO_MODEL_ID
    };
  }

  return {
    requestedModel,
    resolvedModel: requestedModel
  };
}

function cleanTranscriptText(text) {
  return String(text || "")
    .replace(/<\|[^>]+\|>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseSrtTimestamp(value) {
  const match = String(value || "").trim().match(/(\d+):(\d+):(\d+),(\d+)/);

  if (!match) {
    return 0;
  }

  const [, hours, minutes, seconds, millis] = match;
  return (
    (Number(hours) * 3600) +
    (Number(minutes) * 60) +
    Number(seconds) +
    (Number(millis) / 1000)
  );
}

function parseSrtEntries(srtContent) {
  return String(srtContent || "")
    .trim()
    .split(/\n\s*\n/g)
    .map((block) => {
      const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);

      if (lines.length < 3) {
        return null;
      }

      const timeLine = lines[1];
      const timeMatch = timeLine.match(/(.+?)\s+-->\s+(.+)/);

      if (!timeMatch) {
        return null;
      }

      const text = cleanTranscriptText(lines.slice(2).join(" "));

      if (!text) {
        return null;
      }

      return {
        startSeconds: parseSrtTimestamp(timeMatch[1]),
        endSeconds: parseSrtTimestamp(timeMatch[2]),
        text
      };
    })
    .filter(Boolean);
}

function renderTranscriptBody(entries) {
  return entries
    .map((entry) => `[${formatTimestamp(entry.startSeconds)}] ${entry.text}`)
    .join("\n\n");
}

async function fetchYouTubeMetadata(url) {
  const { stdout } = await execFileAsync("yt-dlp", [
    "--dump-single-json",
    "--no-playlist",
    url
  ], {
    maxBuffer: 20 * 1024 * 1024
  });

  return JSON.parse(stdout);
}

async function downloadAudio(url, outputTemplate) {
  await execFileAsync("yt-dlp", [
    "-f",
    "bestaudio/best",
    "--no-playlist",
    "--extract-audio",
    "--audio-format",
    "m4a",
    "--output",
    outputTemplate,
    url
  ], {
    maxBuffer: 20 * 1024 * 1024
  });
}

async function findDownloadedAudio(tempDir) {
  const files = await fs.readdir(tempDir);
  const audioFile = files.find((fileName) => /\.(m4a|mp3|wav|mp4|webm)$/i.test(fileName));

  if (!audioFile) {
    throw new Error("No downloaded audio file was found after yt-dlp finished.");
  }

  return path.join(tempDir, audioFile);
}

async function transcribeAudioWithWhisperKit({ audioPath, reportPath, model, language }) {
  const commandArgs = [
    "transcribe",
    "--audio-path",
    audioPath,
    "--model",
    model,
    "--report",
    "--report-path",
    reportPath
  ];

  if (language && language !== "auto") {
    commandArgs.push("--language", language);
  }

  await execFileAsync("whisperkit-cli", commandArgs, {
    maxBuffer: 20 * 1024 * 1024
  });
}

async function locateTranscriptArtifacts(reportPath) {
  const files = await fs.readdir(reportPath);
  const srtFile = files.find((fileName) => fileName.endsWith(".srt"));
  const jsonFile = files.find((fileName) => fileName.endsWith(".json"));

  if (!srtFile && !jsonFile) {
    throw new Error("WhisperKit did not generate transcript artifacts.");
  }

  return {
    srtPath: srtFile ? path.join(reportPath, srtFile) : null,
    jsonPath: jsonFile ? path.join(reportPath, jsonFile) : null
  };
}

async function extractTranscriptEntries({ srtPath, jsonPath }) {
  if (srtPath) {
    const srtContent = await fs.readFile(srtPath, "utf8");
    const srtEntries = parseSrtEntries(srtContent);

    if (srtEntries.length) {
      return srtEntries;
    }
  }

  if (jsonPath) {
    const payload = JSON.parse(await fs.readFile(jsonPath, "utf8"));
    const text = cleanTranscriptText(payload?.text || "");

    if (text) {
      return [{ startSeconds: 0, endSeconds: 0, text }];
    }
  }

  throw new Error("WhisperKit transcript artifacts were empty.");
}

export async function runWhisperKitTranscriber(cliArgs = process.argv.slice(2)) {
  const args = parseCliArgs(cliArgs);
  const url = requireArg(args, "url", `Usage: --url <youtube-url> [--sphere personal|work] [--lang auto|en|es] [--model ${DEFAULT_WHISPERKIT_MODEL}]`);
  const sphere = normalizeSphere(args.sphere, "personal");
  const language = String(args.lang || "auto").trim().toLowerCase();
  const { requestedModel, resolvedModel } = resolveWhisperKitModel(args.model || DEFAULT_WHISPERKIT_MODEL);
  const videoId = extractYouTubeVideoId(url);
  const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const tempDir = path.join(ROOT_DIR, ".tmp", `whisperkit-${videoId}`);
  const reportPath = path.join(tempDir, "report");
  const outputTemplate = path.join(tempDir, "%(title)s.%(ext)s");

  await ensureDir(tempDir);
  await ensureDir(reportPath);

  const metadata = await fetchYouTubeMetadata(canonicalUrl);
  await downloadAudio(canonicalUrl, outputTemplate);
  const audioPath = await findDownloadedAudio(tempDir);
  await transcribeAudioWithWhisperKit({
    audioPath,
    reportPath,
    model: resolvedModel,
    language
  });

  const { srtPath, jsonPath } = await locateTranscriptArtifacts(reportPath);
  const transcriptEntries = await extractTranscriptEntries({ srtPath, jsonPath });
  const title = String(metadata?.title || `youtube-${videoId}`).trim();
  const channel = String(metadata?.uploader || metadata?.channel || "").trim();
  const transcriptSlug = `${isoDateString()}-${videoId}-${slugify(title, "video")}`;
  const outputPath = path.join(ROOT_DIR, "transcripts", `${transcriptSlug}.md`);
  const markdown = `${buildFrontmatter({
    source_type: "youtube",
    source_url: canonicalUrl,
    video_id: videoId,
    title,
    channel,
    sphere,
    transcript_method: "whisperkit_local",
    transcript_language: language,
    whisper_model: requestedModel,
    whisper_model_resolved: resolvedModel,
    requires_validation: "true",
    captured_at: new Date().toISOString(),
    origin_repo: "radar-os"
  })}
# ${title}

## Source

- URL: ${canonicalUrl}
- Channel: ${channel || "Unknown"}
- Sphere: ${sphere}
- Transcript method: whisperkit_local
- Transcript language: ${language}
- Whisper model: ${requestedModel}
- Whisper model resolved: ${resolvedModel}
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
    transcriptMethod: "whisperkit_local",
    transcriptLanguage: language,
    model: requestedModel,
    resolvedModel,
    entryCount: transcriptEntries.length
  };
}

const executedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (executedDirectly) {
  runWhisperKitTranscriber()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
