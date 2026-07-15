import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Bound our footprint on the shared Supabase pooler (session mode caps
  // total clients low), and release idle connections quickly so slots free up.
  max: 8,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  keepAlive: true,
});

// Without this listener, an error on an idle pooled client (e.g. the Supabase
// pooler dropping a connection) is emitted as an unhandled 'error' event, which
// Node turns into an uncaughtException that crashes the whole PMO process.
// Handling it here keeps the pool — and the server — alive.
pool.on("error", (err) => {
  console.error("[PMO][db] idle client error (pool kept alive):", err.message);
});

export const db = drizzle(pool, { schema });

export * from "./schema";
