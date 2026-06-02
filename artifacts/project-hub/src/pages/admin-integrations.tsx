import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/context";
import { useToast } from "@/hooks/use-toast";
import {
  Plug, CheckCircle2, XCircle, Loader2, Edit2, Trash2, Plus, Database, Cable, Server,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

type IntegrationRow = {
  id: number;
  kind: string;
  name: string;
  config: Record<string, unknown>;
  secretKeys: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

type FieldType = "text" | "password" | "select";

type IntegrationField = {
  key: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  required?: boolean;
  options?: string[];           // for type:"select"
  defaultValue?: string;        // applied at create time when blank
  // Conditional render: show this field only when another field's value
  // matches one of the listed strings. Used for e.g. "show authHeaderName
  // only when authStyle === 'header'".
  showWhen?: { field: string; equals: string[] };
  help?: string;                // small caption under the input
};

type IntegrationCategory = "mcp" | "datasource";

type IntegrationKind = {
  value: string;
  label: string;
  description: string;
  category: IntegrationCategory;
  implemented: boolean;
  fields: IntegrationField[];
  defaultSecretKeys: string[];
};

const CATEGORIES: Record<IntegrationCategory, { label: string; icon: typeof Cable; blurb: string }> = {
  mcp: {
    label: "MCP Connectors",
    icon: Cable,
    blurb: "External apps the org connects to via Model Context Protocol or vendor REST APIs.",
  },
  datasource: {
    label: "Data Sources",
    icon: Database,
    blurb: "Read-only endpoints that PMO surfaces / synchronises from (databases, REST feeds).",
  },
};

// ─── Kinds ──────────────────────────────────────────────────────────────────
//
// Each kind's `fields` array drives the editor modal directly — no per-kind
// switch statements. Keep field `key` names aligned with the backend Config
// interfaces in apps/pmo/artifacts/api-server/src/lib/integrations/* so the
// POST/PUT body lands as the backend's tester expects it.

const KINDS: IntegrationKind[] = [
  // ── MCP Connectors ────────────────────────────────────────────────────
  {
    value: "mcp_http",
    label: "MCP Server (HTTP)",
    description: "Any MCP-spec HTTP server. Endpoint + optional bearer / custom-header auth.",
    category: "mcp",
    implemented: true,
    defaultSecretKeys: ["authToken"],
    fields: [
      { key: "endpoint", label: "Endpoint URL", type: "text", placeholder: "https://mcp.example.com/mcp", required: true },
      {
        key: "authStyle", label: "Auth Style", type: "select",
        options: ["none", "bearer", "header"], defaultValue: "none",
      },
      {
        key: "authHeaderName", label: "Header Name", type: "text", placeholder: "X-API-Key",
        showWhen: { field: "authStyle", equals: ["header"] },
        help: "Only used when auth style is 'header'.",
      },
      {
        key: "authToken", label: "Auth Token", type: "password",
        showWhen: { field: "authStyle", equals: ["bearer", "header"] },
      },
    ],
  },
  {
    value: "jira",
    label: "Jira / Confluence",
    description: "Atlassian Cloud — issues, projects, comments via REST v3.",
    category: "mcp",
    implemented: true,
    defaultSecretKeys: ["apiToken"],
    fields: [
      { key: "baseUrl", label: "Base URL", type: "text", placeholder: "https://granules.atlassian.net", required: true },
      { key: "email", label: "Service Account Email", type: "text", placeholder: "pmo-bot@granulesindia.com", required: true },
      { key: "apiToken", label: "API Token", type: "password", placeholder: "ATAT…", required: true },
      { key: "projectKey", label: "Default Project Key (optional)", type: "text", placeholder: "PMO" },
    ],
  },
  {
    value: "github",
    label: "GitHub",
    description: "Repos / issues / PRs — placeholder, not yet wired.",
    category: "mcp",
    implemented: false,
    defaultSecretKeys: ["personalAccessToken"],
    fields: [
      { key: "organization", label: "Organization / Owner", type: "text", required: true },
      { key: "personalAccessToken", label: "Personal Access Token", type: "password", required: true },
    ],
  },
  {
    value: "streamliner",
    label: "Streamliner",
    description: "Placeholder — share docs and we'll wire it in.",
    category: "mcp",
    implemented: false,
    defaultSecretKeys: ["apiKey"],
    fields: [
      { key: "baseUrl", label: "Base URL", type: "text", required: true },
      { key: "apiKey", label: "API Key", type: "password", required: true },
    ],
  },

  // ── Data Sources ──────────────────────────────────────────────────────
  {
    value: "supabase",
    label: "Supabase Project",
    description: "Supabase REST API — project URL + service-role key (or anon key) + optional schema.",
    category: "datasource",
    implemented: true,
    defaultSecretKeys: ["serviceRoleKey"],
    fields: [
      { key: "projectUrl", label: "Project URL", type: "text", placeholder: "https://xxxxxxxx.supabase.co", required: true },
      { key: "serviceRoleKey", label: "Service Role Key", type: "password", placeholder: "sb_secret_…", required: true },
      { key: "schema", label: "Schema (optional)", type: "text", placeholder: "public" },
    ],
  },
  {
    value: "http_api",
    label: "HTTP API",
    description: "Generic REST endpoint — bearer / basic / custom-header auth.",
    category: "datasource",
    implemented: true,
    defaultSecretKeys: ["authToken"],
    fields: [
      { key: "url", label: "URL", type: "text", placeholder: "https://api.example.com/v1/health", required: true },
      {
        key: "method", label: "Method", type: "select",
        options: ["GET", "POST", "HEAD"], defaultValue: "GET",
      },
      {
        key: "authStyle", label: "Auth Style", type: "select",
        options: ["none", "bearer", "basic", "header"], defaultValue: "none",
      },
      {
        key: "authUser", label: "Basic Auth User", type: "text",
        showWhen: { field: "authStyle", equals: ["basic"] },
      },
      {
        key: "authHeaderName", label: "Header Name", type: "text", placeholder: "X-API-Key",
        showWhen: { field: "authStyle", equals: ["header"] },
      },
      {
        key: "authToken", label: "Token / Password / Header Value", type: "password",
        showWhen: { field: "authStyle", equals: ["bearer", "basic", "header"] },
      },
      { key: "expectedStatus", label: "Expected Status (blank → any 2xx)", type: "text", placeholder: "200" },
    ],
  },
  {
    value: "postgres",
    label: "PostgreSQL (direct)",
    description: "Direct Postgres connection — accepts secrets but tester not wired (no pg driver in api-server yet).",
    category: "datasource",
    implemented: false,
    defaultSecretKeys: ["password"],
    fields: [
      { key: "host", label: "Host", type: "text", placeholder: "db.example.com", required: true },
      { key: "port", label: "Port", type: "text", placeholder: "5432", defaultValue: "5432" },
      { key: "database", label: "Database", type: "text", required: true },
      { key: "user", label: "User", type: "text", required: true },
      { key: "password", label: "Password", type: "password", required: true },
    ],
  },
];

function findKind(value: string): IntegrationKind | undefined {
  return KINDS.find((k) => k.value === value);
}

function categoryIcon(cat: IntegrationCategory) {
  return cat === "datasource" ? Database : Cable;
}

// ─── API helpers ────────────────────────────────────────────────────────────

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (res.status === 204) return undefined as unknown as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return body as T;
}

// Per-kind shaping of the /test response into a short friendly status line
// for the toast. Keeps the tester libs free to return whatever shape they
// want from the wire — we adapt at the UI layer.
function summarizeTestResult(kind: string, details: unknown): string {
  const d = (details ?? {}) as Record<string, unknown>;
  if (kind === "jira") {
    const name = d.displayName as string | undefined;
    const email = d.emailAddress as string | undefined;
    return name ? `Authenticated as ${name}${email ? ` (${email})` : ""}` : "Credentials accepted";
  }
  if (kind === "mcp_http") {
    const protocol = d.protocolVersion as string | undefined;
    const tools = (d.tools as unknown[] | undefined)?.length;
    return [
      protocol ? `MCP ${protocol}` : null,
      tools != null ? `${tools} tool${tools === 1 ? "" : "s"} available` : null,
    ].filter(Boolean).join(" · ") || "Endpoint reachable";
  }
  if (kind === "supabase") {
    const schema = d.schema as string | undefined;
    const tables = (d.tables as unknown[] | undefined)?.length;
    return `Connected${schema ? ` (schema=${schema})` : ""}${tables != null ? ` · ${tables} tables visible` : ""}`;
  }
  if (kind === "http_api") {
    const status = d.status as number | undefined;
    const latency = d.latencyMs as number | undefined;
    return [
      status != null ? `HTTP ${status}` : null,
      latency != null ? `${latency} ms` : null,
    ].filter(Boolean).join(" · ") || "Endpoint reachable";
  }
  return "Credentials accepted";
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function AdminIntegrationsPage() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const isAdmin = !!(profile?.is_super_admin || profile?.pmo_role === "admin");

  const [rows, setRows] = useState<IntegrationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<{ mode: "create" | "edit"; row?: IntegrationRow; defaultKind?: string } | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const data = await jsonFetch<IntegrationRow[]>("/api/admin/integrations");
      setRows(data);
    } catch (err) {
      toast({ title: "Failed to load integrations", description: (err as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (isAdmin) void refresh(); /* eslint-disable-next-line */ }, [isAdmin]);

  async function handleDelete(row: IntegrationRow) {
    if (!confirm(`Delete integration "${row.name}"?`)) return;
    try {
      await jsonFetch<void>(`/api/admin/integrations/${row.id}`, { method: "DELETE" });
      toast({ title: "Deleted" });
      await refresh();
    } catch (err) {
      toast({ title: "Delete failed", description: (err as Error).message, variant: "destructive" });
    }
  }

  async function handleToggleEnabled(row: IntegrationRow) {
    try {
      await jsonFetch<IntegrationRow>(`/api/admin/integrations/${row.id}`, {
        method: "PUT",
        body: JSON.stringify({ enabled: !row.enabled }),
      });
      await refresh();
    } catch (err) {
      toast({ title: "Update failed", description: (err as Error).message, variant: "destructive" });
    }
  }

  async function handleTest(row: IntegrationRow) {
    try {
      const result = await jsonFetch<{ ok: boolean; details?: unknown }>(
        `/api/admin/integrations/${row.id}/test`,
        { method: "POST" },
      );
      toast({ title: "Connection OK", description: summarizeTestResult(row.kind, result.details) });
    } catch (err) {
      toast({ title: "Connection failed", description: (err as Error).message, variant: "destructive" });
    }
  }

  // Group rows by category for the list view. Unknown kinds fall back to
  // "mcp" so a future kind added on the backend before the frontend KINDS
  // catalogue is updated still renders somewhere instead of vanishing.
  const grouped = useMemo(() => {
    const byCategory: Record<IntegrationCategory, IntegrationRow[]> = { mcp: [], datasource: [] };
    for (const row of rows) {
      const cat = findKind(row.kind)?.category ?? "mcp";
      byCategory[cat].push(row);
    }
    return byCategory;
  }, [rows]);

  if (!isAdmin) {
    return (
      <div className="p-8 max-w-2xl">
        <p className="text-sm text-muted-foreground">You need PMO admin role to manage integrations.</p>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-5xl space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Plug size={20} className="text-primary" />
            <h1 className="text-xl font-heading font-bold">MCP &amp; Data Source Connectors</h1>
          </div>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Configure org-wide connections — MCP servers, vendor APIs (Jira, GitHub, Streamliner) and read-only data sources
            (Supabase, REST endpoints, Postgres). Credentials are stored server-side; the UI never echoes secrets back.
          </p>
        </div>
        <button
          onClick={() => setEditor({ mode: "create" })}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
        >
          <Plus size={16} /> Add connector
        </button>
      </header>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      ) : (
        (["mcp", "datasource"] as IntegrationCategory[]).map((cat) => {
          const items = grouped[cat];
          const CatIcon = CATEGORIES[cat].icon;
          return (
            <section key={cat} className="space-y-3">
              <div className="flex items-end justify-between gap-3 border-b border-border/60 pb-2">
                <div>
                  <h2 className="text-sm font-heading font-semibold flex items-center gap-1.5">
                    <CatIcon size={14} className="text-primary" />
                    {CATEGORIES[cat].label}
                    <span className="text-[11px] font-mono text-muted-foreground">· {items.length}</span>
                  </h2>
                  <p className="text-[12px] text-muted-foreground mt-0.5">{CATEGORIES[cat].blurb}</p>
                </div>
                <button
                  onClick={() => setEditor({ mode: "create", defaultKind: cat === "mcp" ? "mcp_http" : "supabase" })}
                  className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                >
                  <Plus size={12} /> Add {CATEGORIES[cat].label.replace(/s$/, "")}
                </button>
              </div>

              {items.length === 0 ? (
                <div className="border border-dashed border-border rounded-xl p-6 text-center text-xs text-muted-foreground">
                  No {CATEGORIES[cat].label.toLowerCase()} configured yet.
                </div>
              ) : (
                <div className="border border-border rounded-xl divide-y divide-border bg-card">
                  {items.map((row) => {
                    const kindDef = findKind(row.kind);
                    const primarySummary =
                      (row.config as Record<string, unknown>).baseUrl ??
                      (row.config as Record<string, unknown>).endpoint ??
                      (row.config as Record<string, unknown>).projectUrl ??
                      (row.config as Record<string, unknown>).url ??
                      (row.config as Record<string, unknown>).organization ??
                      (row.config as Record<string, unknown>).host ??
                      "—";
                    return (
                      <div key={row.id} className="p-4 flex items-center gap-4">
                        <Server size={18} className="text-muted-foreground/70 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className="text-sm font-semibold text-foreground truncate">{row.name}</span>
                            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                              {kindDef?.label ?? row.kind}
                            </span>
                            {!kindDef?.implemented && (
                              <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-warn/10 text-warn">
                                Coming soon
                              </span>
                            )}
                            {row.enabled ? (
                              <span className="text-[10px] inline-flex items-center gap-1 text-success">
                                <CheckCircle2 size={12} /> Enabled
                              </span>
                            ) : (
                              <span className="text-[10px] inline-flex items-center gap-1 text-muted-foreground">
                                <XCircle size={12} /> Disabled
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground truncate font-mono">{String(primarySummary)}</p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => void handleTest(row)}
                            disabled={!kindDef?.implemented}
                            title={kindDef?.implemented ? "Test connection" : "Tester not implemented yet"}
                            className="px-2.5 py-1.5 text-xs font-medium rounded-md border border-border hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            Test
                          </button>
                          <button
                            onClick={() => void handleToggleEnabled(row)}
                            className="px-2.5 py-1.5 text-xs font-medium rounded-md border border-border hover:bg-muted"
                          >
                            {row.enabled ? "Disable" : "Enable"}
                          </button>
                          <button
                            onClick={() => setEditor({ mode: "edit", row })}
                            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground"
                            title="Edit"
                          >
                            <Edit2 size={14} />
                          </button>
                          <button
                            onClick={() => void handleDelete(row)}
                            className="p-1.5 rounded-md hover:bg-destructive/10 text-destructive"
                            title="Delete"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })
      )}

      {editor && (
        <EditorModal
          mode={editor.mode}
          row={editor.row}
          defaultKind={editor.defaultKind}
          onClose={() => setEditor(null)}
          onSaved={async () => { setEditor(null); await refresh(); }}
        />
      )}
    </div>
  );
}

// ─── Editor modal ───────────────────────────────────────────────────────────

function EditorModal({
  mode, row, defaultKind, onClose, onSaved,
}: {
  mode: "create" | "edit";
  row?: IntegrationRow;
  defaultKind?: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { toast } = useToast();
  const initialKind = row?.kind ?? defaultKind ?? "mcp_http";
  const [kind, setKind] = useState(initialKind);
  const kindDef = findKind(kind);
  const [name, setName] = useState(row?.name ?? "");
  const [config, setConfig] = useState<Record<string, string>>(
    () => Object.fromEntries(Object.entries(row?.config ?? {}).map(([k, v]) => [k, String(v ?? "")])),
  );
  const [saving, setSaving] = useState(false);

  // When kind changes in create mode, reset config but seed any field
  // defaultValues so the auth-style dropdown starts at "none" etc.
  useEffect(() => {
    if (mode === "create") {
      const def = findKind(kind);
      const seeded: Record<string, string> = {};
      for (const f of def?.fields ?? []) {
        if (f.defaultValue != null) seeded[f.key] = f.defaultValue;
      }
      setConfig(seeded);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  // Conditional field gating — a field with showWhen renders only when the
  // referenced field's current value matches one of the allowed values.
  function isFieldVisible(f: IntegrationField): boolean {
    if (!f.showWhen) return true;
    const current = config[f.showWhen.field] ?? "";
    return f.showWhen.equals.includes(current);
  }

  async function handleSave() {
    if (!kindDef) return;
    if (!kindDef.implemented) {
      toast({
        title: "Not implemented yet",
        description: `Tester for ${kindDef.label} is coming soon. The config will be saved but Test will return 501.`,
      });
    }
    // Validate required fields, but only ones currently visible (so a
    // hidden 'authToken' under authStyle=none isn't flagged).
    const missing = (kindDef.fields)
      .filter((f) => f.required && isFieldVisible(f) && !config[f.key]?.trim())
      .map((f) => f.label);
    if (missing.length > 0) {
      toast({ title: "Missing required fields", description: missing.join(", "), variant: "destructive" });
      return;
    }

    // Strip hidden-field values from the saved config — keeps the row tidy
    // and avoids stale e.g. `authHeaderName` after toggling authStyle.
    const cleanConfig: Record<string, string> = {};
    for (const f of kindDef.fields) {
      if (isFieldVisible(f) && (config[f.key] ?? "") !== "") {
        cleanConfig[f.key] = config[f.key];
      }
    }

    setSaving(true);
    try {
      if (mode === "create") {
        await jsonFetch<IntegrationRow>("/api/admin/integrations", {
          method: "POST",
          body: JSON.stringify({
            kind,
            name: name.trim() || kindDef.label,
            config: cleanConfig,
            secretKeys: kindDef.defaultSecretKeys,
            enabled: true,
          }),
        });
      } else if (row) {
        await jsonFetch<IntegrationRow>(`/api/admin/integrations/${row.id}`, {
          method: "PUT",
          body: JSON.stringify({ name: name.trim() || row.name, config: cleanConfig }),
        });
      }
      toast({ title: mode === "create" ? "Connector added" : "Connector updated" });
      await onSaved();
    } catch (err) {
      toast({ title: "Save failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  // Group dropdown options by category so the picker tells the same MCP / DS story.
  const kindGroups = useMemo(() => {
    return (["mcp", "datasource"] as IntegrationCategory[]).map((cat) => ({
      cat,
      label: CATEGORIES[cat].label,
      items: KINDS.filter((k) => k.category === cat),
    }));
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-card text-card-foreground rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="p-5 border-b border-border">
          <h2 className="text-base font-heading font-semibold">
            {mode === "create" ? "Add connector" : "Edit connector"}
          </h2>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1">Kind</label>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              disabled={mode === "edit"}
              className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-card disabled:opacity-50"
            >
              {kindGroups.map((group) => (
                <optgroup key={group.cat} label={group.label}>
                  {group.items.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}{k.implemented ? "" : " — coming soon"}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            {kindDef && <p className="mt-1 text-[11px] text-muted-foreground">{kindDef.description}</p>}
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1">Display Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={kindDef ? `e.g. Granules ${kindDef.label}` : ""}
              className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-card focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {kindDef?.fields.filter(isFieldVisible).map((field) => (
            <div key={field.key}>
              <label className="block text-xs font-semibold text-muted-foreground mb-1">
                {field.label}{field.required ? <span className="text-destructive ml-0.5">*</span> : null}
              </label>
              {field.type === "select" ? (
                <select
                  value={config[field.key] ?? field.defaultValue ?? ""}
                  onChange={(e) => setConfig((c) => ({ ...c, [field.key]: e.target.value }))}
                  className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-card focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  {(field.options ?? []).map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              ) : (
                <input
                  type={field.type}
                  value={config[field.key] ?? ""}
                  onChange={(e) => setConfig((c) => ({ ...c, [field.key]: e.target.value }))}
                  placeholder={field.placeholder}
                  className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-card focus:outline-none focus:ring-1 focus:ring-primary"
                  autoComplete={field.type === "password" ? "new-password" : "off"}
                />
              )}
              {field.help && <p className="mt-1 text-[11px] text-muted-foreground">{field.help}</p>}
              {field.type === "password" && mode === "edit" && config[field.key] === "***" && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Stored token kept as-is. Replace this field to rotate.
                </p>
              )}
            </div>
          ))}
        </div>
        <div className="p-5 border-t border-border flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-3 py-2 text-sm font-medium rounded-md border border-border hover:bg-muted"
          >
            Cancel
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            className="px-3 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center gap-1.5"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : null}
            {saving ? "Saving…" : mode === "create" ? "Add" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
