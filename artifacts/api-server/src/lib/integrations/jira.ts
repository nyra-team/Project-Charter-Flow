/**
 * Jira (Atlassian Cloud) integration helpers.
 *
 * Talks to Jira REST v3 with Basic auth (email + API token). API tokens
 * are created at https://id.atlassian.com/manage-profile/security/api-tokens
 * and scope to the user that owns them — so the "org-level" credential we
 * store is really a service account's email + token pair.
 *
 * For now this lives outside the MCP transport layer: the AI-chat phase
 * will wrap these helpers as MCP tool definitions, but the underlying
 * Jira API access is the same either way.
 */

export interface JiraConfig {
  baseUrl: string;     // e.g. https://granules.atlassian.net
  email: string;       // service-account email
  apiToken: string;    // service-account API token (secret)
  projectKey?: string; // optional default project, e.g. "PMO"
}

export interface JiraMyself {
  accountId: string;
  emailAddress: string | null;
  displayName: string | null;
  active: boolean;
}

function authHeader(cfg: { email: string; apiToken: string }): string {
  // Node 20+ has global Buffer
  const token = Buffer.from(`${cfg.email}:${cfg.apiToken}`).toString("base64");
  return `Basic ${token}`;
}

function trimBase(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * Verify a Jira credential by calling /rest/api/3/myself.
 * Returns the resolved Jira user on success; throws an Error with a
 * useful message (HTTP code + Jira's `errorMessages[]`) on failure so
 * the admin UI can display it.
 */
export async function jiraTestConnection(cfg: JiraConfig): Promise<JiraMyself> {
  if (!cfg.baseUrl || !cfg.email || !cfg.apiToken) {
    throw new Error("baseUrl, email, and apiToken are required");
  }
  const url = `${trimBase(cfg.baseUrl)}/rest/api/3/myself`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        Authorization: authHeader(cfg),
        Accept: "application/json",
      },
    });
  } catch (err) {
    throw new Error(`Network error reaching ${cfg.baseUrl}: ${(err as Error).message}`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let detail = text;
    try {
      const parsed = JSON.parse(text) as { errorMessages?: string[]; message?: string };
      detail = parsed.errorMessages?.join("; ") || parsed.message || text;
    } catch { /* not JSON — keep raw text */ }
    throw new Error(`Jira returned HTTP ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  const body = (await res.json()) as JiraMyself;
  return body;
}

// ─── Generic authed fetch ─────────────────────────────────────────────────

async function jiraFetch(
  cfg: JiraConfig,
  method: string,
  path: string,
  body?: unknown,
): Promise<any> {
  const url = `${trimBase(cfg.baseUrl)}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: authHeader(cfg),
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new Error(`Network error reaching ${cfg.baseUrl}: ${(err as Error).message}`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let detail = text;
    try {
      const p = JSON.parse(text) as { errorMessages?: string[]; errors?: Record<string, string>; message?: string };
      detail = p.errorMessages?.join("; ")
        || (p.errors && Object.keys(p.errors).length ? JSON.stringify(p.errors) : "")
        || p.message || text;
    } catch { /* keep raw */ }
    throw new Error(`Jira ${method} ${path} → HTTP ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ─── Atlassian Document Format (ADF) helpers ──────────────────────────────
// Jira REST v3 requires `description` as ADF, not a plain string.

export function toADF(text: string): unknown {
  const lines = (text ?? "").split("\n");
  const content = lines.map((line) => ({
    type: "paragraph",
    content: line ? [{ type: "text", text: line }] : [],
  }));
  return { type: "doc", version: 1, content: content.length ? content : [{ type: "paragraph", content: [] }] };
}

export function adfToText(adf: unknown): string {
  if (!adf) return "";
  if (typeof adf === "string") return adf;
  const out: string[] = [];
  const walk = (n: any): void => {
    if (!n || typeof n !== "object") return;
    if (n.type === "text" && typeof n.text === "string") out.push(n.text);
    if (Array.isArray(n.content)) n.content.forEach(walk);
    if (n.type === "paragraph") out.push("\n");
  };
  walk(adf);
  return out.join("").replace(/\n{3,}/g, "\n\n").trim();
}

// ─── Projects / issues ────────────────────────────────────────────────────

export interface JiraProjectSummary { id: string; key: string; name: string }

export async function jiraListProjects(cfg: JiraConfig): Promise<JiraProjectSummary[]> {
  const data = await jiraFetch(cfg, "GET", "/rest/api/3/project/search?maxResults=100&orderBy=key");
  return ((data?.values ?? []) as any[]).map((p) => ({ id: String(p.id), key: p.key, name: p.name }));
}

export interface JiraIssue {
  key: string;
  summary: string;
  description: string;
  statusCategory: string; // new | indeterminate | done
  statusName: string;
  issueType: string;
  priority: string | null;
  dueDate: string | null;
  component: string | null; // first Jira component name (module)
}

/** List a Jira project's components (modules), by name. */
export async function jiraListComponents(cfg: JiraConfig, projectKey: string): Promise<string[]> {
  const data = await jiraFetch(cfg, "GET", `/rest/api/3/project/${encodeURIComponent(projectKey)}/components`);
  return ((data ?? []) as any[]).map((c) => c.name).filter(Boolean);
}

/**
 * Search issues via the JQL endpoint (`/rest/api/3/search/jql`, the
 * token-paginated replacement for the deprecated `/search`). Pulls up to
 * `max` issues across pages.
 */
export async function jiraSearchIssues(cfg: JiraConfig, jql: string, max = 500): Promise<JiraIssue[]> {
  const fields = "summary,description,status,issuetype,priority,duedate,components";
  const out: JiraIssue[] = [];
  let nextPageToken: string | undefined;
  for (;;) {
    const qs = new URLSearchParams({ jql, fields, maxResults: "100" });
    if (nextPageToken) qs.set("nextPageToken", nextPageToken);
    const data = await jiraFetch(cfg, "GET", `/rest/api/3/search/jql?${qs.toString()}`);
    for (const it of ((data?.issues ?? []) as any[])) {
      const f = it.fields ?? {};
      out.push({
        key: it.key,
        summary: f.summary ?? "",
        description: adfToText(f.description),
        statusCategory: f.status?.statusCategory?.key ?? "new",
        statusName: f.status?.name ?? "",
        issueType: f.issuetype?.name ?? "Task",
        priority: f.priority?.name ?? null,
        dueDate: f.duedate ?? null,
        component: Array.isArray(f.components) && f.components[0]?.name ? f.components[0].name : null,
      });
    }
    if (data?.isLast || !data?.nextPageToken || out.length >= max) break;
    nextPageToken = data.nextPageToken;
  }
  return out;
}

export async function jiraCreateIssue(
  cfg: JiraConfig,
  input: { projectKey: string; issueType?: string; summary: string; description?: string },
): Promise<{ key: string }> {
  const data = await jiraFetch(cfg, "POST", "/rest/api/3/issue", {
    fields: {
      project: { key: input.projectKey },
      issuetype: { name: input.issueType ?? "Task" },
      summary: input.summary,
      description: toADF(input.description ?? ""),
    },
  });
  return { key: data.key as string };
}

export async function jiraUpdateIssue(
  cfg: JiraConfig,
  key: string,
  input: { summary?: string; description?: string },
): Promise<void> {
  const fields: Record<string, unknown> = {};
  if (input.summary != null) fields.summary = input.summary;
  if (input.description != null) fields.description = toADF(input.description);
  if (Object.keys(fields).length === 0) return;
  await jiraFetch(cfg, "PUT", `/rest/api/3/issue/${encodeURIComponent(key)}`, { fields });
}

/**
 * Best-effort status export: find a transition whose target status category
 * matches `targetCategory` (new|indeterminate|done) and apply it. Returns
 * false if no matching transition is available (custom workflow) — caller
 * should treat that as a non-fatal skip.
 */
export async function jiraTransitionToCategory(cfg: JiraConfig, key: string, targetCategory: string): Promise<boolean> {
  const t = await jiraFetch(cfg, "GET", `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`);
  const match = ((t?.transitions ?? []) as any[]).find((x) => x.to?.statusCategory?.key === targetCategory);
  if (!match) return false;
  await jiraFetch(cfg, "POST", `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`, { transition: { id: match.id } });
  return true;
}

// ─── Field mapping (Jira ↔ PMO) ───────────────────────────────────────────

export function jiraStatusToPmo(categoryKey: string): string {
  if (categoryKey === "done") return "completed";
  if (categoryKey === "indeterminate") return "in_progress";
  return "not_started";
}

export function pmoStatusToJiraCategory(status: string): string {
  if (status === "completed") return "done";
  if (["in_progress", "in_review", "blocked"].includes(status)) return "indeterminate";
  return "new";
}

export function jiraPriorityToPmo(name: string | null): string {
  switch (name) {
    case "Highest": case "High": return "P1";
    case "Medium": return "P2";
    case "Low": return "P3";
    case "Lowest": return "P4";
    default: return "P2";
  }
}
