import { Router, type IRouter } from "express";
import { db, mcpIntegrationsTable, type McpIntegration } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { requireAdmin } from "../../middlewares/requireAuth";
import { jiraTestConnection, type JiraConfig } from "../../lib/integrations/jira";
import { mcpHttpTestConnection, type McpHttpConfig } from "../../lib/integrations/mcp_http";
import { supabaseTestConnection, type SupabaseConfig } from "../../lib/integrations/supabase";
import { httpApiTestConnection, type HttpApiConfig } from "../../lib/integrations/http_api";
import { getMcpActivity } from "../../lib/mcpActivity";

const router: IRouter = Router();

// Every route below requires PMO admin (super_admin OR pmo_role='admin').
router.use(requireAdmin);

// SUPPORTED_KINDS is the union of (a) the original MCP-style integrations
// and (b) the data-source kinds introduced by the connectors popup. The
// JSONB `config` shape varies per kind and is owned by the tester helpers
// below — the table itself stays kind-agnostic.
const SUPPORTED_KINDS = new Set([
  // Pre-existing MCP integrations
  "jira", "github", "streamliner",
  // New MCP connector kind
  "mcp_http",
  // New data-source kinds
  "supabase", "http_api", "postgres",
]);
const IMPLEMENTED_KINDS = new Set([
  "jira",
  "mcp_http",
  "supabase",
  "http_api",
  // postgres is intentionally absent — no pg driver is bundled with the
  // api-server today, so we accept the row + secrets but the /test endpoint
  // returns 501 with a helpful message. Wire when pg is added.
]);

/**
 * Mask secret fields before serializing an integration to the wire.
 * Replaces every value at `secret_keys[*]` in `config` with "***" so the
 * admin UI can still see the row exists / what fields are populated,
 * without ever leaking the live credential.
 */
function maskSecrets(row: McpIntegration): McpIntegration {
  if (!row.secretKeys?.length) return row;
  const cfg = { ...(row.config as Record<string, unknown>) };
  for (const key of row.secretKeys) {
    if (cfg[key] !== undefined && cfg[key] !== null && cfg[key] !== "") {
      cfg[key] = "***";
    }
  }
  return { ...row, config: cfg };
}

function serialize(row: McpIntegration) {
  const masked = maskSecrets(row);
  return {
    ...masked,
    createdAt: masked.createdAt instanceof Date ? masked.createdAt.toISOString() : masked.createdAt,
    updatedAt: masked.updatedAt instanceof Date ? masked.updatedAt.toISOString() : masked.updatedAt,
  };
}

router.get("/", async (_req, res): Promise<void> => {
  const rows = await db.select().from(mcpIntegrationsTable).orderBy(asc(mcpIntegrationsTable.id));
  res.json(rows.map(serialize));
});

// GET /api/admin/integrations/mcp-status — inbound PMO MCP (service-token act-as)
// status + live write activity. No secret is ever returned.
router.get("/mcp-status", (_req, res): void => {
  const enabled = !!process.env["PMO_MCP_TOKEN"];
  const allow = (process.env["PMO_MCP_ACTORS"] || "").split(",").map((s) => s.trim()).filter(Boolean);
  const wildcard = allow.includes("*");
  res.json({
    enabled,
    actorAllowlist: wildcard ? "any PMO-enabled employee" : allow,
    ...getMcpActivity(),
  });
});

router.post("/", async (req, res): Promise<void> => {
  const { kind, name, config, secretKeys, enabled } = (req.body ?? {}) as {
    kind?: string; name?: string; config?: Record<string, unknown>;
    secretKeys?: string[]; enabled?: boolean;
  };
  if (!kind || !SUPPORTED_KINDS.has(kind)) {
    res.status(400).json({ error: `kind must be one of: ${[...SUPPORTED_KINDS].join(", ")}` });
    return;
  }
  if (!name || !name.trim()) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  const [row] = await db
    .insert(mcpIntegrationsTable)
    .values({
      kind,
      name: name.trim(),
      config: config ?? {},
      secretKeys: secretKeys ?? defaultSecretKeysForKind(kind),
      enabled: enabled ?? true,
      // We don't have a numeric pmo_users.id for the caller here; the
      // auto-provisioned row from /api/users/me carries it, but mapping
      // master-DB → local users isn't done in this scope. Leave null;
      // the audit trail can be enriched in a follow-up.
      createdById: null,
    })
    .returning();
  res.status(201).json(serialize(row));
});

router.put("/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db.select().from(mcpIntegrationsTable).where(eq(mcpIntegrationsTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  const { name, config, secretKeys, enabled } = (req.body ?? {}) as {
    name?: string; config?: Record<string, unknown>;
    secretKeys?: string[]; enabled?: boolean;
  };

  // Preserve secret values that came back masked ("***") from the UI —
  // a PUT with config.apiToken="***" means "don't change the token",
  // not "set the literal string ***".
  let mergedConfig = existing.config as Record<string, unknown>;
  if (config !== undefined) {
    const incoming = { ...config };
    for (const key of existing.secretKeys ?? []) {
      if (incoming[key] === "***") {
        incoming[key] = (existing.config as Record<string, unknown>)[key];
      }
    }
    mergedConfig = { ...mergedConfig, ...incoming };
  }

  const [row] = await db
    .update(mcpIntegrationsTable)
    .set({
      ...(name !== undefined ? { name: name.trim() } : {}),
      config: mergedConfig,
      ...(secretKeys !== undefined ? { secretKeys } : {}),
      ...(enabled !== undefined ? { enabled } : {}),
      updatedAt: new Date(),
    })
    .where(eq(mcpIntegrationsTable.id, id))
    .returning();
  res.json(serialize(row));
});

router.delete("/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const deleted = await db.delete(mcpIntegrationsTable).where(eq(mcpIntegrationsTable.id, id)).returning();
  if (deleted.length === 0) { res.status(404).json({ error: "Not found" }); return; }
  res.status(204).end();
});

/**
 * POST /:id/test — exercise the per-kind connection tester against the
 * STORED credential. The UI also calls this after a fresh save so the
 * admin gets immediate feedback that the secret they pasted actually
 * authenticates.
 */
router.post("/:id/test", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [row] = await db.select().from(mcpIntegrationsTable).where(eq(mcpIntegrationsTable.id, id)).limit(1);
  if (!row) { res.status(404).json({ error: "Not found" }); return; }

  if (!IMPLEMENTED_KINDS.has(row.kind)) {
    res.status(501).json({ error: `Test for kind '${row.kind}' is not yet implemented` });
    return;
  }

  try {
    if (row.kind === "jira") {
      const me = await jiraTestConnection(row.config as JiraConfig);
      res.json({ ok: true, kind: row.kind, details: me });
      return;
    }
    if (row.kind === "mcp_http") {
      const info = await mcpHttpTestConnection(row.config as McpHttpConfig);
      res.json({ ok: true, kind: row.kind, details: info });
      return;
    }
    if (row.kind === "supabase") {
      const info = await supabaseTestConnection(row.config as SupabaseConfig);
      res.json({ ok: true, kind: row.kind, details: info });
      return;
    }
    if (row.kind === "http_api") {
      const info = await httpApiTestConnection(row.config as HttpApiConfig);
      res.json({ ok: true, kind: row.kind, details: info });
      return;
    }
    res.status(501).json({ error: "No tester wired for this kind" });
  } catch (err) {
    res.status(400).json({ ok: false, kind: row.kind, error: (err as Error).message });
  }
});

function defaultSecretKeysForKind(kind: string): string[] {
  switch (kind) {
    case "jira":        return ["apiToken"];
    case "github":      return ["personalAccessToken"];
    case "streamliner": return ["apiKey"];
    case "mcp_http":    return ["authToken"];
    case "supabase":    return ["serviceRoleKey"];
    case "http_api":    return ["authToken"];
    case "postgres":    return ["password"];
    default:            return [];
  }
}

export default router;
