/**
 * approvalsAudit.ts
 *
 * Audit trail for /admin/roles edits through the suite's generic approval
 * engine (backend/shared/approvals — the same engine PMS runs on, writing
 * approval_requests / approval_steps / approval_events in the Recruit DB).
 *
 * Per product decision the RBAC page applies changes IMMEDIATELY; the
 * engine is used purely as the audit ledger. Each edit becomes a
 * single-level (app='pmo', entity_type='pmo_role_change') request whose
 * approver resolves to the editing super-admin, and is approved in the
 * same breath — so the standard approvals UIs show a complete, immutable
 * who-changed-what-when record without a pending queue.
 *
 * The engine is plain ESM JS outside this TS workspace (rootDir=src), so
 * it's loaded with a runtime dynamic import — esbuild leaves non-literal
 * import paths to Node, and the engine's own relative/bare imports resolve
 * from its real location (backend/node_modules has express).
 */
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { getMasterDb } from "./masterDb";
import type { PmoUser } from "../middlewares/requireAuth";

type ApprovalEngine = {
  registerResolver: (key: string, fn: (ctx: Record<string, unknown>) => unknown) => void;
  registerWorkflow: (app: string, entityType: string, workflow: Record<string, unknown>) => void;
  createRequest: (args: {
    app: string;
    entityType: string;
    entityId: string;
    requesterId: string;
    metadata?: Record<string, unknown>;
    comment?: string | null;
  }) => Promise<{ id: string }>;
  approve: (requestId: string, actorId: string, comment?: string) => Promise<unknown>;
};

type EngineBundle = { engine: ApprovalEngine; supabase: SupabaseClient };

let enginePromise: Promise<EngineBundle> | null = null;

/** Walk up from this bundle to the repo root and locate the shared engine. */
function findEngineEntry(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i++) {
    const candidate = path.join(dir, "backend", "shared", "approvals", "index.js");
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("backend/shared/approvals/index.js not found above " + path.dirname(fileURLToPath(import.meta.url)));
}

async function getEngine(): Promise<EngineBundle> {
  if (!enginePromise) {
    const p: Promise<EngineBundle> = (async () => {
      const url = process.env["SUPABASE_URL"];
      const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
      if (!url || !key) {
        throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (Recruit DB) must be set for the approvals audit trail");
      }
      const supabase = createClient(url, key, {
        auth: { autoRefreshToken: false, persistSession: false },
        realtime: {
          // Same Node20-no-global-WebSocket workaround as lib/masterDb.ts.
          transport: WebSocket as unknown as typeof globalThis.WebSocket,
        },
      });
      const entry = findEngineEntry();
      const mod = await import(entry) as {
        createApprovalEngine: (deps: Record<string, unknown>) => ApprovalEngine;
      };
      const engine = mod.createApprovalEngine({ supabase, masterDb: getMasterDb() });

      // The "approver" of an audit-only request is the editor themself,
      // carried in request metadata (master-DB manager resolvers don't
      // apply — the editor isn't anyone's manager here).
      engine.registerResolver("pmo_editor", (ctx) => {
        const editor = (ctx["metadata"] as Record<string, unknown> | undefined)?.["editor"] as
          | { employeeCode?: string; fullName?: string; email?: string }
          | undefined;
        if (!editor?.employeeCode) throw new Error("pmo_editor resolver: metadata.editor.employeeCode missing");
        return {
          approverId: editor.employeeCode,
          approverEmail: editor.email ?? null,
          approverName: editor.fullName ?? editor.email ?? editor.employeeCode,
        };
      });
      engine.registerWorkflow("pmo", "pmo_role_change", {
        levels: [{ resolver: "pmo_editor", label: "Recorded by" }],
      });
      return { engine, supabase: supabase as unknown as SupabaseClient };
    })();
    // Let a transient failure (env not yet set, engine moved) retry on the
    // next call instead of poisoning the singleton forever.
    p.catch(() => { if (enginePromise === p) enginePromise = null; });
    enginePromise = p;
    return p;
  }
  return enginePromise;
}

export interface RoleChangeRecord {
  editor: PmoUser;
  targetEmployeeCode: string;
  targetName: string | null;
  before: { roleOverride: string | null; effectiveRole: string; accessPmo: boolean };
  after: { roleOverride: string | null; effectiveRole: string; accessPmo: boolean };
}

/** Create + immediately approve an audit request for one role/access edit. */
export async function recordRoleChange(change: RoleChangeRecord): Promise<void> {
  const { engine } = await getEngine();
  const editorCode = change.editor.employeeCode ?? change.editor.email;
  const request = await engine.createRequest({
    app: "pmo",
    entityType: "pmo_role_change",
    entityId: change.targetEmployeeCode,
    requesterId: editorCode!,
    metadata: {
      editor: {
        employeeCode: change.editor.employeeCode,
        fullName: change.editor.fullName,
        email: change.editor.email,
      },
      target: { employeeCode: change.targetEmployeeCode, name: change.targetName },
      before: change.before,
      after: change.after,
    },
    comment: null,
  });
  await engine.approve(request.id, editorCode!, "auto-applied (audit-only RBAC workflow)");
}

/** Recent role-change audit entries for the admin UI's history panel. */
export async function getRecentRoleChanges(limit = 25): Promise<unknown[]> {
  const { supabase } = await getEngine();
  const { data, error } = await supabase
    .from("approval_requests")
    .select("id, entity_id, requester_id, status, metadata, created_at, completed_at")
    .eq("app", "pmo")
    .eq("entity_type", "pmo_role_change")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data ?? [];
}
