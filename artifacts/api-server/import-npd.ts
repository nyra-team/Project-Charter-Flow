// One-off: load the Regulatory Filings workbook into PMO under category NPD.
//
// This reads the sheet directly rather than going through the LLM transcriber
// used by POST /api/projects/import. That path exists to read *arbitrary*
// files; this workbook is a fixed grid (one milestone per row), and the LLM
// round-trip both dropped the two Actual columns — its milestone schema has
// only `startDate`/`targetDate` — and silently picked between two sheets whose
// Actual columns disagree on 12 rows.
//
//   --file <path>    the workbook (or NPD_XLSX env var) — required
//   --dry            parse and print, touch nothing
//   --sheet "<name>" override the source sheet
//   --gates          also seed the 9 standard gate milestones (off by default:
//                    they are not in the workbook)
import "dotenv/config";
import * as fs from "fs";
// Default import, not `* as XLSX`: xlsx is CJS and the namespace it synthesises
// omits SSF (only `read`/`utils` survive the named-export detection).
import XLSX from "xlsx";
import { and, eq } from "drizzle-orm";
import { db, projectsTable, milestonesTable } from "@workspace/db";
import { generateGateMilestones } from "./src/lib/gate-milestones";

const CATEGORY = "NPD";

// The workbook ships two sheets with identical keys. "KPI" pre-fills the Actual
// columns with projections (21 actual-dates land in the future); "KPI WITH OUT"
// blanks those, leaving actuals only where work has really happened. The latter
// is the as-of-today view, so it is the source of truth.
const DEFAULT_SHEET = "KPI WITH OUT ";
const HEADER_ROWS = 2; // row 1 = "KPI CATEGORY: NEW PROD", row 2 = column headers

const DRY = process.argv.includes("--dry");
const GATES = process.argv.includes("--gates");
const flag = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const SHEET = flag("--sheet") ?? DEFAULT_SHEET;
const FILE = flag("--file") ?? process.env.NPD_XLSX;
if (!FILE) {
  console.error("usage: tsx import-npd.ts --file <workbook.xlsx> [--sheet <name>] [--dry] [--gates]");
  process.exit(2);
}

/**
 * The Actual Start / Actual End columns are not clean dates. Alongside real
 * dates they carry "─" (28×), "Completed" (15×), "Biowaiver" (4×) and "NA" (1×)
 * — status text typed into a date column. Split the two apart: a real date
 * becomes a date, a placeholder becomes nothing, and anything else is a note we
 * keep rather than discard.
 */
const BLANK = new Set(["", "-", "–", "—", "─", "na", "n/a"]);

type Cell = { date: string | null; note: string | null };

/**
 * Dates arrive as Excel serial numbers and are decoded with SSF, never with
 * `cellDates`. That option builds a Date using the local UTC offset — serial
 * 45901 (2025-09-01) comes back as 2025-08-31T18:29:50Z, which reads as
 * Aug 31 in IST. SSF.parse_date_code returns calendar parts, so no timezone
 * ever touches the value.
 */
function readCell(v: unknown): Cell {
  if (v == null) return { date: null, note: null };
  if (typeof v === "number") {
    const p = XLSX.SSF.parse_date_code(v);
    if (!p) return { date: null, note: null };
    return { date: `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`, note: null };
  }
  const s = String(v).trim();
  if (BLANK.has(s.toLowerCase())) return { date: null, note: null };
  return { date: null, note: s };
}

type Row = {
  project: string;
  milestone: string;
  planStart: string | null;
  planEnd: string | null;
  actualStart: Cell;
  actualEnd: Cell;
};

function readRows(): Row[] {
  // XLSX.readFile is absent from the ESM build (it has no fs binding) — read
  // the bytes ourselves, as extractText() does.
  const wb = XLSX.read(fs.readFileSync(FILE));
  const ws = wb.Sheets[SHEET];
  if (!ws) throw new Error(`sheet ${JSON.stringify(SHEET)} not found; have: ${wb.SheetNames.map((s) => JSON.stringify(s)).join(", ")}`);

  // raw:true keeps date cells as their underlying serial numbers, which is what
  // readCell() decodes; raw:false would format them into locale strings.
  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, raw: true });
  const rows: Row[] = [];
  // Region/Country/Product repeat on every row today, but forward-fill anyway
  // so a future merged-cell edit doesn't silently drop a project.
  let country = "", product = "";

  for (const r of grid.slice(HEADER_ROWS)) {
    country = (r[1] != null && String(r[1]).trim()) || country;
    product = (r[2] != null && String(r[2]).trim()) || product;
    const milestone = r[3] != null ? String(r[3]).trim() : "";
    if (!product || !milestone) continue;

    rows.push({
      // Country already carries the region qualifier ("LATAM; Chile"), so
      // "<product> — <country>" is the whole name.
      project: `${product} — ${country}`,
      milestone,
      planStart: readCell(r[4]).date,
      planEnd: readCell(r[5]).date,
      actualStart: readCell(r[6]),
      actualEnd: readCell(r[7]),
    });
  }
  return rows;
}

/**
 * A milestone is complete when it has a real Actual End, or when the Actual End
 * cell says so in words ("Completed", "Biowaiver" — a biowaiver closes the BE
 * milestone without a study). It is in progress once it has an Actual Start.
 */
function statusOf(m: Row): "completed" | "in_progress" | "not_started" {
  if (m.actualEnd.date || m.actualEnd.note) return "completed";
  if (m.actualStart.date || m.actualStart.note) return "in_progress";
  return "not_started";
}

const min = (xs: (string | null)[]): string | null => xs.filter(Boolean).sort()[0] ?? null;
const max = (xs: (string | null)[]): string | null => xs.filter(Boolean).sort().at(-1) ?? null;

(async () => {
  const rows = readRows();
  const byProject = new Map<string, Row[]>();
  for (const r of rows) {
    const ms = byProject.get(r.project);
    if (ms) ms.push(r);
    else byProject.set(r.project, [r]);
  }

  console.log(`sheet ${JSON.stringify(SHEET)}: ${byProject.size} projects, ${rows.length} milestones`);

  if (DRY) {
    for (const [name, ms] of byProject) {
      const span = `${min(ms.map((m) => m.planStart)) ?? "—"} → ${max(ms.map((m) => m.planEnd)) ?? "—"}`;
      console.log(`\n [dry] ${name}   ${span}`);
      for (const m of ms) {
        const note = [m.actualStart.note, m.actualEnd.note].filter(Boolean).join(" / ");
        console.log(
          `        ${m.milestone.padEnd(26)} plan ${m.planStart ?? "—"} → ${m.planEnd ?? "—"}` +
            `  actual ${m.actualStart.date ?? "—"} → ${m.actualEnd.date ?? "—"}` +
            `  [${statusOf(m)}]${note ? `  (${note})` : ""}`,
        );
      }
    }
    process.exit(0);
  }

  const created: number[] = [];
  let skipped = 0;

  for (const [name, ms] of byProject) {
    // Idempotency: this script has no natural key in the DB, so re-running it
    // would otherwise duplicate every project. Match on (name, category).
    const [dupe] = await db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(and(eq(projectsTable.name, name), eq(projectsTable.category, CATEGORY)));
    if (dupe) {
      console.log(`  skip  #${dupe.id}  ${name}  (already imported)`);
      skipped++;
      continue;
    }

    // One transaction per project: a project with no milestones is worse than
    // no project at all, since the next run would skip it as already-imported.
    const projectId = await db.transaction(async (tx) => {
      const [project] = await tx
        .insert(projectsTable)
        .values({
          name: name.slice(0, 300),
          description: "",
          startDate: min(ms.map((m) => m.planStart)) ?? undefined,
          endDate: max(ms.map((m) => m.planEnd)) ?? undefined,
          stage: "initiation",
          category: CATEGORY,
        })
        .returning();

      await tx.insert(milestonesTable).values(
        ms.map((m, i) => ({
          projectId: project.id,
          name: m.milestone.slice(0, 300),
          // Keep the words that were typed into the date cells.
          description: [m.actualStart.note, m.actualEnd.note].filter(Boolean).join(" / "),
          startDate: m.planStart,
          dueDate: m.planEnd,
          actualStart: m.actualStart.date,
          actualEnd: m.actualEnd.date,
          status: statusOf(m),
          order: i,
        })),
      );
      return project.id;
    });

    if (GATES) {
      try {
        await generateGateMilestones(projectId);
      } catch (e) {
        console.error(`  gate milestones failed (${name}):`, (e as Error).message);
      }
    }

    created.push(projectId);
    console.log(`  #${projectId}  ${name}  (${ms.length} milestones)`);
  }

  console.log(`\ncreated ${created.length} projects under ${CATEGORY}${skipped ? `, skipped ${skipped} already present` : ""}`);
  if (created.length) console.log(`undo: delete from pmo_projects where id in (${created.join(",")});`);
  process.exit(0);
})();
