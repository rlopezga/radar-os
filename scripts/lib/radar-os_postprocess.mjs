import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runAteneaIngestor } from "../radar-os_atenea_ingestor.mjs";
import { runVideoSummarizer } from "../radar-os_video_summarizer.mjs";
import {
  ROOT_DIR,
  ensureDir,
  normalizeBoolean,
  parseFrontmatter
} from "./common.mjs";

const execFileAsync = promisify(execFile);
const RADAR_DB_DIR = path.join(ROOT_DIR, "data");
const RADAR_DB_PATH = path.join(RADAR_DB_DIR, "radar-os.sqlite");

async function runSqlite(sql, params = []) {
  await ensureDir(RADAR_DB_DIR);

  await execFileAsync("sqlite3", [
    ...params.map((value) => String(value ?? "")),
    RADAR_DB_PATH,
    sql
  ]);
}

async function readSqlite(sql, params = []) {
  await ensureDir(RADAR_DB_DIR);

  const { stdout } = await execFileAsync("sqlite3", [
    ...params.map((value) => String(value ?? "")),
    "-separator",
    "|",
    RADAR_DB_PATH,
    sql
  ]);

  return stdout.trim();
}

async function ensureColumn(tableName, columnName, definition) {
  const pragmaOutput = await readSqlite(`PRAGMA table_info(${tableName});`);
  const existingColumns = pragmaOutput
    .split("\n")
    .map((line) => line.split("|")[1])
    .filter(Boolean);

  if (existingColumns.includes(columnName)) {
    return;
  }

  await runSqlite(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition};`);
}

async function ensureRadarDb() {
  await runSqlite(`
    CREATE TABLE IF NOT EXISTS transcript_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL UNIQUE,
      source_type TEXT,
      source_url TEXT,
      video_id TEXT,
      title TEXT,
      channel TEXT,
      sphere TEXT,
      transcript_method TEXT,
      transcript_language TEXT,
      transcript_model TEXT,
      transcript_model_resolved TEXT,
      transcript_markdown TEXT NOT NULL,
      transcript_body TEXT NOT NULL,
      requires_validation INTEGER NOT NULL DEFAULT 1,
      captured_at TEXT,
      stored_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      summary_path TEXT,
      summary_generated_at TEXT,
      atenea_proposal_status TEXT,
      atenea_proposal_input_path TEXT,
      atenea_proposal_reported_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_transcript_records_video_id
      ON transcript_records(video_id);

    CREATE INDEX IF NOT EXISTS idx_transcript_records_captured_at
      ON transcript_records(captured_at);
  `);

  await ensureColumn("transcript_records", "summary_path", "TEXT");
  await ensureColumn("transcript_records", "summary_generated_at", "TEXT");
  await ensureColumn("transcript_records", "atenea_proposal_status", "TEXT");
  await ensureColumn("transcript_records", "atenea_proposal_input_path", "TEXT");
  await ensureColumn("transcript_records", "atenea_proposal_reported_at", "TEXT");
}

async function getTranscriptRecord(transcriptPath) {
  const absolutePath = path.resolve(transcriptPath);

  await ensureRadarDb();
  const output = await readSqlite(`
    SELECT
      file_path,
      summary_path,
      summary_generated_at,
      atenea_proposal_status,
      atenea_proposal_input_path,
      atenea_proposal_reported_at
    FROM transcript_records
    WHERE file_path = $file_path
    LIMIT 1;
  `, [
    "-cmd", ".param init",
    "-cmd", `.param set $file_path ${JSON.stringify(path.relative(ROOT_DIR, absolutePath))}`
  ]);

  if (!output) {
    return null;
  }

  const [
    filePath,
    summaryPath,
    summaryGeneratedAt,
    ateneaProposalStatus,
    ateneaProposalInputPath,
    ateneaProposalReportedAt
  ] = output.split("|");

  return {
    filePath,
    summaryPath: summaryPath || "",
    summaryGeneratedAt: summaryGeneratedAt || "",
    ateneaProposalStatus: ateneaProposalStatus || "",
    ateneaProposalInputPath: ateneaProposalInputPath || "",
    ateneaProposalReportedAt: ateneaProposalReportedAt || ""
  };
}

async function updateTranscriptRecord(transcriptPath, fields = {}) {
  const absolutePath = path.resolve(transcriptPath);
  const assignments = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key]) => `${key} = $${key}`);

  if (!assignments.length) {
    return;
  }

  await ensureRadarDb();
  await runSqlite(`
    UPDATE transcript_records
    SET ${assignments.join(", ")}
    WHERE file_path = $file_path;
  `, [
    "-cmd", ".param init",
    "-cmd", `.param set $file_path ${JSON.stringify(path.relative(ROOT_DIR, absolutePath))}`,
    ...Object.entries(fields)
      .filter(([, value]) => value !== undefined)
      .flatMap(([key, value]) => ["-cmd", `.param set $${key} ${JSON.stringify(String(value ?? ""))}`])
  ]);
}

function classifyAteneaProposalError(error) {
  const message = String(error?.message || "").trim();

  if (
    /fetch failed/i.test(message)
    || /network/i.test(message)
    || /ECONN/i.test(message)
    || /ENOTFOUND/i.test(message)
    || /timed out/i.test(message)
  ) {
    return {
      status: "pending_retry",
      message
    };
  }

  return {
    status: "failed",
    message
  };
}

export async function persistTranscriptToRadarDb(transcriptPath) {
  const absolutePath = path.resolve(transcriptPath);
  const markdown = await fs.readFile(absolutePath, "utf8");
  const { frontmatter, body } = parseFrontmatter(markdown);

  await ensureRadarDb();
  await runSqlite(`
    INSERT INTO transcript_records (
      file_path,
      source_type,
      source_url,
      video_id,
      title,
      channel,
      sphere,
      transcript_method,
      transcript_language,
      transcript_model,
      transcript_model_resolved,
      transcript_markdown,
      transcript_body,
      requires_validation,
      captured_at,
      stored_at
    ) VALUES (
      $file_path,
      $source_type,
      $source_url,
      $video_id,
      $title,
      $channel,
      $sphere,
      $transcript_method,
      $transcript_language,
      $transcript_model,
      $transcript_model_resolved,
      $transcript_markdown,
      $transcript_body,
      $requires_validation,
      $captured_at,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT(file_path) DO UPDATE SET
      source_type = excluded.source_type,
      source_url = excluded.source_url,
      video_id = excluded.video_id,
      title = excluded.title,
      channel = excluded.channel,
      sphere = excluded.sphere,
      transcript_method = excluded.transcript_method,
      transcript_language = excluded.transcript_language,
      transcript_model = excluded.transcript_model,
      transcript_model_resolved = excluded.transcript_model_resolved,
      transcript_markdown = excluded.transcript_markdown,
      transcript_body = excluded.transcript_body,
      requires_validation = excluded.requires_validation,
      captured_at = excluded.captured_at,
      stored_at = CURRENT_TIMESTAMP;
  `, [
    "-cmd", ".param init",
    "-cmd", `.param set $file_path ${JSON.stringify(path.relative(ROOT_DIR, absolutePath))}`,
    "-cmd", `.param set $source_type ${JSON.stringify(frontmatter.source_type || "youtube")}`,
    "-cmd", `.param set $source_url ${JSON.stringify(frontmatter.source_url || "")}`,
    "-cmd", `.param set $video_id ${JSON.stringify(frontmatter.video_id || "")}`,
    "-cmd", `.param set $title ${JSON.stringify(frontmatter.title || path.basename(absolutePath, path.extname(absolutePath)))}`,
    "-cmd", `.param set $channel ${JSON.stringify(frontmatter.channel || "")}`,
    "-cmd", `.param set $sphere ${JSON.stringify(frontmatter.sphere || "personal")}`,
    "-cmd", `.param set $transcript_method ${JSON.stringify(frontmatter.transcript_method || "")}`,
    "-cmd", `.param set $transcript_language ${JSON.stringify(frontmatter.transcript_language || "")}`,
    "-cmd", `.param set $transcript_model ${JSON.stringify(frontmatter.whisper_model || "")}`,
    "-cmd", `.param set $transcript_model_resolved ${JSON.stringify(frontmatter.whisper_model_resolved || "")}`,
    "-cmd", `.param set $transcript_markdown ${JSON.stringify(markdown)}`,
    "-cmd", `.param set $transcript_body ${JSON.stringify(body)}`,
    "-cmd", `.param set $requires_validation ${normalizeBoolean(frontmatter.requires_validation, true) ? "1" : "0"}`,
    "-cmd", `.param set $captured_at ${JSON.stringify(frontmatter.captured_at || new Date().toISOString())}`
  ]);

  return {
    databasePath: RADAR_DB_PATH,
    storedPath: path.relative(ROOT_DIR, absolutePath),
    title: frontmatter.title || path.basename(absolutePath, path.extname(absolutePath))
  };
}

export async function runTranscriptPostprocess({
  transcriptPath,
  sphere,
  focus,
  autoSummary = true,
  autoIngestProposal = true,
  skipCompleted = false
}) {
  const transcriptMarkdown = await fs.readFile(path.resolve(transcriptPath), "utf8");
  const { frontmatter } = parseFrontmatter(transcriptMarkdown);
  const effectiveSphere = String(sphere || frontmatter.sphere || "personal").trim();
  const existingRecord = await getTranscriptRecord(transcriptPath);
  const dbResult = await persistTranscriptToRadarDb(transcriptPath);
  const result = {
    radarDb: {
      status: "stored",
      ...dbResult
    },
    summary: {
      status: "skipped"
    },
    ateneaProposal: {
      status: "skipped"
    }
  };

  if (
    skipCompleted &&
    existingRecord?.summaryPath &&
    existingRecord?.ateneaProposalStatus === "queued_for_review"
  ) {
    result.summary = {
      status: "already_created",
      outputPath: path.join(ROOT_DIR, existingRecord.summaryPath)
    };
    result.ateneaProposal = {
      status: "already_reported",
      inputPath: existingRecord.ateneaProposalInputPath
        ? path.join(ROOT_DIR, existingRecord.ateneaProposalInputPath)
        : null
    };

    return result;
  }

  if (!autoSummary) {
    return result;
  }

  try {
    let summaryOutputPath = existingRecord?.summaryPath
      ? path.join(ROOT_DIR, existingRecord.summaryPath)
      : "";

    if (skipCompleted && existingRecord?.summaryPath) {
      result.summary = {
        status: "already_created",
        outputPath: summaryOutputPath
      };
    } else {
      const summaryResult = await runVideoSummarizer([
        "--input",
        transcriptPath,
        "--sphere",
        effectiveSphere,
        ...(focus ? ["--focus", focus] : [])
      ]);

      summaryOutputPath = summaryResult.outputPath;
      result.summary = {
        status: "created",
        outputPath: summaryResult.outputPath,
        title: summaryResult.title
      };

      await updateTranscriptRecord(transcriptPath, {
        summary_path: path.relative(ROOT_DIR, summaryResult.outputPath),
        summary_generated_at: new Date().toISOString()
      });
    }

    if (!autoIngestProposal) {
      return result;
    }

    if (skipCompleted && existingRecord?.ateneaProposalStatus === "queued_for_review") {
      result.ateneaProposal = {
        status: "already_reported",
        inputPath: existingRecord.ateneaProposalInputPath
          ? path.join(ROOT_DIR, existingRecord.ateneaProposalInputPath)
          : summaryOutputPath || null
      };

      return result;
    }

    try {
      const ingestResult = await runAteneaIngestor([
        "--input",
        summaryOutputPath,
        "--kind",
        "proposal",
        "--auto-process",
        "true"
      ]);

      result.ateneaProposal = {
        status: "queued_for_review",
        kind: ingestResult.kind,
        inputPath: ingestResult.inputPath,
        result: ingestResult.result
      };

      await updateTranscriptRecord(transcriptPath, {
        atenea_proposal_status: "queued_for_review",
        atenea_proposal_input_path: path.relative(ROOT_DIR, ingestResult.inputPath),
        atenea_proposal_reported_at: new Date().toISOString()
      });
    } catch (error) {
      const classifiedError = classifyAteneaProposalError(error);

      result.ateneaProposal = {
        status: classifiedError.status,
        error: classifiedError.message
      };

      await updateTranscriptRecord(transcriptPath, {
        atenea_proposal_status: classifiedError.status,
        atenea_proposal_input_path: summaryOutputPath ? path.relative(ROOT_DIR, summaryOutputPath) : "",
        atenea_proposal_reported_at: ""
      });
    }
  } catch (error) {
    result.summary = {
      status: "failed",
      error: error.message
    };
  }

  return result;
}
