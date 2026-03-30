#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import {
  ROOT_DIR,
  normalizeBoolean,
  normalizeSphere,
  parseCliArgs
} from "./lib/common.mjs";
import { runTranscriptPostprocess } from "./lib/radar-os_postprocess.mjs";

async function collectTranscriptPaths({ inputPath, all }) {
  if (inputPath) {
    return [path.resolve(inputPath)];
  }

  if (!all) {
    throw new Error("Usage: --all or --input <transcript-file>");
  }

  const transcriptsDir = path.join(ROOT_DIR, "transcripts");
  const entries = await fs.readdir(transcriptsDir);

  return entries
    .filter((entry) => entry.endsWith(".md") && entry !== "README.md")
    .map((entry) => path.join(transcriptsDir, entry))
    .sort();
}

export async function runTranscriptBackfill(cliArgs = process.argv.slice(2)) {
  const args = parseCliArgs(cliArgs);
  const inputPath = String(args.input || "").trim();
  const all = normalizeBoolean(args.all, !inputPath);
  const focus = String(args.focus || "").trim();
  const autoSummary = !normalizeBoolean(args["skip-summary"], false);
  const autoIngestProposal = !normalizeBoolean(args["skip-atenea-proposal"], false);
  const skipCompleted = !normalizeBoolean(args["include-completed"], false);
  const transcriptPaths = await collectTranscriptPaths({ inputPath, all });
  const results = [];

  for (const transcriptPath of transcriptPaths) {
    const inferredSphere = args.sphere ? normalizeSphere(args.sphere, "personal") : undefined;

    try {
      const result = await runTranscriptPostprocess({
        transcriptPath,
        sphere: inferredSphere,
        focus,
        autoSummary,
        autoIngestProposal,
        skipCompleted
      });

      results.push({
        transcriptPath,
        status: result.ateneaProposal?.status === "already_reported" ? "skipped_completed" : "processed",
        result
      });
    } catch (error) {
      results.push({
        transcriptPath,
        status: "failed",
        error: error.message
      });
    }
  }

  return {
    total: results.length,
    processed: results.filter((item) => item.status === "processed").length,
    skippedCompleted: results.filter((item) => item.status === "skipped_completed").length,
    failed: results.filter((item) => item.status === "failed").length,
    results
  };
}

const executedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (executedDirectly) {
  runTranscriptBackfill()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
