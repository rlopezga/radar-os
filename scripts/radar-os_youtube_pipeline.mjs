#!/usr/bin/env node

import { parseCliArgs, requireArg } from "./lib/common.mjs";
import { runYoutubeTranscriber } from "./radar-os_youtube_transcriber.mjs";
import { runVideoSummarizer } from "./radar-os_video_summarizer.mjs";

async function runPipeline(cliArgs = process.argv.slice(2)) {
  const args = parseCliArgs(cliArgs);
  const url = requireArg(args, "url", "Usage: --url <youtube-url> [--sphere personal|work] [--focus text]");
  const sphere = args.sphere || "personal";
  const lang = args.lang || "en";
  const focus = args.focus || "";

  const transcriptResult = await runYoutubeTranscriber([
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
