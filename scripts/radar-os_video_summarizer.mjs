#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { getPersonalRelevantContext } from "../../personal-os/integrations/atenea.mjs";
import { getWorkRelevantContext } from "../../work-os/integrations/atenea.mjs";
import {
  ROOT_DIR,
  buildFrontmatter,
  compactAteneaContext,
  getOutputTextFromResponsesApi,
  isoDateString,
  normalizeSphere,
  parseCliArgs,
  readJsonResponse,
  requireArg,
  slugify,
  writeTextFile
} from "./lib/common.mjs";

function parseFrontmatter(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n?/);

  if (!match) {
    return { frontmatter: {}, body: markdown.trim() };
  }

  const body = markdown.slice(match[0].length).trim();
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

  return { frontmatter, body };
}

async function getRelevantContextForSphere(sphere) {
  if (sphere === "personal") {
    return getPersonalRelevantContext();
  }

  if (sphere === "work") {
    return getWorkRelevantContext();
  }

  return {
    memory: [],
    goals: [],
    tasks: []
  };
}

async function requestSummaryFromOpenAi({ transcript, context, title, sourceUrl, focus, sphere }) {
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  const model = String(process.env.OPENAI_MODEL || "").trim();

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required to generate the summary.");
  }

  if (!model) {
    throw new Error("OPENAI_MODEL is required to generate the summary.");
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: [
                "Eres radar-os_video_summarizer.",
                "Trabajas dentro de radar-os, que es una capa de entrada y observacion, no memoria final.",
                "Separa con claridad hechos del video, interpretacion, relevancia para el usuario y propuestas.",
                "No inventes objetivos ni preferencias fuera del contexto suministrado desde Atenea.",
                "Si algo no esta claro, dilo como hipotesis o punto a validar."
              ].join(" ")
            }
          ]
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                `Video: ${title}`,
                `URL: ${sourceUrl || "unknown"}`,
                `Sphere: ${sphere}`,
                `Focus requested: ${focus || "general"}`,
                "",
                "Contexto relevante de Atenea:",
                JSON.stringify(context, null, 2),
                "",
                "Transcripcion:",
                transcript,
                "",
                "Devuelveme markdown con estas secciones exactas:",
                "## Resumen fiel",
                "## Ideas clave",
                "## Relevancia para mis objetivos",
                "## Propuestas accionables",
                "## Claims a validar",
                "",
                "En 'Relevancia para mis objetivos' conecta solo con objetivos o tareas realmente presentes en el contexto de Atenea.",
                "En 'Propuestas accionables' sugiere ideas concretas y prudentes."
              ].join("\n")
            }
          ]
        }
      ]
    })
  });

  const payload = await readJsonResponse(response);

  if (!response.ok) {
    throw new Error(payload?.error?.message || payload?.message || `Summary request failed with HTTP ${response.status}`);
  }

  const text = getOutputTextFromResponsesApi(payload);

  if (!text) {
    throw new Error("The model returned an empty summary.");
  }

  return text;
}

export async function runVideoSummarizer(cliArgs = process.argv.slice(2)) {
  const args = parseCliArgs(cliArgs);
  const inputPath = path.resolve(requireArg(args, "input", "Usage: --input <transcript-file>"));
  const focus = String(args.focus || "").trim();
  const markdown = await fs.readFile(inputPath, "utf8");
  const { frontmatter, body } = parseFrontmatter(markdown);
  const sphere = normalizeSphere(args.sphere || frontmatter.sphere, "personal");
  const title = String(frontmatter.title || path.basename(inputPath, path.extname(inputPath))).trim();
  const sourceUrl = String(frontmatter.source_url || "").trim();
  const videoId = String(frontmatter.video_id || "").trim();
  const context = compactAteneaContext(await getRelevantContextForSphere(sphere));
  const summaryMarkdown = await requestSummaryFromOpenAi({
    transcript: body,
    context,
    title,
    sourceUrl,
    focus,
    sphere
  });
  const outputName = `${isoDateString()}-${videoId || slugify(title, "video")}-summary.md`;
  const outputPath = path.join(ROOT_DIR, "proposals", outputName);
  const finalMarkdown = `${buildFrontmatter({
    source_type: "video_summary",
    source_transcript: path.relative(ROOT_DIR, inputPath),
    source_url: sourceUrl,
    video_id: videoId,
    title,
    sphere,
    focus: focus || "general",
    generated_at: new Date().toISOString(),
    origin_repo: "radar-os",
    requires_validation: "true"
  })}
# ${title}

${summaryMarkdown}
`;

  await writeTextFile(outputPath, finalMarkdown);

  return {
    outputPath,
    sphere,
    title
  };
}

const executedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (executedDirectly) {
  runVideoSummarizer()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
