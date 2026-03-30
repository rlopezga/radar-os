#!/usr/bin/env node

import { parseCliArgs, requireArg } from "./lib/common.mjs";
import { runWhisperKitTranscriber } from "./radar-os_whisperkit_transcriber.mjs";
import { runYoutubeTranscriber } from "./radar-os_youtube_transcriber.mjs";

async function runPipeline(cliArgs = process.argv.slice(2)) {
  const args = parseCliArgs(cliArgs);
  const url = requireArg(args, "url", "Usage: --url <youtube-url> [--sphere personal|work] [--focus text]");
  const sphere = args.sphere || "personal";
  const lang = args.lang || "en";
  const focus = args.focus || "";
  const transcriber = String(args.transcriber || "whisperkit").trim().toLowerCase();

  const transcriptResult = transcriber === "youtube"
    ? await runYoutubeTranscriber([
        "--url",
        url,
        "--sphere",
        sphere,
        "--lang",
        lang,
        ...(focus ? ["--focus", focus] : [])
      ])
    : await runWhisperKitTranscriber([
        "--url",
        url,
        "--sphere",
        sphere,
        "--lang",
        lang,
        ...(focus ? ["--focus", focus] : [])
      ]);

  return {
    transcriber,
    transcript: transcriptResult.outputPath,
    summary: transcriptResult.postprocess?.summary?.outputPath || null,
    radarDb: transcriptResult.postprocess?.radarDb?.databasePath || null,
    ateneaProposal: transcriptResult.postprocess?.ateneaProposal || null
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
