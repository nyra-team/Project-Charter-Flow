/**
 * In-app MERGE/UPSERT importer for a project's task list from an .xlsx workbook.
 *
 * Mirrors the cxo "Action Items Tracker" merge importer: an uploaded sheet is
 * merged into pmo_tasks for ONE project WITHOUT deleting anything:
 *   - match each Excel row to an existing task by an "ID" column (task id),
 *     falling back to a case-insensitive name match within the project;
 *   - matched → UPDATE, but only for cells the Excel actually fills in
 *     (blank Excel cell ⇒ keep the existing DB value, preserving in-app edits);
 *   - unmatched → INSERT a new task (linked to a named milestone if it already
 *     exists in the project, otherwise the project's "Unscheduled" milestone);
 *   - tasks absent from the file are LEFT UNTOUCHED. Nothing is deleted.
 *
 * Assignees are resolved against pmo_users by name/email (never created).
 * Column headers are matched case-insensitively against a set of synonyms.
 */
import { db, tasksTable, milestonesTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import * as XLSXns from "xlsx";
import { ensureUnscheduledMilestone } from "./gate-milestones";
const XLSX: any = (XLSXns as any).default ?? XLSXns;

// HTTP-mappable error (routes.ts reads .status).
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "HttpError";
  }
}

const norm = (s: unknown) => String(s ?? "").replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
const multiline = (s: unknown) => String(s ?? "").replace(/\r\n/g, "\n").trim();

// Pick the first non-empty cell whose header (case-insensitively, trimmed)
// matches one of the given synonyms.
function makePicker(row: Record<string, string>) {
  const lut = new Map<string, string>(); // lowercased header → original key
  for (const k of Object.keys(row)) lut.set(k.toLowerCase().trim(), k);
  return (...synonyms: string[]): string => {
    for (const syn of synonyms) {
      const key = lut.get(syn.toLowerCase().trim());
      if (key != null) {
        const v = row[key];
        if (norm(v)) return String(v);
      }
    }
    return "";
  };
}

// Free-text status → one of the 5 canonical task statuses.
function mapStatus(raw: string): string {
  const k = norm(raw).toLowerCase();
  if (!k) return "";
  if (k.startsWith("comp") || k === "done" || k === "closed") return "completed";
  if (k.includes("hold")) return "on_hold";
  if (k.includes("delay") || k.includes("stuck") || k.includes("block")) return "delayed";
  if (k.includes("progress") || k.includes("working") || k.includes("going") || k === "ongoing" || k === "wip") return "in_progress";
  if (k.includes("not started") || k.includes("to be") || k === "todo" || k === "to do" || k === "new" || k === "open" || k === "backlog") return "not_started";
  return "";
}

// Free-text priority → P0–P3. Blank ⇒ "" (keep existing on update / default on insert).
function mapPriority(raw: string): string {
  const k = norm(raw).toUpperCase();
  if (!k) return "";
  if (/\bP0\b|PRIORITY\s*0|CRITICAL|URGENT/.test(k)) return "P0";
  if (/\bP1\b|PRIORITY\s*1|HIGH/.test(k)) return "P1";
  if (/\bP2\b|PRIORITY\s*2|MEDIUM|MED|NORMAL/.test(k)) return "P2";
  if (/\bP3\b|PRIORITY\s*3|LOW/.test(k)) return "P3";
  return "";
}

function mapRag(raw: string): string {
  const k = norm(raw).toLowerCase();
  if (k.startsWith("r")) return "red";
  if (k.startsWith("a") || k.startsWith("y")) return "amber"; // amber / yellow
  if (k.startsWith("g")) return "green";
  return "";
}

// Accepts ISO (yyyy-mm-dd), m/d/yy(yy) and d-mmm-yy-style strings → ISO yyyy-mm-dd.
// Unparseable free text ⇒ "" (cell ignored).
function parseDate(raw: string): string {
  const s = norm(raw);
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const slash = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (slash) {
    const [, a, b, y] = slash;
    const yr = y.length === 2 ? 2000 + Number(y) : Number(y);
    // Excel commonly serialises as US m/d/y.
    const dt = new Date(Date.UTC(yr, Number(a) - 1, Number(b)));
    if (!isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
  }
  const t = Date.parse(s);
  if (!isNaN(t)) return new Date(t).toISOString().slice(0, 10);
  return "";
}

function parseProgress(raw: string): number | null {
  const s = norm(raw).replace("%", "");
  if (!s) return null;
  const n = Number(s);
  if (isNaN(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export type TaskImportResult = {
  sheet: string;
  rowsRead: number;
  inserted: number;
  updated: number;
  skipped: number;
  untouchedExisting: number;
};

export async function mergeTaskWorkbook(projectId: number, buffer: Buffer): Promise<TaskImportResult> {
  let wb: any;
  try {
    wb = XLSX.read(buffer, { type: "buffer" });
  } catch {
    throw new HttpError(422, "Could not read the file — is it a valid .xlsx workbook?");
  }
  const sheetName = wb.SheetNames.includes("Tasks") ? "Tasks" : wb.SheetNames[0];
  const sheet = sheetName ? wb.Sheets[sheetName] : null;
  if (!sheet) throw new HttpError(422, "No worksheet found in the file.");
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false }) as Record<string, string>[];
  if (!rows.length) throw new HttpError(422, "The sheet is empty.");

  // ── Existing tasks in this project, keyed for matching ──
  const existing = await db
    .select({ id: tasksTable.id, name: tasksTable.name, order: tasksTable.order })
    .from(tasksTable)
    .where(eq(tasksTable.projectId, projectId));
  const byId = new Map<number, { id: number }>();
  const byName = new Map<string, { id: number }>();
  let maxOrder = 0;
  for (const t of existing) {
    byId.set(t.id, { id: t.id });
    byName.set(norm(t.name).toLowerCase(), { id: t.id });
    if ((t.order ?? 0) > maxOrder) maxOrder = t.order ?? 0;
  }

  // ── Milestones (name → id) for optional milestone column ──
  const msRows = await db
    .select({ id: milestonesTable.id, name: milestonesTable.name })
    .from(milestonesTable)
    .where(eq(milestonesTable.projectId, projectId));
  const milestoneByName = new Map<string, number>();
  for (const m of msRows) milestoneByName.set(norm(m.name).toLowerCase(), m.id);

  // ── Users (name / email → id) — assignees are resolved, never created ──
  const userRows = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email }).from(usersTable);
  const userByName = new Map<string, number>();
  const userByEmail = new Map<string, number>();
  for (const u of userRows) {
    userByName.set(norm(u.name).toLowerCase(), u.id);
    userByEmail.set(norm(u.email).toLowerCase(), u.id);
  }
  const resolveAssignee = (cell: string): number | null => {
    const k = norm(cell).toLowerCase();
    if (!k) return null;
    return userByEmail.get(k) ?? userByName.get(k) ?? null;
  };

  let unscheduledId: number | null = null;
  const getUnscheduled = async (): Promise<number> => {
    if (unscheduledId == null) unscheduledId = await ensureUnscheduledMilestone(projectId);
    return unscheduledId;
  };

  let inserted = 0,
    updated = 0,
    skipped = 0;
  const touched = new Set<number>();

  for (const r of rows) {
    const get = makePicker(r);
    const name = norm(get("name", "task", "task name", "title", "work item", "action item"));
    if (!name) {
      skipped++;
      continue;
    }

    // Match: explicit ID column → existing task id; else case-insensitive name.
    const idCell = norm(get("id", "task id"));
    const idNum = idCell && /^\d+$/.test(idCell) ? Number(idCell) : null;
    const match = (idNum != null && byId.get(idNum)) || byName.get(name.toLowerCase()) || null;

    // Cell values (blank ⇒ "not provided")
    const descCell = multiline(get("description", "details", "notes"));
    const statusCell = mapStatus(get("status"));
    const prioCell = mapPriority(get("priority"));
    const ragCell = mapRag(get("rag", "health"));
    const stageCell = norm(get("stage", "phase"));
    const startCell = parseDate(get("start", "start date", "planned start"));
    const endCell = parseDate(get("end", "end date", "due", "due date", "target date", "deadline", "planned end"));
    const progressCell = parseProgress(get("progress", "progress %", "% complete", "percent", "completion"));
    const assigneeCell = get("assignee", "owner", "assigned to", "assignee name", "responsible");
    const assigneeId = resolveAssignee(assigneeCell);
    const msCell = norm(get("milestone", "milestone name"));

    if (match) {
      const sets: Partial<typeof tasksTable.$inferInsert> = { name };
      if (descCell) sets.description = descCell;
      if (statusCell) sets.status = statusCell;
      if (prioCell) sets.priority = prioCell;
      if (ragCell) sets.rag = ragCell;
      if (stageCell) sets.stage = stageCell;
      if (startCell) sets.startDate = startCell;
      if (endCell) sets.endDate = endCell;
      if (progressCell != null) sets.progressPct = progressCell;
      if (assigneeId != null) sets.assigneeId = assigneeId;
      if (msCell && milestoneByName.has(msCell.toLowerCase())) sets.milestoneId = milestoneByName.get(msCell.toLowerCase())!;
      await db.update(tasksTable).set(sets).where(eq(tasksTable.id, match.id));
      touched.add(match.id);
      updated++;
    } else {
      const milestoneId =
        msCell && milestoneByName.has(msCell.toLowerCase())
          ? milestoneByName.get(msCell.toLowerCase())!
          : await getUnscheduled();
      await db.insert(tasksTable).values({
        projectId,
        milestoneId,
        name,
        description: descCell || "",
        status: statusCell || "not_started",
        priority: prioCell || "P2",
        rag: ragCell || "green",
        stage: stageCell || null,
        startDate: startCell || null,
        endDate: endCell || null,
        progressPct: progressCell ?? 0,
        assigneeId: assigneeId ?? null,
        order: ++maxOrder,
      });
      inserted++;
    }
  }

  return {
    sheet: sheetName,
    rowsRead: rows.length,
    inserted,
    updated,
    skipped,
    untouchedExisting: existing.length - touched.size,
  };
}
