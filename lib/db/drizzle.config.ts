import { defineConfig } from "drizzle-kit";
import path from "path";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  // The PMO schema shares the Recruit DB with ~100 non-PMO tables (jobs,
  // applications, pms_*, employees, …). Without this filter, `drizzle-kit push`
  // would diff the entire public schema against this 57-table PMO schema and
  // try to DROP every non-pmo table. Scope it so push can only ever manage
  // pmo_* tables.
  tablesFilter: ["pmo_*"],
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
