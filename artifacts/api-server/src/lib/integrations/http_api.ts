/**
 * Generic HTTP API data-source tester.
 *
 * Pings the configured URL with whatever auth flavor the admin chose. Any
 * 2xx response counts as success — we surface the resolved status code and
 * a short body preview so the admin can spot obvious mismatches (HTML 200
 * from a login page vs. JSON 200 from the real API, etc.).
 */

export interface HttpApiConfig {
  url: string;
  method?: "GET" | "POST" | "HEAD";
  authStyle?: "none" | "bearer" | "basic" | "header";
  authToken?: string;        // bearer token, basic-auth password, or header value
  authUser?: string;         // basic-auth username
  authHeaderName?: string;   // only when authStyle === "header"
  expectedStatus?: number;   // optional, defaults to 200-299 acceptance
}

export interface HttpApiInfo {
  status: number;
  contentType: string;
  bodyPreview: string;
}

function buildHeaders(cfg: HttpApiConfig): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json,text/plain,*/*" };
  const style = cfg.authStyle ?? "none";
  if (style === "bearer" && cfg.authToken) {
    headers.Authorization = `Bearer ${cfg.authToken}`;
  } else if (style === "basic" && cfg.authUser && cfg.authToken) {
    headers.Authorization = `Basic ${Buffer.from(`${cfg.authUser}:${cfg.authToken}`).toString("base64")}`;
  } else if (style === "header" && cfg.authHeaderName && cfg.authToken) {
    headers[cfg.authHeaderName] = cfg.authToken;
  }
  return headers;
}

export async function httpApiTestConnection(cfg: HttpApiConfig): Promise<HttpApiInfo> {
  if (!cfg.url) throw new Error("url is required");
  let res: Response;
  try {
    res = await fetch(cfg.url, {
      method: cfg.method ?? "GET",
      headers: buildHeaders(cfg),
    });
  } catch (err) {
    throw new Error(`Network error reaching ${cfg.url}: ${(err as Error).message}`);
  }
  const accepted = cfg.expectedStatus
    ? res.status === cfg.expectedStatus
    : res.status >= 200 && res.status < 300;
  const text = await res.text().catch(() => "");
  const info: HttpApiInfo = {
    status: res.status,
    contentType: res.headers.get("content-type") ?? "",
    bodyPreview: text.slice(0, 200),
  };
  if (!accepted) {
    throw new Error(`HTTP ${res.status} — expected ${cfg.expectedStatus ?? "2xx"}. Body: ${info.bodyPreview}`);
  }
  return info;
}
