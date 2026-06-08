import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq, and } from "drizzle-orm";
import { db, documentsTable } from "@workspace/db";

// ---------------------------------------------------------------------------
// Template document seeding.
//
// Every project is auto-attached its mandatory deliverable docs as starter
// "Template" entries (tags include "template"), mapped to the right lifecycle
// stage, so business users edit-in-place instead of hunting for templates.
// We seed the 11 UNIVERSAL deliverables (the 4 data-science-specific docs and
// the procurement-only RFP annexure are intentionally excluded; they stay in
// the Templates browser).
//
// The blank template FILES live on disk at apps/pmo/document-templates/<Phase>/
// and are streamed by the public route GET /api/storage/templates/:phase/:file
// (routes/template-files.ts). Seeded rows store that URL as their fileUrl — no
// object storage involved (the Replit GCS sidecar is unavailable locally).
// ---------------------------------------------------------------------------

export type TemplateDoc = {
  phase: "Plan" | "Execute" | "Close";
  file: string;
  name: string;
  stage: string;
};

export const UNIVERSAL_TEMPLATES: TemplateDoc[] = [
  { phase: "Plan", file: "01_Project Charter.docx", name: "Project Charter", stage: "initiation" },
  { phase: "Plan", file: "02_Business Requirement Document.docx", name: "Business Requirement Document", stage: "initiation" },
  { phase: "Plan", file: "03_Project Plan.xlsx", name: "Project Plan", stage: "project_plan" },
  { phase: "Plan", file: "05_Solution Architecture & Pitch Deck.pptx", name: "Solution Architecture & Pitch Deck", stage: "solution_design" },
  { phase: "Plan", file: "07_Issues, Risks & Opportunities.xlsx", name: "Issues, Risks & Opportunities", stage: "project_plan" },
  { phase: "Execute", file: "10_Test Scenarios, Defect Log & RCA.xlsx", name: "Test Scenarios, Defect Log & RCA", stage: "uat" },
  { phase: "Execute", file: "12_UAT.docx", name: "UAT", stage: "uat" },
  { phase: "Execute", file: "11_Deployment Design.docx", name: "Deployment Design", stage: "deployment_readiness" },
  { phase: "Execute", file: "13_Release Notes.docx", name: "Release Notes", stage: "go_live" },
  { phase: "Close", file: "14_User Handbook.docx", name: "User Handbook", stage: "operational_handover" },
  { phase: "Close", file: "15_Operations & Support Handbook.docx", name: "Operations & Support Handbook", stage: "operational_handover" },
];

export const TEMPLATE_PHASES = new Set(["Plan", "Execute", "Close"]);
// Path-traversal guard for the serve route: only these exact filenames are servable.
export const TEMPLATE_FILE_ALLOWLIST = new Set(UNIVERSAL_TEMPLATES.map((t) => t.file));

const MIME_BY_EXT: Record<string, string> = {
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

export function mimeForFile(file: string): string {
  return MIME_BY_EXT[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
let cachedTemplateDir: string | null = null;

/**
 * Resolve the on-disk document-templates directory, robust to whether the
 * api-server runs from source (tsx) or the esbuild bundle (dist), and to its
 * working directory. Validates by probing for a known file.
 */
export function resolveTemplateDir(): string {
  if (cachedTemplateDir) return cachedTemplateDir;
  const probe = path.join("Plan", "01_Project Charter.docx");
  const candidates = [
    process.env.TEMPLATE_DIR,
    path.resolve(process.cwd(), "../../document-templates"),
    path.resolve(process.cwd(), "../project-hub/public/document-templates"),
    path.resolve(process.cwd(), "document-templates"),
    path.resolve(HERE, "../../../document-templates"),
    path.resolve(HERE, "../../../../document-templates"),
    path.resolve(HERE, "../../../project-hub/public/document-templates"),
  ].filter((c): c is string => !!c);

  for (const c of candidates) {
    if (existsSync(path.join(c, probe))) {
      cachedTemplateDir = c;
      return c;
    }
  }
  throw new Error(
    `Could not locate document-templates dir. Tried: ${candidates.join(", ")}. Set TEMPLATE_DIR to override.`,
  );
}

/**
 * Idempotently attach the 11 universal template docs to a project as starter
 * "Template" rows. Skips any template whose name already exists on the project,
 * so it is safe to re-run (used by both creation hooks and the backfill).
 * Returns the number of rows created.
 */
export async function seedProjectTemplateDocuments(
  projectId: number,
  uploadedByUserId: number | null,
): Promise<number> {
  let created = 0;
  for (const t of UNIVERSAL_TEMPLATES) {
    const [existing] = await db
      .select({ id: documentsTable.id })
      .from(documentsTable)
      .where(and(eq(documentsTable.projectId, projectId), eq(documentsTable.name, t.name)))
      .limit(1);
    if (existing) continue;

    const fileUrl = `/api/storage/templates/${encodeURIComponent(t.phase)}/${encodeURIComponent(t.file)}`;
    await db.insert(documentsTable).values({
      projectId,
      stage: t.stage,
      name: t.name,
      fileUrl,
      fileType: mimeForFile(t.file),
      uploadedBy: uploadedByUserId ?? undefined,
      accessLevel: "team",
      tags: ["template"],
      description: "Starter template — download, complete, and upload your filled copy.",
    });
    created++;
  }
  return created;
}
