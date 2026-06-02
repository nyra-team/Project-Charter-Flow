/**
 * ConnectorsPopup — a self-contained admin popup that lets PMO admins
 * manage MCP connectors and data sources from anywhere in the app via a
 * top-bar icon. Hits the SAME `/api/admin/integrations` endpoints used by
 * the existing /admin/integrations page — both UIs stay in sync without
 * either having to know about the other.
 *
 * Backward-compat notes:
 *   - No new routes, no schema change, no edits to admin-integrations.tsx
 *   - Kind registry is a frontend-only grouping; backend stays kind-agnostic
 *   - Mounted alongside Layout's existing header (additive; never removes
 *     or rewires existing controls)
 */

import { useEffect, useState } from "react";
import { useAuth } from "../auth/context";
import { useToast } from "@/hooks/use-toast";
import {
  Plug, Database, CheckCircle2, XCircle, Loader2, Edit2, Trash2, Plus, X,
  Server, FileJson, FlaskConical, Github, Briefcase,
} from "lucide-react";

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

type Category = "mcp" | "data_source";

type IntegrationKind = {
  value: string;
  label: string;
  description: string;
  category: Category;
  implemented: boolean;
  icon: typeof Plug;
  fields: Array<{
    key: string;
    label: string;
    type: "text" | "password" | "select";
    placeholder?: string;
    required?: boolean;
    options?: Array<{ value: string; label: string }>;
  }>;
  defaultSecretKeys: string[];
};

const KINDS: IntegrationKind[] = [
  // MCP CONNECTORS
  {
    value: "jira",
    label: "Jira / Confluence",
    description: "Atlassian Cloud — issues, projects, comments via REST v3",
    category: "mcp",
    implemented: true,
    icon: Briefcase,
    defaultSecretKeys: ["apiToken"],
    fields: [
      { key: "baseUrl", label: "Base URL", type: "text", placeholder: "https://granules.atlassian.net", required: true },
      { key: "email", label: "Service Account Email", type: "text", placeholder: "pmo-bot@granulesindia.com", required: true },
      { key: "apiToken", label: "API Token", type: "password", placeholder: "ATAT...", required: true },
      { key: "projectKey", label: "Default Project Key (optional)", type: "text", placeholder: "PMO" },
    ],
  },
  {
    value: "mcp_http",
    label: "MCP — HTTP server",
    description: "Generic Model Context Protocol server over HTTP (JSON-RPC 2.0)",
    category: "mcp",
    implemented: true,
    icon: Server,
    defaultSecretKeys: ["authToken"],
    fields: [
      { key: "endpoint", label: "MCP Endpoint URL", type: "text", placeholder: "https://mcp.example.com/mcp", required: true },
      {
        key: "authStyle", label: "Auth Style", type: "select",
        options: [
          { value: "none", label: "None" },
          { value: "bearer", label: "Bearer token" },
          { value: "header", label: "Custom header" },
        ],
      },
      { key: "authHeaderName", label: "Header Name (only for 'Custom header')", type: "text", placeholder: "x-api-key" },
      { key: "authToken", label: "Auth Token", type: "password" },
    ],
  },
  {
    value: "github",
    label: "GitHub",
    description: "Repos / issues / PRs — placeholder, not yet wired",
    category: "mcp",
    implemented: false,
    icon: Github,
    defaultSecretKeys: ["personalAccessToken"],
    fields: [
      { key: "organization", label: "Organization / Owner", type: "text", required: true },
      { key: "personalAccessToken", label: "Personal Access Token", type: "password", required: true },
    ],
  },
  {
    value: "streamliner",
    label: "Streamliner",
    description: "Placeholder — share docs and we'll wire it in",
    category: "mcp",
    implemented: false,
    icon: FlaskConical,
    defaultSecretKeys: ["apiKey"],
    fields: [
      { key: "baseUrl", label: "Base URL", type: "text", required: true },
      { key: "apiKey", label: "API Key", type: "password", required: true },
    ],
  },
  // DATA SOURCES
  {
    value: "supabase",
    label: "Supabase",
    description: "Supabase project — REST + auth via service-role or anon key",
    category: "data_source",
    implemented: true,
    icon: Database,
    defaultSecretKeys: ["serviceRoleKey"],
    fields: [
      { key: "projectUrl", label: "Project URL", type: "text", placeholder: "https://abcdefgh.supabase.co", required: true },
      { key: "serviceRoleKey", label: "Service Role Key (or anon key)", type: "password", placeholder: "sb_secret_... or sb_publishable_...", required: true },
      { key: "schema", label: "Default Schema (optional)", type: "text", placeholder: "public" },
    ],
  },
  {
    value: "http_api",
    label: "HTTP API",
    description: "Generic JSON / REST endpoint with optional auth",
    category: "data_source",
    implemented: true,
    icon: FileJson,
    defaultSecretKeys: ["authToken"],
    fields: [
      { key: "url", label: "URL", type: "text", placeholder: "https://api.example.com/v1/things", required: true },
      {
        key: "method", label: "Method", type: "select",
        options: [
          { value: "GET", label: "GET" },
          { value: "POST", label: "POST" },
          { value: "HEAD", label: "HEAD" },
        ],
      },
      {
        key: "authStyle", label: "Auth Style", type: "select",
        options: [
          { value: "none", label: "None" },
          { value: "bearer", label: "Bearer token" },
          { value: "basic", label: "Basic auth" },
          { value: "header", label: "Custom header" },
        ],
      },
      { key: "authUser", label: "Username (basic auth only)", type: "text" },
      { key: "authHeaderName", label: "Header Name (custom header only)", type: "text", placeholder: "x-api-key" },
      { key: "authToken", label: "Token / Password / Header Value", type: "password" },
    ],
  },
  {
    value: "postgres",
    label: "PostgreSQL (coming soon)",
    description: "Direct Postgres connection — tester wires once pg driver is installed",
    category: "data_source",
    implemented: false,
    icon: Database,
    defaultSecretKeys: ["password"],
    fields: [
      { key: "host", label: "Host", type: "text", required: true },
      { key: "port", label: "Port", type: "text", placeholder: "5432" },
      { key: "database", label: "Database", type: "text", required: true },
      { key: "user", label: "User", type: "text", required: true },
      { key: "password", label: "Password", type: "password", required: true },
      { key: "schema", label: "Default Schema", type: "text", placeholder: "public" },
    ],
  },
];

function findKind(value: string): IntegrationKind | undefined {
  return KINDS.find(k => k.value === value);
}

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

export function ConnectorsPopup({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const isAdmin = !!(profile?.is_super_admin || profile?.pmo_role === "admin");

  const [tab, setTab] = useState<Category>("mcp");
  const [rows, setRows] = useState<IntegrationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [editor, setEditor] = useState<{ mode: "create" | "edit"; row?: IntegrationRow; initialCategory?: Category } | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const data = await jsonFetch<IntegrationRow[]>("/api/admin/integrations");
      setRows(data);
    } catch (err) {
      toast({ title: "Failed to load connectors", description: (err as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open && isAdmin) void refresh();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isAdmin]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !editor) onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, editor, onClose]);

  if (!open) return null;

  async function handleDelete(row: IntegrationRow) {
    if (!confirm(`Delete connector "${row.name}"?`)) return;
    try {
      await jsonFetch<void>(`/api/admin/integrations/${row.id}`, { method: "DELETE" });
      toast({ title: "Deleted" });
      await refresh();
    } catch (err) {
      toast({ title: "Delete failed", description: (err as Error).message, variant: "destructive" });
    }
  }

  async function handleToggle(row: IntegrationRow) {
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
      const result = await jsonFetch<{ ok: boolean; details?: Record<string, unknown> }>(
        `/api/admin/integrations/${row.id}/test`,
        { method: "POST" },
      );
      const d = result.details ?? {};
      const summary = (d.displayName as string | undefined)
        ?? (d.serverName as string | undefined)
        ?? (typeof d.status === "number" ? `HTTP ${d.status}` : null)
        ?? (typeof d.reachable === "boolean" ? `${d.schemasDetected ?? "?"} paths reachable` : null)
        ?? "Credentials accepted";
      toast({ title: "Connection OK", description: summary });
    } catch (err) {
      toast({ title: "Connection failed", description: (err as Error).message, variant: "destructive" });
    }
  }

  const visibleRows = rows.filter(r => {
    const kindDef = findKind(r.kind);
    if (!kindDef) return tab === "mcp"; // unknown kinds default to MCP tab
    return kindDef.category === tab;
  });

  const mcpCount = rows.filter(r => findKind(r.kind)?.category === "mcp").length;
  const dataCount = rows.filter(r => findKind(r.kind)?.category === "data_source").length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="bg-card text-card-foreground rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="connectors-popup-title"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-border flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
            <Plug size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 id="connectors-popup-title" className="text-base font-heading font-semibold">Connectors &amp; Data Sources</h2>
            <p className="text-xs text-muted-foreground">
              Manage MCP servers and data sources — credentials stay server-side, the UI never echoes secrets.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
          >
            <X size={16} />
          </button>
        </div>

        {/* Admin gate */}
        {!isAdmin ? (
          <div className="p-8 text-sm text-muted-foreground">
            You need the PMO admin role to manage connectors.
          </div>
        ) : (
          <>
            {/* Tabs */}
            <div className="px-5 pt-4 border-b border-border flex items-end gap-1">
              <TabButton active={tab === "mcp"} onClick={() => setTab("mcp")} icon={Plug} label="MCP Connectors" count={mcpCount} />
              <TabButton active={tab === "data_source"} onClick={() => setTab("data_source")} icon={Database} label="Data Sources" count={dataCount} />
              <div className="flex-1" />
              <button
                onClick={() => setEditor({ mode: "create", initialCategory: tab })}
                className="mb-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90"
              >
                <Plus size={14} /> Add {tab === "mcp" ? "connector" : "data source"}
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-5">
              {loading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
                  <Loader2 size={16} className="animate-spin" /> Loading…
                </div>
              ) : visibleRows.length === 0 ? (
                <div className="border border-dashed border-border rounded-xl p-10 text-center text-sm text-muted-foreground">
                  No {tab === "mcp" ? "MCP connectors" : "data sources"} yet. Click <strong className="text-foreground">Add</strong> to create one.
                </div>
              ) : (
                <div className="border border-border rounded-xl divide-y divide-border bg-background">
                  {visibleRows.map(row => {
                    const kindDef = findKind(row.kind);
                    const Icon = kindDef?.icon ?? Plug;
                    return (
                      <div key={row.id} className="p-3 flex items-center gap-3">
                        <div className="w-9 h-9 rounded-md bg-muted flex items-center justify-center text-muted-foreground flex-shrink-0">
                          <Icon size={16} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                            <span className="text-sm font-semibold text-foreground truncate">{row.name}</span>
                            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                              {kindDef?.label ?? row.kind}
                            </span>
                            {row.enabled ? (
                              <span className="text-[10px] inline-flex items-center gap-1 text-success">
                                <CheckCircle2 size={11} /> Enabled
                              </span>
                            ) : (
                              <span className="text-[10px] inline-flex items-center gap-1 text-muted-foreground">
                                <XCircle size={11} /> Disabled
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground truncate">
                            {String(
                              (row.config as Record<string, unknown>).baseUrl
                                ?? (row.config as Record<string, unknown>).endpoint
                                ?? (row.config as Record<string, unknown>).url
                                ?? (row.config as Record<string, unknown>).projectUrl
                                ?? (row.config as Record<string, unknown>).host
                                ?? (row.config as Record<string, unknown>).organization
                                ?? "—",
                            )}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button
                            onClick={() => void handleTest(row)}
                            disabled={!kindDef?.implemented}
                            title={kindDef?.implemented ? "Test connection" : "Tester not implemented yet"}
                            className="px-2.5 py-1.5 text-xs font-medium rounded-md border border-border hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            Test
                          </button>
                          <button
                            onClick={() => void handleToggle(row)}
                            className="px-2.5 py-1.5 text-xs font-medium rounded-md border border-border hover:bg-muted"
                          >
                            {row.enabled ? "Disable" : "Enable"}
                          </button>
                          <button
                            onClick={() => setEditor({ mode: "edit", row })}
                            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground"
                            title="Edit"
                          >
                            <Edit2 size={13} />
                          </button>
                          <button
                            onClick={() => void handleDelete(row)}
                            className="p-1.5 rounded-md hover:bg-destructive/10 text-destructive"
                            title="Delete"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {editor && (
        <EditorModal
          mode={editor.mode}
          row={editor.row}
          initialCategory={editor.initialCategory ?? tab}
          onClose={() => setEditor(null)}
          onSaved={async () => { setEditor(null); await refresh(); }}
        />
      )}
    </div>
  );
}

function TabButton({
  active, onClick, icon: Icon, label, count,
}: {
  active: boolean; onClick: () => void; icon: typeof Plug; label: string; count: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 text-xs font-medium inline-flex items-center gap-1.5 border-b-2 transition-colors -mb-px ${
        active
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      <Icon size={13} /> {label}
      <span className={`ml-1 px-1.5 py-0.5 rounded text-[10px] ${active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
        {count}
      </span>
    </button>
  );
}

function EditorModal({
  mode, row, initialCategory, onClose, onSaved,
}: {
  mode: "create" | "edit";
  row?: IntegrationRow;
  initialCategory: Category;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { toast } = useToast();
  const categoryKinds = KINDS.filter(k => k.category === initialCategory);
  const initialKind = row?.kind ?? categoryKinds.find(k => k.implemented)?.value ?? categoryKinds[0]?.value ?? "jira";
  const [kind, setKind] = useState(initialKind);
  const kindDef = findKind(kind);
  const [name, setName] = useState(row?.name ?? "");
  const [config, setConfig] = useState<Record<string, string>>(
    () => Object.fromEntries(Object.entries(row?.config ?? {}).map(([k, v]) => [k, String(v ?? "")])),
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (mode === "create") setConfig({});
  }, [kind, mode]);

  async function handleSave() {
    if (!kindDef) return;
    if (!kindDef.implemented && mode === "create") {
      toast({ title: "Not implemented yet", description: `Tester for ${kindDef.label} is coming soon. You can still save the credential, but Test will return 501.` });
    }
    const missing = kindDef.fields.filter(f => f.required && !config[f.key]?.trim()).map(f => f.label);
    if (missing.length > 0) {
      toast({ title: "Missing required fields", description: missing.join(", "), variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      if (mode === "create") {
        await jsonFetch<IntegrationRow>("/api/admin/integrations", {
          method: "POST",
          body: JSON.stringify({
            kind,
            name: name.trim() || kindDef.label,
            config,
            secretKeys: kindDef.defaultSecretKeys,
            enabled: true,
          }),
        });
      } else if (row) {
        await jsonFetch<IntegrationRow>(`/api/admin/integrations/${row.id}`, {
          method: "PUT",
          body: JSON.stringify({ name: name.trim() || row.name, config }),
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

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="bg-card text-card-foreground rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="p-5 border-b border-border">
          <h3 className="text-base font-heading font-semibold">
            {mode === "create"
              ? `Add ${initialCategory === "mcp" ? "MCP connector" : "data source"}`
              : "Edit connector"}
          </h3>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1">Kind</label>
            <select
              value={kind}
              onChange={e => setKind(e.target.value)}
              disabled={mode === "edit"}
              className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-card disabled:opacity-50"
            >
              {categoryKinds.map(k => (
                <option key={k.value} value={k.value}>
                  {k.label}{k.implemented ? "" : " — coming soon"}
                </option>
              ))}
            </select>
            {kindDef && <p className="mt-1 text-[11px] text-muted-foreground">{kindDef.description}</p>}
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1">Display Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={kindDef ? `e.g. Granules ${kindDef.label}` : ""}
              className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-card focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {kindDef?.fields.map(field => (
            <div key={field.key}>
              <label className="block text-xs font-semibold text-muted-foreground mb-1">
                {field.label}{field.required ? <span className="text-destructive ml-0.5">*</span> : null}
              </label>
              {field.type === "select" ? (
                <select
                  value={config[field.key] ?? (field.options?.[0]?.value ?? "")}
                  onChange={e => setConfig(c => ({ ...c, [field.key]: e.target.value }))}
                  className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-card"
                >
                  {field.options?.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              ) : (
                <input
                  type={field.type}
                  value={config[field.key] ?? ""}
                  onChange={e => setConfig(c => ({ ...c, [field.key]: e.target.value }))}
                  placeholder={field.placeholder}
                  className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-card focus:outline-none focus:ring-1 focus:ring-primary"
                  autoComplete={field.type === "password" ? "new-password" : "off"}
                />
              )}
              {field.type === "password" && mode === "edit" && config[field.key] === "***" && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Stored secret kept as-is. Replace this field to rotate.
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
