#!/usr/bin/env node

import { parseCliArgs, requireArg } from "./lib/common.mjs";
import { runMacWhisperTranscriber } from "./radar-os_macwhisper_transcriber.mjs";
import { runWhisperKitTranscriber } from "./radar-os_whisperkit_transcriber.mjs";
import { runYoutubeTranscriber } from "./radar-os_youtube_transcriber.mjs";
import { runVideoSummarizer } from "./radar-os_video_summarizer.mjs";

async function runPipeline(cliArgs = process.argv.slice(2)) {
  const args = parseCliArgs(cliArgs);
  const url = requireArg(args, "url", "Usage: --url <youtube-url> [--sphere personal|work] [--focus text]");
  const sphere = args.sphere || "personal";
  const lang = args.lang || "en";
  const focus = args.focus || "";
  const transcriber = String(args.transcriber || "default").trim().toLowerCase();

  const transcriptResult = transcriber === "macwhisper"
    ? await runMacWhisperTranscriber([
        "--url",
        url,
        "--sphere",
        sphere
      ])
    : transcriber === "whisperkit"
      ? await runWhisperKitTranscriber([
          "--url",
          url,
          "--sphere",
          sphere,
          "--lang",
          lang
        ])
    : await runYoutubeTranscriber([
        "--url",
        url,
        "--sphere",
        sphere,
        "--lang",
        lang
      ]);

  const summaryResult = await runVideoSummarizer([
    "--input",
    transcriptResult.outputPath,
    "--sphere",
    sphere,
    ...(focus ? ["--focus", focus] : [])
  ]);

  return {
    transcriber,
    transcript: transcriptResult.outputPath,
    summary: summaryResult.outputPath
  };
}

const executedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (executedDirectly) {
  runPipeline()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
