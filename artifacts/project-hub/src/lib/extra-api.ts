// Minimal fetch helper for endpoints not (yet) in the OpenAPI spec
// (AI, lessons-learned, benefits, change-requests, baselines, meetings).
// All calls are same-origin and rely on the dev proxy.

async function handle<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as unknown as T;
  const ct = res.headers.get("content-type") ?? "";
  const body = ct.includes("application/json") ? await res.json() : await res.text();
  if (!res.ok) {
    const err = new Error((body && (body as { error?: string }).error) || `HTTP ${res.status}`);
    (err as Error & { status: number; body: unknown }).status = res.status;
    (err as Error & { status: number; body: unknown }).body = body;
    throw err;
  }
  return body as T;
}

export const api = {
  get: <T = unknown>(path: string) => fetch(path, { credentials: "include" }).then(r => handle<T>(r)),
  post: <T = unknown>(path: string, body?: unknown) =>
    fetch(path, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: body == null ? undefined : JSON.stringify(body),
    }).then(r => handle<T>(r)),
  patch: <T = unknown>(path: string, body: unknown) =>
    fetch(path, {
      method: "PATCH", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(r => handle<T>(r)),
  del: <T = unknown>(path: string) =>
    fetch(path, { method: "DELETE", credentials: "include" }).then(r => handle<T>(r)),
};

export type AiStatus = { configured: boolean; provider: string; model: string };
export const getAiStatus = () => api.get<AiStatus>("/api/ai/status");

/**
 * Open/download an authenticated API file (PDF, docx). Plain <a href> links
 * NAVIGATE — they bypass window.fetch, so the interceptor never attaches the
 * bearer token and the API answers 401 "Missing bearer token". Fetching first
 * (token attached) and opening the blob URL keeps downloads authed.
 */
export async function openApiFile(path: string, filename?: string): Promise<void> {
  const res = await fetch(path, { credentials: "include", cache: "no-store" });
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  if (filename) {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
  } else {
    window.open(url, "_blank", "noopener");
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
