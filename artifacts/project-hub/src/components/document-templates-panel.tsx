import { LIFECYCLE_PHASES } from "../lib/lifecycle-phases";
import { FileText, FileSpreadsheet, Presentation, Download } from "lucide-react";
import type { LucideIcon } from "lucide-react";

// ---------------------------------------------------------------------------
// DocumentTemplatesPanel — the official Granules mandatory-deliverable pack (15
// templates) grouped by lifecycle phase, each a one-click download. Header-less
// so it can embed inside the Document Repository (pages/documents.tsx). Files
// are served statically from public/document-templates/<Phase>/<file> (mirrored
// from apps/pmo/document-templates). Read-only: this surfaces the BLANK
// templates; uploading filled copies still happens per-stage on a project.
// ---------------------------------------------------------------------------

type TemplateFile = {
  /** Official document number ("01".."15"), or null for the supporting RFP annexure. */
  num: string | null;
  title: string;
  /** Exact filename under public/document-templates/<phase>/ */
  file: string;
  /** Lifecycle stage this deliverable maps to. */
  stage: string;
};

const PLAN: TemplateFile[] = [
  { num: "01", title: "Project Charter", file: "01_Project Charter.docx", stage: "Business Case" },
  { num: "02", title: "Business Requirement Document", file: "02_Business Requirement Document.docx", stage: "Business Case" },
  { num: "03", title: "Project Plan", file: "03_Project Plan.xlsx", stage: "Project Plan" },
  { num: "05", title: "Solution Architecture & Pitch Deck", file: "05_Solution Architecture & Pitch Deck.pptx", stage: "Solution Design" },
  { num: "07", title: "Issues, Risks & Opportunities", file: "07_Issues, Risks & Opportunities.xlsx", stage: "Project Plan" },
  { num: null, title: "Request for Proposal (annexure)", file: "Annexure- Request for Proposal.docx", stage: "Request for Proposal" },
];

const EXECUTE: TemplateFile[] = [
  { num: "04", title: "Data Exploration", file: "04_Data Exploration.docx", stage: "Development & Configuration" },
  { num: "06", title: "Exploratory Data Analysis", file: "06_Exploratory Data Analysis.docx", stage: "Development & Configuration" },
  { num: "08", title: "Data Transformation", file: "08_Data Transformation.docx", stage: "Development & Configuration" },
  { num: "09", title: "Modelling Approach and DAR", file: "09_Modelling Approach and DAR.docx", stage: "Development & Configuration" },
  { num: "10", title: "Test Scenarios, Defect Log & RCA", file: "10_Test Scenarios, Defect Log & RCA.xlsx", stage: "System Testing & Validation" },
  { num: "12", title: "UAT", file: "12_UAT.docx", stage: "System Testing & Validation" },
  { num: "11", title: "Deployment Design", file: "11_Deployment Design.docx", stage: "Deployment Readiness" },
  { num: "13", title: "Release Notes", file: "13_Release Notes.docx", stage: "Production Deployment & Go-Live" },
];

const CLOSE: TemplateFile[] = [
  { num: "14", title: "User Handbook", file: "14_User Handbook.docx", stage: "Operational Handover" },
  { num: "15", title: "Operations & Support Handbook", file: "15_Operations & Support Handbook.docx", stage: "Operational Handover" },
];

const PHASE_FILES: Record<string, TemplateFile[]> = { plan: PLAN, execute: EXECUTE, close: CLOSE };

// public/ dir uses the capitalised phase label (Plan / Execute / Close).
const PHASE_DIR: Record<string, string> = { plan: "Plan", execute: "Execute", close: "Close" };

export const TEMPLATE_COUNT =
  PLAN.filter((t) => t.num).length + EXECUTE.filter((t) => t.num).length + CLOSE.filter((t) => t.num).length;

function extOf(file: string): string {
  const i = file.lastIndexOf(".");
  return i < 0 ? "" : file.slice(i + 1).toUpperCase();
}

function iconFor(file: string): LucideIcon {
  const ext = extOf(file);
  if (ext === "XLSX") return FileSpreadsheet;
  if (ext === "PPTX") return Presentation;
  return FileText;
}

// Static-asset URL that respects the app's BASE_PATH. import.meta.env.BASE_URL
// always ends with a trailing slash. Filenames carry spaces / commas / & — encode each segment.
function downloadHref(phaseDir: string, file: string): string {
  const base = import.meta.env.BASE_URL || "/";
  return `${base}document-templates/${encodeURIComponent(phaseDir)}/${encodeURIComponent(file)}`;
}

export function DocumentTemplatesPanel() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {LIFECYCLE_PHASES.map((phase, pi) => {
        const files = PHASE_FILES[phase.key] ?? [];
        const phaseDir = PHASE_DIR[phase.key] ?? phase.label;
        return (
          <div key={phase.key} className={`glass-surface rounded-2xl p-4 ph-rise ph-rise-${pi + 1}`}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: phase.color }} />
                <h2 className="text-sm font-bold text-foreground truncate">{phase.label}</h2>
              </div>
              <span className="text-[11px] text-muted-foreground tabular-nums flex-shrink-0">
                {files.filter((f) => f.num).length} docs
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground/80 italic mb-3 leading-snug">{phase.description}</p>

            <ul className="space-y-2">
              {files.map((t) => {
                const Icon = iconFor(t.file);
                return (
                  <li key={t.file}>
                    <a
                      href={downloadHref(phaseDir, t.file)}
                      download
                      className="group flex items-center gap-3 rounded-xl border border-border bg-card/50 px-3 py-2.5 transition-colors hover:border-primary/50 hover:bg-primary/5 focus:outline-none focus:ring-2 focus:ring-primary/30"
                    >
                      <span
                        className="flex items-center justify-center w-8 h-8 rounded-lg border flex-shrink-0"
                        style={{ borderColor: `${phase.color}40`, background: `${phase.color}14`, color: phase.color }}
                      >
                        <Icon size={15} strokeWidth={2.1} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-semibold text-foreground leading-tight truncate">
                          {t.num && <span className="text-muted-foreground/70 tabular-nums mr-1.5">{t.num}</span>}
                          {t.title}
                        </p>
                        <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                          <span className="uppercase tracking-wide">{extOf(t.file)}</span>
                          <span className="mx-1 text-muted-foreground/40">·</span>
                          {t.stage}
                        </p>
                      </div>
                      <Download
                        size={15}
                        className="text-muted-foreground/50 group-hover:text-primary flex-shrink-0 transition-colors"
                        strokeWidth={2.2}
                      />
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
