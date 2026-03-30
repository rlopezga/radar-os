import fs from "node:fs/promises";
import path from "node:path";

export const ROOT_DIR = path.resolve(import.meta.dirname, "..", "..");

export function parseCliArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith("--")) {
      continue;
    }

    const [rawKey, rawInlineValue] = token.slice(2).split("=", 2);
    const key = rawKey.trim();

    if (!key) {
      continue;
    }

    if (rawInlineValue !== undefined) {
      args[key] = rawInlineValue.trim();
      continue;
    }

    const nextToken = argv[index + 1];

    if (!nextToken || nextToken.startsWith("--")) {
      args[key] = "true";
      continue;
    }

    args[key] = nextToken;
    index += 1;
  }

  return args;
}

export function requireArg(args, key, message) {
  const value = String(args[key] || "").trim();

  if (!value) {
    throw new Error(message || `Missing --${key}`);
  }

  return value;
}

export function normalizeSphere(value, fallback = "personal") {
  const sphere = String(value || fallback).trim().toLowerCase();

  if (!["personal", "work", "shared", "system"].includes(sphere)) {
    throw new Error(`Invalid sphere "${value}". Use personal, work, shared, or system.`);
  }

  return sphere;
}

export function slugify(value, fallback = "item") {
  const slug = String(value || "")
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || fallback;
}

export function extractYouTubeVideoId(input) {
  const value = String(input || "").trim();

  if (!value) {
    throw new Error("A YouTube URL is required.");
  }

  try {
    const url = new URL(value);

    if (url.hostname === "youtu.be") {
      return url.pathname.replace(/^\/+/, "").trim();
    }

    if (url.searchParams.get("v")) {
      return url.searchParams.get("v").trim();
    }

    const shortsMatch = url.pathname.match(/\/shorts\/([^/?]+)/);
    if (shortsMatch) {
      return shortsMatch[1];
    }
  } catch {
    if (/^[a-zA-Z0-9_-]{11}$/.test(value)) {
      return value;
    }
  }

  throw new Error(`Could not extract a YouTube video id from "${input}".`);
}

export function isoDateString(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function formatTimestamp(seconds) {
  const totalSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  if (hours > 0) {
    return [hours, minutes, secs].map((part) => String(part).padStart(2, "0")).join(":");
  }

  return [minutes, secs].map((part) => String(part).padStart(2, "0")).join(":");
}

export function buildFrontmatter(data) {
  const lines = ["---"];

  Object.entries(data).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      return;
    }

    const renderedValue = Array.isArray(value)
      ? `[${value.map((item) => JSON.stringify(item)).join(", ")}]`
      : typeof value === "object"
        ? JSON.stringify(value)
        : JSON.stringify(String(value));

    lines.push(`${key}: ${renderedValue}`);
  });

  lines.push("---");
  return `${lines.join("\n")}\n`;
}

export async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function writeTextFile(filePath, content) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, content, "utf8");
}

export async function readJsonResponse(response) {
  const text = await response.text();

  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

export async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await readJsonResponse(response);

  if (!response.ok) {
    throw new Error(data?.error?.message || data?.message || data?.raw || `HTTP ${response.status}`);
  }

  return data;
}

export function compactAteneaContext(context = {}) {
  const pickFields = (items, fields, limit) => {
    return (Array.isArray(items) ? items : []).slice(0, limit).map((item) => {
      const entry = {};

      fields.forEach((field) => {
        if (item?.[field] !== undefined && item?.[field] !== null && item?.[field] !== "") {
          entry[field] = item[field];
        }
      });

      return entry;
    });
  };

  return {
    goals: pickFields(context.goals, ["id", "title", "status", "sphere", "description"], 8),
    tasks: pickFields(context.tasks, ["id", "title", "status", "priority", "sphere", "description"], 12),
    memory: pickFields(context.memory, ["id", "title", "sphere", "summary", "content"], 10)
  };
}

export function getOutputTextFromResponsesApi(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const output = Array.isArray(payload?.output) ? payload.output : [];
  const chunks = [];

  output.forEach((item) => {
    const content = Array.isArray(item?.content) ? item.content : [];
    content.forEach((part) => {
      if (part?.type === "output_text" && typeof part?.text === "string") {
        chunks.push(part.text);
      }
    });
  });

  return chunks.join("\n").trim();
}
