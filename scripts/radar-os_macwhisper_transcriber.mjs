#!/usr/bin/env node

import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import {
  ROOT_DIR,
  buildFrontmatter,
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
const MACWHISPER_APP = "/Applications/MacWhisper.app";
const MACWHISPER_DB = path.join(process.env.HOME || "", "Library/Application Support/MacWhisper/Database/main.sqlite");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toSqliteDateTime(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

async function runSqlite(query) {
  const { stdout } = await execFileAsync("sqlite3", [MACWHISPER_DB, query]);
  return stdout.trim();
}

async function ensureMacWhisperInstalled() {
  try {
    await execFileAsync("test", ["-d", MACWHISPER_APP]);
  } catch {
    throw new Error("MacWhisper.app is not installed in /Applications.");
  }
}

async function getLatestSessionForVideo(videoId) {
  const query = `
    SELECT
      hex(s.id),
      s.dateCreated,
      COALESCE(s.userChosenTitle, s.aiTitle, d.youtubeTitle, s.originalFilename, ''),
      COALESCE(s.detectedLanguage, ''),
      COALESCE(s.transcriptionDidSucceed, 0),
      COALESCE(s.fullText, ''),
      COALESCE(d.sourceURL, ''),
      COALESCE(d.youtubeTitle, ''),
      COALESCE(s.isFromYoutube, 0)
    FROM session s
    LEFT JOIN downloadmetadata d ON s.downloadMetadataID = d.id
    WHERE d.youtubeVideoID = '${videoId.replace(/'/g, "''")}'
    ORDER BY s.dateCreated DESC
    LIMIT 1;
  `;
  const output = await runSqlite(query);

  if (!output) {
    return null;
  }

  const [
    sessionId,
    dateCreated,
    title,
    detectedLanguage,
    transcriptionDidSucceed,
    fullText,
    sourceUrl,
    youtubeTitle,
    isFromYoutube
  ] = output.split("|");

  return {
    sessionId,
    dateCreated,
    title,
    detectedLanguage,
    transcriptionDidSucceed: transcriptionDidSucceed === "1",
    fullText,
    sourceUrl,
    youtubeTitle,
    isFromYoutube: isFromYoutube === "1"
  };
}

async function getTranscriptLines(sessionId) {
  const query = `
    SELECT start, text
    FROM transcriptline
    WHERE hex(sessionId) = '${sessionId.replace(/'/g, "''")}'
    ORDER BY start ASC;
  `;
  const output = await runSqlite(query);

  if (!output) {
    return [];
  }

  return output
    .split("\n")
    .map((line) => {
      const separatorIndex = line.indexOf("|");
      if (separatorIndex === -1) {
        return null;
      }

      const start = Number(line.slice(0, separatorIndex));
      const text = line.slice(separatorIndex + 1).trim();

      if (!text) {
        return null;
      }

      return {
        startSeconds: Math.max(0, Math.floor(start / 1000)),
        text
      };
    })
    .filter(Boolean);
}

function renderTranscriptBody(lines) {
  return lines.map((entry) => `[${formatTimestamp(entry.startSeconds)}] ${entry.text}`).join("\n\n");
}

async function submitUrlToMacWhisper(videoUrl) {
  const script = `
on run argv
  set targetUrl to item 1 of argv

  tell application "MacWhisper" to activate
  delay 1

  tell application "System Events"
    if UI elements enabled is false then
      error "Accessibility access is disabled for this process."
    end if

    tell process "MacWhisper"
      set frontmost to true

      repeat 30 times
        if exists window 1 then exit repeat
        delay 0.5
      end repeat

      if not (exists window 1) then
        error "MacWhisper window did not appear."
      end if

      try
        click first UI element of (entire contents of window 1 whose title is "Home")
        delay 0.5
      end try

      set urlField to missing value

      try
        repeat with candidateField in (text fields of entire contents of window 1)
          try
            set fieldDescription to description of candidateField
          on error
            set fieldDescription to ""
          end try

          try
            set fieldValue to value of candidateField as text
          on error
            set fieldValue to ""
          end try

          if fieldDescription contains "text field" then
            set urlField to candidateField
            if fieldValue contains "YouTube" or fieldValue contains "URL" then exit repeat
          end if
        end repeat
      end try

      if urlField is missing value then
        error "Could not find the URL field in MacWhisper."
      end if

      try
        set focused of urlField to true
      end try

      delay 0.2

      try
        set value of urlField to targetUrl
      on error
        set the clipboard to targetUrl
        keystroke "a" using command down
        delay 0.1
        keystroke "v" using command down
      end try

      delay 0.2
      key code 36
    end tell
  end tell
end run
`;

  try {
    await new Promise((resolve, reject) => {
      const child = spawn("osascript", ["-", videoUrl], {
        stdio: ["pipe", "pipe", "pipe"]
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.on("error", reject);

      child.on("close", (code) => {
        if (code === 0) {
          resolve();
          return;
        }

        const error = new Error(stderr || stdout || `osascript exited with code ${code}`);
        error.stderr = stderr;
        error.stdout = stdout;
        reject(error);
      });

      child.stdin.write(script);
      child.stdin.end();
    });
  } catch (error) {
    const stderr = String(error?.stderr || "").trim();
    const stdout = String(error?.stdout || "").trim();
    const details = stderr || stdout || error.message;

    if (details.includes("no tiene permitido el acceso de ayuda") || details.includes("Accessibility")) {
      throw new Error(
        "MacWhisper UI automation needs Accessibility access for Terminal/Codex. Grant it in System Settings > Privacy & Security > Accessibility and retry."
      );
    }

    throw new Error(`Could not submit the URL to MacWhisper: ${details}`);
  }
}

async function waitForCompletedSession({ videoId, startedAt, timeoutSeconds }) {
  const timeoutAt = Date.now() + (timeoutSeconds * 1000);

  while (Date.now() < timeoutAt) {
    const latest = await getLatestSessionForVideo(videoId);

    if (
      latest &&
      latest.isFromYoutube &&
      latest.dateCreated >= startedAt &&
      latest.transcriptionDidSucceed
    ) {
      const lines = await getTranscriptLines(latest.sessionId);

      if (lines.length || latest.fullText.trim()) {
        return {
          ...latest,
          lines
        };
      }
    }

    await sleep(3000);
  }

  throw new Error(`MacWhisper did not finish the transcription within ${timeoutSeconds} seconds.`);
}

export async function runMacWhisperTranscriber(cliArgs = process.argv.slice(2)) {
  const args = parseCliArgs(cliArgs);
  const url = requireArg(args, "url", "Usage: --url <youtube-url> [--sphere personal|work] [--timeout 600]");
  const sphere = normalizeSphere(args.sphere, "personal");
  const timeoutSeconds = Number(args.timeout || 600);
  const videoId = extractYouTubeVideoId(url);
  const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const startedAt = toSqliteDateTime(new Date());

  await ensureMacWhisperInstalled();
  await submitUrlToMacWhisper(canonicalUrl);

  const session = await waitForCompletedSession({
    videoId,
    startedAt,
    timeoutSeconds
  });

  const title = String(session.title || session.youtubeTitle || `youtube-${videoId}`).trim();
  const transcriptLines = session.lines.length
    ? session.lines
    : [{ startSeconds: 0, text: session.fullText.trim() }];
  const transcriptSlug = `${isoDateString()}-${videoId}-${slugify(title, "video")}`;
  const outputPath = path.join(ROOT_DIR, "transcripts", `${transcriptSlug}.md`);
  const markdown = `${buildFrontmatter({
    source_type: "youtube",
    source_url: canonicalUrl,
    video_id: videoId,
    title,
    channel: "",
    sphere,
    transcript_method: "macwhisper_ui",
    transcript_language: session.detectedLanguage || "",
    requires_validation: "true",
    captured_at: new Date().toISOString(),
    origin_repo: "radar-os",
    macwhisper_session_id: session.sessionId
  })}
# ${title}

## Source

- URL: ${canonicalUrl}
- Sphere: ${sphere}
- Transcript method: macwhisper_ui
- Transcript language: ${session.detectedLanguage || "unknown"}
- Requires validation: true

## Transcript

${renderTranscriptBody(transcriptLines)}
`;

  await writeTextFile(outputPath, markdown);

  return {
    outputPath,
    title,
    videoId,
    sphere,
    transcriptMethod: "macwhisper_ui",
    transcriptLanguage: session.detectedLanguage || "",
    macwhisperSessionId: session.sessionId,
    entryCount: transcriptLines.length
  };
}

const executedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (executedDirectly) {
  runMacWhisperTranscriber()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
