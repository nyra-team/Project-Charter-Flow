// PMO's flavor of the suite-wide DB-target switch (backend/shared/dbTarget.js's
// `selectDbTarget`): resolve every DB-pointing env var from the repo-shared
// backend/.env instead of hardcoded values, so `APP_ENV` flips PMO together
// with the other backends.
//
// MUST be the first import in index.ts — @workspace/db captures
// process.env.DATABASE_URL at module load, so this overlay has to run before
// that import graph is evaluated.
//
//   target = PMO_DB_ENV || APP_ENV   (process env beats the file; default prod)
//   dev  → PMO_DATABASE_URL_DEV + SUPABASE_*_DEV / MASTER_DB_*_DEV REST creds
//   prod → PMO_DATABASE_URL     + SUPABASE_*     / MASTER_DB_*     REST creds
//
// The overlay force-writes these vars even when the launcher set them, so a
// stale exported DATABASE_URL can never silently pin the wrong database again
// (that exact bug is why this file exists). The sanctioned per-app pin is
// PMO_DB_ENV. Fail-safe: refuses to boot when the chosen target's vars are
// missing rather than falling back to another database.
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function findBackendEnv(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, "backend", ".env");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("[PMO] backend/.env not found walking up from this file — is the repo layout intact?");
}

function parseEnv(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/\r$/, "").replace(/^"(.*)"$/, "$1");
  }
  return out;
}

const envPath = findBackendEnv();
const shared = parseEnv(envPath);
const target = process.env.PMO_DB_ENV || process.env.APP_ENV || shared.PMO_DB_ENV || shared.APP_ENV || "prod";

if (target !== "dev" && target !== "prod") {
  throw new Error(`[PMO] unsupported DB target "${target}" — PMO supports dev|prod only`);
}

const sfx = target === "dev" ? "_DEV" : "";
const overlay: Record<string, string> = {
  DATABASE_URL: shared[`PMO_DATABASE_URL${sfx}`] ?? "",
  SUPABASE_URL: shared[`SUPABASE_URL${sfx}`] ?? "",
  SUPABASE_SERVICE_ROLE_KEY: shared[`SUPABASE_SERVICE_ROLE_KEY${sfx}`] ?? "",
  MASTER_DB_URL: shared[`MASTER_DB_URL${sfx}`] ?? "",
  MASTER_DB_SERVICE_ROLE_KEY: shared[`MASTER_DB_SERVICE_ROLE_KEY${sfx}`] ?? "",
};
// Vendor-portal auth lives in the same app-data Supabase project.
overlay.VENDOR_AUTH_DB_URL = overlay.SUPABASE_URL;
overlay.VENDOR_AUTH_DB_SERVICE_ROLE_KEY = overlay.SUPABASE_SERVICE_ROLE_KEY;

const missing = Object.entries(overlay).filter(([, v]) => !v).map(([k]) => k);
if (missing.length) {
  throw new Error(`[PMO] DB target "${target}" selected but ${envPath} is missing: ${missing.join(", ")} — refusing to boot`);
}
Object.assign(process.env, overlay);

const pgHost = overlay.DATABASE_URL.split("@")[1]?.split("/")[0] ?? "?";
console.log(`[PMO] DB target = ${target === "dev" ? "DEV cloud" : "PROD"} (rest ${new URL(overlay.SUPABASE_URL).host}, pg ${pgHost})`);

export {};
