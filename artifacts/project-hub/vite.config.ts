import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}


const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    "BASE_PATH environment variable is required but was not provided.",
  );
}

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    // ponytail: dropped the Replit-only cartographer/dev-banner plugins. They
    // only ever loaded under REPL_ID (never on our infra), and their top-level
    // `await import()` broke the prod vite config loader
    // (ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING). Re-add statically if ever needed.
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
      // Monorepo shared package — resolved to SOURCE (like cxo/portal/pms) so the
      // suite-shared chrome (CollapsibleSidebar, AppHeader) bundles under this
      // app's single React copy (dedupe below). project-hub sits 4 levels deep.
      "@granules/shared": path.resolve(import.meta.dirname, "..", "..", "..", "..", "packages", "shared"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    proxy: {
      // Everything — including /api/org — is served by PMO's own api-server. It
      // used to proxy /api/org, /api/action-items and /api/kpi-approvers to the
      // CXO backend, which broke the moment that separate server was down (and
      // never worked in prod, where nginx sends all of /api/ to :3008).
      "/api": process.env.API_TARGET ?? "http://localhost:3008",
    },
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    proxy: {
      "/api": process.env.API_TARGET ?? "http://localhost:3008",
    },
  },
});
