#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getPersonalRelevantContext } from "../../personal-os/integrations/atenea.mjs";
import { getWorkRelevantContext } from "../../work-os/integrations/atenea.mjs";
import {
  ROOT_DIR,
  buildFrontmatter,
  compactAteneaContext,
  isoDateString,
  normalizeSphere,
  parseCliArgs,
  parseFrontmatter,
  requireArg,
  slugify,
  writeTextFile
} from "./lib/common.mjs";

const execFileAsync = promisify(execFile);
const DEFAULT_SUMMARY_MODEL = "radar-os-qwen3.5-summary";
const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "but", "by", "for", "from",
  "had", "has", "have", "he", "her", "his", "i", "if", "in", "into", "is", "it",
  "its", "of", "on", "or", "our", "she", "so", "that", "the", "their", "them",
  "they", "this", "to", "was", "we", "were", "what", "when", "which", "who", "will",
  "with", "you", "your", "y", "de", "la", "el", "los", "las", "un", "una", "unos",
  "unas", "que", "en", "para", "por", "con", "sin", "del", "al", "lo", "se", "su",
  "sus", "como", "mas", "más", "es", "son", "fue", "ser", "ha", "han", "o"
]);

function stripTerminalControl(text) {
  return String(text || "")
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\u001b\][^\u0007]*(\u0007|\u001b\\)/g, "")
    .replace(/\r/g, "")
    .replace(/[⠁-⣿]/g, "")
    .replace(/\s+\n/g, "\n")
    .trim();
}

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token && token.length > 2 && !STOPWORDS.has(token));
}

function parseTranscriptEntries(body) {
  return String(body || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^\[(.+?)\]\s+(.*)$/);

      if (!match) {
        return null;
      }

      return {
        timestamp: match[1],
        text: match[2].trim()
      };
    })
    .filter(Boolean);
}

function buildFrequencyMap(entries) {
  const frequency = new Map();

  entries.forEach((entry) => {
    tokenize(entry.text).forEach((token) => {
      frequency.set(token, (frequency.get(token) || 0) + 1);
    });
  });

  return frequency;
}

function uniqueTokensFromContext(context) {
  return tokenize(JSON.stringify(context || {}));
}

function scoreEntry(entry, frequencyMap, focusTokens, contextTokens) {
  const tokens = tokenize(entry.text);
  const uniqueTokens = new Set(tokens);
  const frequencyScore = tokens.reduce((total, token) => total + (frequencyMap.get(token) || 0), 0);
  const focusScore = [...uniqueTokens].filter((token) => focusTokens.has(token)).length * 10;
  const contextScore = [...uniqueTokens].filter((token) => contextTokens.has(token)).length * 4;
  const structureScore = /\b(should|must|need|important|key|better|build|create|use|avoid|recommend)\b/i.test(entry.text) ? 6 : 0;

  return frequencyScore + focusScore + contextScore + structureScore;
}

function pickTopEntries(entries, count, scorer) {
  const ranked = entries
    .map((entry, index) => ({
      entry,
      index,
      score: scorer(entry, index)
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index);

  const picked = [];
  const usedTokens = new Set();

  ranked.forEach(({ entry, score }) => {
    if (picked.length >= count || score <= 0) {
      return;
    }

    const tokens = new Set(tokenize(entry.text));
    const overlap = [...tokens].filter((token) => usedTokens.has(token)).length;

    if (picked.length && overlap > Math.max(5, Math.floor(tokens.size * 0.7))) {
      return;
    }

    picked.push(entry);
    tokens.forEach((token) => usedTokens.add(token));
  });

  if (picked.length < count) {
    entries.slice(0, count - picked.length).forEach((entry) => {
      if (!picked.includes(entry)) {
        picked.push(entry);
      }
    });
  }

  return picked.slice(0, count);
}

function summarizeNarrative(entries) {
  if (!entries.length) {
    return "No se pudieron extraer fragmentos suficientes del transcript.";
  }

  const ordered = [...entries].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  const snippets = ordered.slice(0, 4).map((entry) => `[${entry.timestamp}] ${entry.text}`);
  return `El video gira principalmente alrededor de estas ideas observables: ${snippets.join(" ")}`;
}

function formatBulletEntries(entries) {
  if (!entries.length) {
    return "- Pendiente de revisión manual.";
  }

  return entries.map((entry) => `- [${entry.timestamp}] ${entry.text}`).join("\n");
}

function buildRelevanceSection({ entries, context, focus }) {
  const goals = Array.isArray(context?.goals) ? context.goals : [];
  const tasks = Array.isArray(context?.tasks) ? context.tasks : [];
  const focusTokens = new Set(tokenize(focus));
  const contextItems = [...goals, ...tasks]
    .map((item) => ({
      title: item.title,
      description: item.description || "",
      sphere: item.sphere || ""
    }))
    .filter((item) => item.title);

  const matches = contextItems
    .map((item) => {
      const itemTokens = new Set(tokenize(`${item.title} ${item.description}`));
      const score = entries.reduce((total, entry) => {
        const entryTokens = new Set(tokenize(entry.text));
        const overlap = [...itemTokens].filter((token) => entryTokens.has(token)).length;
        const focusBoost = [...focusTokens].filter((token) => entryTokens.has(token) && itemTokens.has(token)).length;
        return total + overlap + (focusBoost * 2);
      }, 0);

      return {
        ...item,
        score
      };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 4);

  if (!matches.length) {
    return "- No encontre una conexión suficientemente clara con objetivos o tareas activas de Atenea. Requiere validación manual.";
  }

  return matches
    .map((item) => `- Puede ser relevante para "${item.title}" porque aparecen temas cercanos en el transcript. Validar antes de convertirlo en acción.`)
    .join("\n");
}

function buildActionSection(entries) {
  const actionable = entries.filter((entry) => /\b(should|need|build|create|use|start|improve|compare|review|track|database|system)\b/i.test(entry.text));
  const picked = actionable.length ? actionable.slice(0, 5) : entries.slice(0, 3);

  if (!picked.length) {
    return "- No se detectaron propuestas accionables claras. Revisar manualmente.";
  }

  return picked
    .map((entry) => `- Revisar esta idea del video y decidir si merece experimento o incorporación: [${entry.timestamp}] ${entry.text}`)
    .join("\n");
}

function buildClaimsSection(entries) {
  const claims = entries.filter((entry) => /\b(all|always|never|proof|best|kill|guarantee|faster|better|must)\b/i.test(entry.text));
  const picked = claims.length ? claims.slice(0, 5) : entries.slice(0, 3);

  if (!picked.length) {
    return "- No se detectaron claims fuertes evidentes. Aun así, conviene validación humana.";
  }

  return picked
    .map((entry) => `- Validar la afirmación o promesa implícita en [${entry.timestamp}] ${entry.text}`)
    .join("\n");
}

async function getRelevantContextForSphere(sphere) {
  try {
    if (sphere === "personal") {
      return await getPersonalRelevantContext();
    }

    if (sphere === "work") {
      return await getWorkRelevantContext();
    }
  } catch {
    // If Atenea context is temporarily unavailable, keep the local summarizer working.
  }

  return {
    memory: [],
    goals: [],
    tasks: []
  };
}

async function commandExists(command) {
  try {
    await execFileAsync("sh", ["-lc", `command -v ${command}`]);
    return true;
  } catch {
    return false;
  }
}

async function canRunOllamaModel(model) {
  if (!await commandExists("ollama")) {
    return false;
  }

  try {
    await execFileAsync("ollama", ["show", model], {
      maxBuffer: 10 * 1024 * 1024
    });
    return true;
  } catch {
    return false;
  }
}

async function requestSummaryFromOllama({ transcriptBody, context, title, sourceUrl, focus, sphere, model }) {
  const transcriptEntries = parseTranscriptEntries(transcriptBody);
  const frequencyMap = buildFrequencyMap(transcriptEntries);
  const focusTokens = new Set(tokenize(focus));
  const contextTokens = new Set(uniqueTokensFromContext(context));
  const condensedEntries = pickTopEntries(
    transcriptEntries,
    10,
    (entry) => scoreEntry(entry, frequencyMap, focusTokens, contextTokens)
  );
  const condensedTranscript = condensedEntries
    .map((entry) => `[${entry.timestamp}] ${entry.text}`)
    .join("\n");
  const prompt = [
    "Eres radar-os_video_summarizer.",
    "Resume en markdown y en español.",
    "No inventes hechos ni objetivos fuera del contexto dado.",
    "Usa exactamente estas secciones:",
    "## Resumen fiel",
    "## Ideas clave",
    "## Relevancia para mis objetivos",
    "## Propuestas accionables",
    "## Claims a validar",
    "## Trazabilidad",
    "",
    `Video: ${title}`,
    `URL: ${sourceUrl || "unknown"}`,
    `Sphere: ${sphere}`,
    `Focus requested: ${focus || "general"}`,
    "",
    "Contexto relevante de Atenea:",
    JSON.stringify(context, null, 2),
    "",
    "Fragmentos relevantes del transcript:",
    condensedTranscript,
    "",
    "/nothink"
  ].join("\n");

  const { stdout } = await execFileAsync("ollama", [
    "run",
    model,
    "--hidethinking",
    "--nowordwrap",
    prompt
  ], {
    maxBuffer: 10 * 1024 * 1024
  });

  const text = String(stdout || "").trim();
  const cleanedText = stripTerminalControl(text);

  if (!cleanedText) {
    throw new Error("Ollama returned an empty summary.");
  }

  return cleanedText;
}

function buildLocalSummary({ transcriptBody, context, title, sourceUrl, focus, sphere }) {
  const entries = parseTranscriptEntries(transcriptBody);
  const frequencyMap = buildFrequencyMap(entries);
  const focusTokens = new Set(tokenize(focus));
  const contextTokens = new Set(uniqueTokensFromContext(context));
  const scoredEntries = pickTopEntries(
    entries,
    8,
    (entry) => scoreEntry(entry, frequencyMap, focusTokens, contextTokens)
  );
  const keyIdeas = pickTopEntries(
    entries,
    5,
    (entry) => scoreEntry(entry, frequencyMap, focusTokens, contextTokens) + (/\b(because|so|therefore|important|key)\b/i.test(entry.text) ? 5 : 0)
  );

  return [
    "## Resumen fiel",
    summarizeNarrative(scoredEntries),
    "",
    "## Ideas clave",
    formatBulletEntries(keyIdeas),
    "",
    "## Relevancia para mis objetivos",
    buildRelevanceSection({ entries: scoredEntries, context, focus }),
    "",
    "## Propuestas accionables",
    buildActionSection(scoredEntries),
    "",
    "## Claims a validar",
    buildClaimsSection(scoredEntries),
    "",
    "## Trazabilidad",
    `- Fuente: ${title}`,
    `- URL: ${sourceUrl || "unknown"}`,
    `- Sphere: ${sphere}`,
    `- Metodo: resumen local determinista basado en transcript y contexto de Atenea`,
    focus ? `- Focus aplicado: ${focus}` : "- Focus aplicado: general"
  ].join("\n");
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
  const model = String(args.model || DEFAULT_SUMMARY_MODEL).trim();
  const useOllama = await canRunOllamaModel(model);
  let summaryMarkdown;
  let summaryMethod;

  if (useOllama) {
    try {
      summaryMarkdown = await requestSummaryFromOllama({
        transcriptBody: body,
        context,
        title,
        sourceUrl,
        focus,
        sphere,
        model
      });
      summaryMethod = `ollama_${model.replace(/[:/]/g, "_")}`;
    } catch {
      summaryMarkdown = buildLocalSummary({
        transcriptBody: body,
        context,
        title,
        sourceUrl,
        focus,
        sphere
      });
      summaryMethod = "local_deterministic_fallback";
    }
  } else {
    summaryMarkdown = buildLocalSummary({
      transcriptBody: body,
      context,
      title,
      sourceUrl,
      focus,
      sphere
    });
    summaryMethod = "local_deterministic";
  }

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
    summary_method: summaryMethod,
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
