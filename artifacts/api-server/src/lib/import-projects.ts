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

export async function parseProjectsFromText(text: string): Promise<ImportedProject[]> {
  if (!isLLMConfigured()) {
    throw Object.assign(new Error("AI is not configured on the server — it's required to read arbitrary files."), { status: 503 });
  }
  const res = await llm<{ projects: ImportedProject[] }>({
    task: "import_projects",
    system:
      "You transcribe structured project data from documents (spreadsheets, exports, plans, notes) into JSON — you do NOT invent anything. " +
      "Identify each distinct project and capture: name, a one-paragraph description if present, start/end dates if present (YYYY-MM-DD), and its milestones. " +
      "For every milestone capture its name, target/due date, start date, status, responsible person, and ALL of its tasks. " +
      "For every task capture name, start date, end date/due, status, priority, assignee, department, progress %, and its subtasks (nested, any depth). " +
      "CRITICAL RULES: (1) Reflect EVERY row/item in the file — do not skip, summarise, merge, or sample any task or subtask. " +
      "(2) Do NOT generate, invent, or add any milestone, task, or subtask that is not explicitly in the content. If a milestone has no tasks in the file, return an empty tasks list. " +
      "(3) Keep names and free-text dates EXACTLY as written (e.g. 'Month 1', 'Q2 FY26', '30-Oct-2025'). Leave a field out only when it is genuinely absent.",
    prompt: `Transcribe ALL projects, milestones, tasks and subtasks from the content below — every single row, nothing added, nothing dropped.\n\n"""\n${text.slice(0, 200000)}\n"""`,
    jsonSchema: ImportSchema,
    jsonSchemaHint: `{"projects":[{"name":"...","description":"...","startDate":"2026-01-01","endDate":"2026-12-31","milestones":[{"milestone":"...","targetDate":"Month 1","startDate":"2026-01-01","status":"in progress","responsible":"...","tasks":[{"name":"...","startDate":"2026-01-05","endDate":"2026-01-20","status":"completed","priority":"High","assignee":"Jane Doe","department":"Quality","progress":100,"subtasks":[{"name":"...","status":"not started"}]}]}]}]}`,
    maxTokens: 16000,
  });
  if (!res.ok) throw Object.assign(new Error(`Couldn't read projects from the file: ${res.message}`), { status: 422 });
  return (res.data?.projects ?? []).filter((p) => (p.name ?? "").trim());
}
