/**
 * Supabase data-source tester.
 *
 * Validates a Supabase project URL + service-role key (or anon key) by
 * pinging the PostgREST root at /rest/v1/. PostgREST returns 200 with an
 * OpenAPI summary when the key authenticates; an invalid key gets a
 * 401 with a JSON error body.
 */

export interface SupabaseConfig {
  projectUrl: string;        // e.g. https://abcdefgh.supabase.co
  serviceRoleKey: string;    // sb_secret_... or sb_publishable_... (secret either way)
  schema?: string;           // defaults to "public"
}

export interface SupabaseInfo {
  reachable: boolean;
  schemasDetected: number;
}

function trimBase(url: string): string {
  return url.replace(/\/+$/, "");
}

export async function supabaseTestConnection(cfg: SupabaseConfig): Promise<SupabaseInfo> {
  if (!cfg.projectUrl || !cfg.serviceRoleKey) {
    throw new Error("projectUrl and serviceRoleKey are required");
  }
  const url = `${trimBase(cfg.projectUrl)}/rest/v1/`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        apikey: cfg.serviceRoleKey,
        Authorization: `Bearer ${cfg.serviceRoleKey}`,
        Accept: "application/openapi+json",
      },
    });
  } catch (err) {
    throw new Error(`Network error reaching ${cfg.projectUrl}: ${(err as Error).message}`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let detail = text;
    try {
      const parsed = JSON.parse(text) as { message?: string; hint?: string };
      detail = parsed.message ?? parsed.hint ?? text;
    } catch { /* not JSON */ }
    throw new Error(`Supabase returned HTTP ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
  // PostgREST root returns an OpenAPI doc; pull a rough count of paths so
  // the admin sees something useful ("connected, 47 tables visible").
  let paths = 0;
  try {
    const doc = (await res.json()) as { paths?: Record<string, unknown> };
    paths = doc.paths ? Object.keys(doc.paths).length : 0;
  } catch { /* response wasn't JSON, that's OK — 200 still means reachable */ }
  return { reachable: true, schemasDetected: paths };
}
