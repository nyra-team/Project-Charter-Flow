// ───────────────────────────────────────────────────────────────────────────
// "Import projects" — accept a file in ANY common format, turn it into
// structured project data via the LLM, and let the caller create the projects.
//
//   extractText()          — buffer + filename → plain text (xlsx/csv/json/txt/
//                            md/pdf/docx, else best-effort utf-8).
//   parseProjectsFromText() — text → [{ name, description, dates, milestones }].
// ───────────────────────────────────────────────────────────────────────────
import * as XLSX from "xlsx";
import mammoth from "mammoth";
// pdf-parse's package root has an import-time side effect (reads a test file);
// the /lib entry avoids it.
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { z } from "zod";
import { llm, isLLMConfigured } from "@workspace/llm";

export async function extractText(buffer: Buffer, fileName: string): Promise<string> {
  const ext = (fileName.split(".").pop() || "").toLowerCase();
  try {
    if (ext === "xlsx" || ext === "xls" || ext === "xlsm") {
      const wb = XLSX.read(buffer, { type: "buffer" });
      return wb.SheetNames.map((s) => `# Sheet: ${s}\n${XLSX.utils.sheet_to_csv(wb.Sheets[s])}`).join("\n\n");
    }
    if (ext === "pdf") return (await pdfParse(buffer)).text || "";
    if (ext === "docx") return (await mammoth.extractRawText({ buffer })).value || "";
  } catch { /* fall through to plain-text */ }
  // csv, tsv, json, txt, md, xml, html, yaml … and anything else.
  return buffer.toString("utf8");
}

// A task node — recursive so subtasks nest to any depth. Every field the file
// carries is captured; all are optional so partial rows still import.
const TaskNode: z.ZodType<{
  name: string; startDate?: string; endDate?: string; status?: string;
  priority?: string; assignee?: string; department?: string; progress?: number;
  subtasks?: unknown[];
}> = z.lazy(() => z.object({
  name: z.string(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
  assignee: z.string().optional(),
  department: z.string().optional(),
  progress: z.number().optional(),
  subtasks: z.array(TaskNode).optional(),
}));

const ImportSchema = z.object({
  projects: z.array(z.object({
    name: z.string(),
    description: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    milestones: z.array(z.object({
      milestone: z.string(),
      targetDate: z.string().optional(),
      startDate: z.string().optional(),
      status: z.string().optional(),
      responsible: z.string().optional(),
      tasks: z.array(TaskNode).optional(),
    })).optional(),
  })),
});

export type ImportedProject = z.infer<typeof ImportSchema>["projects"][number];
type ImportedMilestone = NonNullable<ImportedProject["milestones"]>[number];

// A faithful transcription emits far more JSON than the source text it reads —
// a 15k-char sheet expands past 16k output tokens and gets cut off mid-string.
// So the file is transcribed in row-wise excerpts, each small enough to finish
// well inside the output budget, and the results are merged.
const CHUNK_CHARS = 5000;
const MAX_OUTPUT_TOKENS = 32000;
const CONCURRENCY = 3;

/** A cell that carries data rather than naming a column (date, number, percent). */
function looksLikeValue(cell: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(cell) ||
    /^\d{1,4}[-/][A-Za-z0-9]{1,9}[-/]\d{1,4}$/.test(cell) ||
    /^-?\d+(\.\d+)?%?$/.test(cell)
  );
}

/**
 * Index of the last preamble line of a sheet (title rows + the column-header
 * row). Those lines are repeated on every excerpt so each one is readable on
 * its own; the data rows below them are never repeated, so nothing imports
 * twice. Returns -1 when the content isn't tabular (prose, notes).
 */
function preambleEnd(lines: string[]): number {
  let end = -1;
  for (let i = 0; i < Math.min(lines.length, 6); i++) {
    const cells = lines[i].split(",").map((c) => c.trim()).filter(Boolean);
    if (cells.length < 2) continue;
    if (cells.some(looksLikeValue)) break; // data rows have started
    end = i;
  }
  return end;
}

/** Split extracted text into excerpts of ≤ CHUNK_CHARS, per sheet, headers repeated. */
export function splitIntoChunks(text: string): string[] {
  if (text.length <= CHUNK_CHARS) return [text];
  const sheets = text.split(/\n(?=# Sheet: )/);
  const chunks: string[] = [];

  for (const sheet of sheets) {
    const lines = sheet.split("\n");
    const title = lines[0].startsWith("# Sheet: ") ? lines.shift()! : "";
    const end = preambleEnd(lines);
    const preamble = [title, ...lines.slice(0, end + 1)].filter(Boolean).join("\n");
    const rows = lines.slice(end + 1);

    let batch: string[] = [];
    let size = 0;
    const flush = () => {
      if (!batch.length) return;
      chunks.push([preamble, ...batch].filter(Boolean).join("\n"));
      batch = [];
      size = 0;
    };
    for (const row of rows) {
      if (size && size + row.length > CHUNK_CHARS) flush();
      batch.push(row);
      size += row.length + 1;
    }
    flush();
  }
  return chunks.filter((c) => c.trim()).length ? chunks.filter((c) => c.trim()) : [text];
}

const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Merge per-excerpt results: same project name → one project.
 *
 * Milestones are de-duplicated by NAME only, and only against milestones
 * contributed by an *earlier* excerpt. Two excerpts describing the same row
 * (e.g. a plan sheet and its actuals sheet) won't agree on how a date or status
 * landed in the JSON — one call writes `status: "Completed"`, another writes
 * `targetDate: "Completed"` — so any date-sensitive key lets the copy through.
 * Repeats *within* one excerpt are kept: there the model saw every row at once,
 * so a recurring name (e.g. a monthly review) is genuinely a separate milestone.
 */
function mergeProjects(batches: ImportedProject[][]): ImportedProject[] {
  const byName = new Map<string, ImportedProject>();
  const seenMilestones = new Map<string, Map<string, ImportedMilestone>>();

  for (const batch of batches) {
    for (const p of batch) {
      const key = norm(p.name);
      const existing = byName.get(key);
      if (!existing) {
        byName.set(key, { ...p, milestones: [...(p.milestones ?? [])] });
        seenMilestones.set(key, new Map((p.milestones ?? []).map((m) => [norm(m.milestone), m])));
        continue;
      }
      existing.description ||= p.description;
      existing.startDate ||= p.startDate;
      existing.endDate ||= p.endDate;

      const seen = seenMilestones.get(key)!;
      for (const m of p.milestones ?? []) {
        const prior = seen.get(norm(m.milestone));
        if (!prior) {
          seen.set(norm(m.milestone), m);
          (existing.milestones ??= []).push(m);
          continue;
        }
        // Same milestone, seen again — keep the richer view of it.
        prior.targetDate ||= m.targetDate;
        prior.startDate ||= m.startDate;
        prior.status ||= m.status;
        prior.responsible ||= m.responsible;
        if (m.tasks?.length) {
          const names = new Set((prior.tasks ?? []).map((t) => norm(t.name)));
          prior.tasks = [...(prior.tasks ?? []), ...m.tasks.filter((t) => !names.has(norm(t.name)))];
        }
      }
    }
  }
  return [...byName.values()];
}

const SYSTEM =
  "You transcribe structured project data from documents (spreadsheets, exports, plans, notes) into JSON — you do NOT invent anything. " +
  "Identify each distinct project and capture: name, a one-paragraph description if present, start/end dates if present (YYYY-MM-DD), and its milestones. " +
  "For every milestone capture its name, target/due date, start date, status, responsible person, and ALL of its tasks. " +
  "For every task capture name, start date, end date/due, status, priority, assignee, department, progress %, and its subtasks (nested, any depth). " +
  "CRITICAL RULES: (1) Reflect EVERY row/item in the excerpt — do not skip, summarise, merge, or sample any task or subtask. " +
  "(2) Do NOT generate, invent, or add any milestone, task, or subtask that is not explicitly in the content. If a milestone has no tasks in the file, return an empty tasks list. " +
  "(3) Keep names and free-text dates EXACTLY as written (e.g. 'Month 1', 'Q2 FY26', '30-Oct-2025'). Leave a field out only when it is genuinely absent. " +
  "(4) When the content is a table whose every row describes one milestone/task of a larger thing, the project is that larger thing: derive its name ONLY from the row's own identifying columns " +
  "(e.g. product + market/country), joined with ' — '. Never name a project after the sheet, the file, or a category heading. " +
  "You may be given one excerpt of a longer file, so identical rows must always yield an identical project name.";

const HINT = `{"projects":[{"name":"...","description":"...","startDate":"2026-01-01","endDate":"2026-12-31","milestones":[{"milestone":"...","targetDate":"Month 1","startDate":"2026-01-01","status":"in progress","responsible":"...","tasks":[{"name":"...","startDate":"2026-01-05","endDate":"2026-01-20","status":"completed","priority":"High","assignee":"Jane Doe","department":"Quality","progress":100,"subtasks":[{"name":"...","status":"not started"}]}]}]}]}`;

async function transcribeChunk(chunk: string, index: number, total: number): Promise<ImportedProject[]> {
  const scope = total > 1 ? ` (excerpt ${index + 1} of ${total})` : "";
  const res = await llm<{ projects: ImportedProject[] }>({
    task: "import_projects",
    system: SYSTEM,
    prompt: `Transcribe ALL projects, milestones, tasks and subtasks from the content below${scope} — every single row, nothing added, nothing dropped.\n\n"""\n${chunk}\n"""`,
    jsonSchema: ImportSchema,
    jsonSchemaHint: HINT,
    maxTokens: MAX_OUTPUT_TOKENS,
  });
  if (!res.ok) {
    const detail = res.reason === "truncated"
      ? `excerpt ${index + 1} of ${total} was too dense to transcribe in one pass (${res.message})`
      : res.message;
    throw Object.assign(new Error(`Couldn't read projects from the file: ${detail}`), { status: 422 });
  }
  return (res.data?.projects ?? []).filter((p) => (p.name ?? "").trim());
}

export async function parseProjectsFromText(text: string): Promise<ImportedProject[]> {
  if (!isLLMConfigured()) {
    throw Object.assign(new Error("AI is not configured on the server — it's required to read arbitrary files."), { status: 503 });
  }
  const chunks = splitIntoChunks(text.slice(0, 200000));

  // Excerpts are independent, so run a few at a time — a big workbook is many
  // calls and serialising them all would outlast the request. Results are kept
  // in file order so the merge stays deterministic regardless of finish order.
  const batches: ImportedProject[][] = new Array(chunks.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let i = next++; i < chunks.length; i = next++) {
      batches[i] = await transcribeChunk(chunks[i], i, chunks.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, worker));

  return mergeProjects(batches);
}
