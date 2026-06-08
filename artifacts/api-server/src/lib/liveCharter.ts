// ---------------------------------------------------------------------------
// Live Project Charter — backend helpers (no LLM calls live here).
//
// `extractDocText` downloads a project document from object storage and pulls
// plain text out of PDF / DOCX / XLSX / text files so the Live Charter can
// summarize the actual content of every document in a project's space.
//
// `buildStageMatrix` produces the per-stage governance roll-up (required-doc +
// blocking-checklist gaps) by reusing the existing read-only gate evaluator —
// no gating logic is duplicated here. The frontend renders its own richer,
// fully-labelled matrix from lifecycle-config; this server roll-up is stored on
// the snapshot for self-containment and feeds the AI narrative.
//
// All AI calls stay in routes/ai.ts per the app convention.
// ---------------------------------------------------------------------------
import { db, documentsTable, projectStagesTable, type Document } from "@workspace/db";
import { eq } from "drizzle-orm";
import { evaluateStageGate, applicableStages } from "./stage-gates";
import { ObjectStorageService } from "./objectStorage";
import { localFileExists, openLocalFileStream } from "./localStorage";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
// pdf-parse ships no types for its inner entry; we import the inner module to
// avoid its debug-mode test-file read that runs when the package root is
// imported directly.
// @ts-ignore
import pdfParse from "pdf-parse/lib/pdf-parse.js";

// Skip downloading/parsing anything bigger than this (e.g. training videos,
// which can be up to 500MB per lifecycle-config). Caps memory + LLM cost.
export const MAX_DOC_BYTES = 15 * 1024 * 1024;

// Per-document text sent to the model is capped to keep token cost bounded.
export const MAX_DOC_TEXT_CHARS = 12_000;

function extOf(name: string): string {
  return (name.split(".").pop() || "").toLowerCase();
}

/** True if we have a text extractor for this file (by extension or mime type). */
export function isExtractable(doc: Pick<Document, "name" | "fileType">): boolean {
  const ext = extOf(doc.name);
  const type = (doc.fileType || "").toLowerCase();
  return (
    ["pdf", "docx", "xlsx", "xls", "txt", "md", "csv"].includes(ext) ||
    type.includes("pdf") ||
    type.includes("word") ||
    type.includes("officedocument.wordprocessing") ||
    type.includes("sheet") ||
    type.includes("excel") ||
    type.startsWith("text/")
  );
}

/**
 * Download a document from object storage and extract its plain text.
 * Returns null when the file is missing, oversized, unsupported, or extraction
 * fails — callers treat null as "no content to summarize" and degrade gracefully.
 */
export async function extractDocText(doc: Document): Promise<string | null> {
  if (!doc.fileUrl) return null;
  if (doc.fileSize && doc.fileSize > MAX_DOC_BYTES) return null;
  if (!isExtractable(doc)) return null;

  let buf: Buffer;
  try {
    // Local-FS fallback: when running off-Replit, document fileUrls look like
    // /api/storage/objects/local-<uuid>. Read straight from disk; skip the
    // Replit GCS path that would otherwise throw.
    const localMatch = doc.fileUrl.match(/\/objects\/(local-[A-Za-z0-9_-]+)$/);
    if (localMatch) {
      const objectId = localMatch[1];
      if (!(await localFileExists(objectId))) return null;
      buf = await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        const stream = openLocalFileStream(objectId);
        stream.on("data", (c: Buffer) => chunks.push(c));
        stream.on("end", () => resolve(Buffer.concat(chunks)));
        stream.on("error", reject);
      });
    } else {
      const svc = new ObjectStorageService();
      const objectPath = svc.normalizeObjectEntityPath(doc.fileUrl);
      const file = await svc.getObjectEntityFile(objectPath);
      const [downloaded] = await file.download();
      buf = downloaded;
    }
  } catch {
    return null;
  }

  const ext = extOf(doc.name);
  const type = (doc.fileType || "").toLowerCase();
  try {
    if (ext === "pdf" || type.includes("pdf")) {
      const parsed = await pdfParse(buf);
      return parsed.text?.trim() || null;
    }
    if (ext === "docx" || type.includes("word") || type.includes("officedocument.wordprocessing")) {
      const parsed = await mammoth.extractRawText({ buffer: buf });
      return parsed.value?.trim() || null;
    }
    if (ext === "xlsx" || ext === "xls" || type.includes("sheet") || type.includes("excel")) {
      const wb = XLSX.read(buf, { type: "buffer" });
      const parts = wb.SheetNames.map(
        (sn) => `# ${sn}\n${XLSX.utils.sheet_to_csv(wb.Sheets[sn])}`,
      );
      return parts.join("\n\n").trim() || null;
    }
    if (ext === "txt" || ext === "md" || ext === "csv" || type.startsWith("text/")) {
      return buf.toString("utf8").trim() || null;
    }
  } catch {
    return null;
  }
  return null;
}

export type StageMatrixEntry = {
  stage: string;
  status: string; // not_started | in_progress | complete
  satisfied: boolean;
  missingDocs: string[];
  uncheckedChecklist: string[];
  prerequisitesMissing: string[];
};

/**
 * Per-applicable-stage governance roll-up using the existing gate evaluator.
 * Stage keys only (labels are resolved on the frontend from lifecycle-config).
 */
export async function buildStageMatrix(
  projectId: number,
  projectType: string | null | undefined,
): Promise<StageMatrixEntry[]> {
  const stages = applicableStages(projectType);
  const records = await db
    .select()
    .from(projectStagesTable)
    .where(eq(projectStagesTable.projectId, projectId));
  const statusOf = (k: string) => records.find((r) => r.stage === k)?.status ?? "not_started";

  const out: StageMatrixEntry[] = [];
  for (const stage of stages) {
    const gate = await evaluateStageGate(projectId, stage, projectType);
    out.push({
      stage,
      status: statusOf(stage),
      satisfied: gate.satisfied,
      missingDocs: gate.missingDocs,
      uncheckedChecklist: gate.uncheckedChecklist,
      prerequisitesMissing: gate.prerequisitesMissing,
    });
  }
  return out;
}
