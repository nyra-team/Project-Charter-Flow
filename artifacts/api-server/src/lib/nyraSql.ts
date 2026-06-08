/**
 * NYRA text-to-SQL plumbing for the Ask-NYRA analyst.
 *
 * The Project Hub DB (the shared Recruit Supabase project) also holds recruit /
 * candidate PII tables. NYRA must only ever touch the `pmo_` portfolio tables,
 * so every LLM-authored query is run through three gates:
 *   1. assertReadOnlySelect  — single statement, SELECT/WITH only, no DML/DDL.
 *   2. assertPmoTablesOnly   — every FROM/JOIN target must be a `pmo_` table
 *                              (or a CTE/subquery), blocking reads of jobs,
 *                              applications, candidate profiles, etc.
 *   3. runReadOnly           — executed inside a READ ONLY tx with a statement
 *                              timeout and rolled back, against the shared pool.
 */
import { pool } from "@workspace/db";

export const MAX_SQL_ROWS = 1000;

// Core portfolio tables exposed to NYRA in the schema docs. (Introspected for
// live columns; the rest of the 60+ pmo_ tables stay reachable via the
// pmo_-only guard but aren't advertised, to keep the prompt focused.)
const EXPOSED_TABLES = [
  "pmo_projects",
  "pmo_milestones",
  "pmo_tasks",
  "pmo_project_stages",
  "pmo_risks",
  "pmo_issues",
  "pmo_charters",
  "pmo_pifs",
  "pmo_users",
  "pmo_portfolios",
  "pmo_programs",
  "pmo_approvals",
  "pmo_budget_lines",
  "pmo_change_requests",
  "pmo_meetings",
  "pmo_vendors",
  "pmo_role_directory",
  "pmo_stage_slas",
];

const WRITE_KEYWORDS =
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY|VACUUM|MERGE|CALL|DO|REINDEX|REFRESH|COMMENT|SECURITY|pg_sleep|pg_read_file|pg_ls_dir|lo_import|lo_export|dblink|set_config)\b/i;

/** Validate that `sql` is a single, read-only SELECT (CTEs allowed). */
function assertReadOnlySelect(sql: string): string {
  let s = sql.trim().replace(/;+\s*$/, "");
  if (!s) throw new Error("empty query");
  if (s.includes(";")) throw new Error("only a single statement is allowed");
  if (!/^(SELECT|WITH)\b/i.test(s)) throw new Error("query must start with SELECT or WITH");
  if (WRITE_KEYWORDS.test(s)) throw new Error("only read-only SELECT queries are allowed");
  if (!/\blimit\s+\d+/i.test(s)) s += ` LIMIT ${MAX_SQL_ROWS}`;
  return s;
}

/**
 * Reject any query whose FROM/JOIN targets a non-`pmo_` base table. CTE names
 * declared in a leading WITH are whitelisted; subqueries `( ... )` are skipped.
 * This keeps NYRA inside the project-portfolio schema and out of recruit PII.
 */
function assertPmoTablesOnly(sql: string): void {
  const ctes = new Set<string>();
  for (const m of sql.matchAll(/(?:\bwith\b|,)\s+"?([a-z_][\w$]*)"?\s+as\s*\(/gi)) {
    ctes.add(m[1].toLowerCase());
  }
  // Capture FROM/JOIN targets: optional `schema.`, optional quotes. Skip when a
  // subquery `(` follows instead of an identifier.
  const re = /\b(?:from|join)\s+(?!\()(?:"?([a-z_][\w$]*)"?\.)?"?([a-z_][\w$]*)"?/gi;
  for (const m of sql.matchAll(re)) {
    const ident = (m[2] || "").toLowerCase();
    if (!ident) continue;
    if (ctes.has(ident)) continue; // a CTE reference, fine
    if (!ident.startsWith("pmo_")) {
      throw new Error(
        `table "${ident}" is not accessible — NYRA may only query pmo_* project-portfolio tables`,
      );
    }
  }
}

async function runReadOnly(
  finalSql: string,
): Promise<{ columns: string[]; rows: Record<string, unknown>[] }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET TRANSACTION READ ONLY");
    await client.query("SET LOCAL statement_timeout = 12000");
    const res = await client.query(finalSql);
    await client.query("ROLLBACK");
    return { columns: res.fields.map((f) => f.name), rows: res.rows.slice(0, MAX_SQL_ROWS) };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
}

/** Run an LLM-authored query (read-only, pmo_-tables only). */
export async function runNyraSql(
  sql: string,
): Promise<{ columns: string[]; rows: Record<string, unknown>[]; effectiveSql: string }> {
  const effectiveSql = assertReadOnlySelect(sql);
  assertPmoTablesOnly(effectiveSql);
  const { columns, rows } = await runReadOnly(effectiveSql);
  return { columns, rows, effectiveSql };
}

let _schemaCache: { at: number; doc: string } | null = null;

/** Human-readable schema docs handed to the model so it writes valid SQL. */
export async function getNyraSchemaDocs(): Promise<string> {
  if (_schemaCache && Date.now() - _schemaCache.at < 5 * 60_000) return _schemaCache.doc;

  let tableDocs = "";
  try {
    const { rows } = await pool.query<{ table_name: string; column_name: string; data_type: string }>(
      `SELECT table_name, column_name, data_type
         FROM information_schema.columns
        WHERE table_schema='public' AND table_name = ANY($1)
        ORDER BY table_name, ordinal_position`,
      [EXPOSED_TABLES],
    );
    const byTable = new Map<string, string[]>();
    for (const r of rows) {
      if (!byTable.has(r.table_name)) byTable.set(r.table_name, []);
      byTable.get(r.table_name)!.push(`${r.column_name} ${r.data_type}`);
    }
    // Preserve EXPOSED_TABLES order, skip any missing.
    tableDocs = EXPOSED_TABLES.filter((t) => byTable.has(t))
      .map((t) => `  ${t}(${byTable.get(t)!.join(", ")})`)
      .join("\n");
  } catch {
    tableDocs = "(schema introspection unavailable)";
  }

  const doc = [
    "SOURCE — Granules Project Hub (PMO) portfolio. PostgreSQL, public schema. Query these tables directly (SELECT or WITH; you may JOIN across them):",
    tableDocs,
    "",
    "KEY RELATIONSHIPS:",
    "  pmo_projects.id = pmo_milestones.project_id = pmo_tasks.project_id = pmo_project_stages.project_id = pmo_risks.project_id = pmo_issues.project_id = pmo_change_requests.project_id.",
    "  pmo_projects.project_manager_id = pmo_users.id (the PM). pmo_projects.portfolio_id = pmo_portfolios.id. pmo_milestones.id = pmo_tasks.milestone_id.",
    "  pmo_tasks.assignee_id / owner_id and pmo_users.id resolve task owners; pmo_users has name + email + role.",
    "",
    "ENUMS / STATUS VALUES (use exact spelling — a wrong value silently returns 0 rows):",
    "  pmo_projects.rag_status: 'green' | 'amber' | 'red'.  pmo_projects.status: 'planning' | 'active' | 'completed'.",
    "  pmo_projects.stage: 'project_case' | 'initiation' | 'urs' | 'development' | 'execution' | 'go_live' | 'closure_readiness' (lifecycle order). progress is a 0-100 percentage.",
    "  pmo_tasks.status: 'not_started' | 'in_progress' | 'completed' | 'on_hold' | 'delayed'.",
    "  pmo_milestones.status: 'not_started' | 'in_progress' | 'completed'.",
    "  pmo_project_stages.status: 'in_progress' | 'completed'.  pmo_risks.status: 'open' | 'mitigating' | (closed).",
    "  pmo_charters.status: 'draft' | 'submitted' | 'approved' | 'active'.",
    "",
    "GUIDANCE: A task/milestone is OVERDUE when status <> 'completed' AND due_date < CURRENT_DATE. For 'at risk' projects use rag_status IN ('amber','red'). Prefer aggregates (COUNT / SUM / GROUP BY) and add ORDER BY + LIMIT for 'top N'. Date columns are timestamps — compare with CURRENT_DATE / now(). You may ONLY read pmo_* tables.",
  ].join("\n");

  _schemaCache = { at: Date.now(), doc };
  return doc;
}
