#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { createAteneaClient } from "../../atenea/packages/atenea-client/index.js";
import {
  parseCliArgs,
  readJsonResponse,
  requireArg
} from "./lib/common.mjs";

function parseFrontmatter(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n?/);

  if (!match) {
    return { frontmatter: {}, body: markdown.trim() };
  }

  const frontmatter = {};

  match[1].split("\n").forEach((line) => {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      return;
    }

    const key = line.slice(0, separatorIndex).trim();
    const rawValue = line.slice(separatorIndex + 1).trim();

    try {
      frontmatter[key] = JSON.parse(rawValue);
    } catch {
      frontmatter[key] = rawValue.replace(/^"|"$/g, "");
    }
  });

  return {
    frontmatter,
    body: markdown.slice(match[0].length).trim()
  };
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  return ["1", "true", "yes"].includes(String(value).trim().toLowerCase());
}

function buildTrace(inputPath, kind) {
  return {
    trigger: "radar_os_ingestor",
    ingest_kind: kind,
    file_path: inputPath
  };
}

async function ingestTranscript({ client, inputPath, frontmatter, body, autoProcess }) {
  return client.request("/api/import/transcript", {
    method: "POST",
    body: {
      title: frontmatter.title || path.basename(inputPath, path.extname(inputPath)),
      content: body,
      sphere: frontmatter.sphere || "personal",
      sensitivity: frontmatter.sensitivity || "internal",
      origin_repo: "radar-os",
      source_uri: frontmatter.source_url || null,
      external_id: frontmatter.video_id || null,
      source_meta: {
        file_path: path.relative(process.cwd(), inputPath),
        channel: frontmatter.channel || null,
        transcript_method: frontmatter.transcript_method || null,
        transcript_language: frontmatter.transcript_language || null
      },
      trace_json: buildTrace(inputPath, "transcript"),
      auto_process: autoProcess
    }
  });
}

async function ingestProposal({ client, inputPath, frontmatter, body, autoProcess }) {
  return client.request("/api/raw", {
    method: "POST",
    body: {
      title: frontmatter.title || path.basename(inputPath, path.extname(inputPath)),
      content: body,
      source_type: "markdown",
      content_type: "text/markdown",
      sphere: frontmatter.sphere || "personal",
      sensitivity: frontmatter.sensitivity || "internal",
      origin_repo: "radar-os",
      source_uri: frontmatter.source_url || null,
      external_id: frontmatter.video_id || null,
      source_meta: {
        file_path: path.relative(process.cwd(), inputPath),
        source_transcript: frontmatter.source_transcript || null,
        focus: frontmatter.focus || null
      },
      trace_json: buildTrace(inputPath, "proposal"),
      auto_process: autoProcess,
      classification: autoProcess
        ? {
            target: "review",
            review_type: "insight",
            reasoning: "Resumen interpretativo generado en radar-os. Requiere validacion humana antes de consolidarse.",
            priority: "normal",
            memory_type: "insight"
          }
        : undefined
    }
  });
}

export async function runAteneaIngestor(cliArgs = process.argv.slice(2)) {
  const args = parseCliArgs(cliArgs);
  const inputPath = path.resolve(requireArg(args, "input", "Usage: --input <file> [--kind transcript|proposal] [--auto-process true|false]"));
  const explicitKind = String(args.kind || "").trim().toLowerCase();
  const autoProcess = normalizeBoolean(args["auto-process"], explicitKind === "proposal");
  const markdown = await fs.readFile(inputPath, "utf8");
  const { frontmatter, body } = parseFrontmatter(markdown);
  const inferredKind = explicitKind || (String(frontmatter.source_type || "").trim() === "youtube" ? "transcript" : "proposal");
  const client = createAteneaClient();

  let result;

  if (inferredKind === "transcript") {
    result = await ingestTranscript({
      client,
      inputPath,
      frontmatter,
      body,
      autoProcess
    });
  } else if (inferredKind === "proposal") {
    result = await ingestProposal({
      client,
      inputPath,
      frontmatter,
      body,
      autoProcess
    });
  } else {
    throw new Error(`Invalid kind "${explicitKind}". Use transcript or proposal.`);
  }

  return {
    kind: inferredKind,
    inputPath,
    result
  };
}

const executedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (executedDirectly) {
  runAteneaIngestor()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
