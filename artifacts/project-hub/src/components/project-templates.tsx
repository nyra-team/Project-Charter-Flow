import { Fragment, useState } from "react";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table";
import { ChevronDown, ChevronRight, FileCheck2, Download, FileText } from "lucide-react";

// Project Templates organised by the 5 project types (CAPEX / OPEX / NPL / CIP /
// IT). Shared between the Document Repository "Project Templates" tab and each
// project's documents view. All sections collapsed by default.
export const TEMPLATE_TYPES = ["CAPEX", "OPEX", "NPL", "CIP", "IT"] as const;
export const TYPE_COLOR: Record<string, string> = { CAPEX: "#0ea5e9", OPEX: "#8b5cf6", NPL: "#f59e0b", CIP: "#16a34a", IT: "#64748b" };

// Classify a project into one of the 5 template types — same name-based rule
// as the Projects toolbar filter (CIP tracker imports are the only real
// members today; everything else is IT).
const CIP_NAME_RE = /metoprolol|potassium chloride|klorcon|\bkcl\b/;
export function projectTemplateType(projectName: string | null | undefined): (typeof TEMPLATE_TYPES)[number] {
  return CIP_NAME_RE.test((projectName ?? "").toLowerCase()) ? "CIP" : "IT";
}
type TemplateEntry = { name: string; desc: string; href: string; download?: boolean };
const TYPE_TEMPLATES: Record<string, TemplateEntry[]> = {
  CAPEX: [], OPEX: [], NPL: [], IT: [],
  CIP: [
    { name: "PIF — Project Initiation Form (format)", desc: "The Project Initiation Form format used to raise a new CIP project.", href: "/pifs/new" },
    { name: "CIP Project Plan Template", desc: "Standard milestone & task skeleton (9 milestones · 259 tasks) — data removed, structure only.", href: "/CIP_Project_Template.xlsx", download: true },
  ],
};

export function ProjectTemplatesTable() {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (k: string) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });
  return (
    <div className="glass-surface lift-card rounded-2xl overflow-hidden">
      <Table className="text-xs [&_th]:h-8 [&_th]:text-xs [&_td]:py-1.5">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="pl-10">Template</TableHead>
            <TableHead>Description</TableHead>
            <TableHead className="text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {TEMPLATE_TYPES.map(type => {
            const open = expanded.has(type);
            const rows = TYPE_TEMPLATES[type] ?? [];
            return (
              <Fragment key={type}>
                <TableRow className="bg-muted/40 hover:bg-muted/50 cursor-pointer border-t-2 border-border" onClick={() => toggle(type)}>
                  <TableCell colSpan={3} className="py-2">
                    <div className="flex items-center gap-2">
                      {open ? <ChevronDown size={13} className="text-muted-foreground" /> : <ChevronRight size={13} className="text-muted-foreground" />}
                      <span className="w-2 h-2 rounded-full" style={{ background: TYPE_COLOR[type] }} />
                      <span className="text-xs font-bold text-foreground uppercase tracking-wide">{type}</span>
                      <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{rows.length} template{rows.length !== 1 ? "s" : ""}</span>
                    </div>
                  </TableCell>
                </TableRow>
                {open && rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="pl-10 py-3 text-xs text-muted-foreground">No templates yet.</TableCell>
                  </TableRow>
                )}
                {open && rows.map(t => (
                  <TableRow key={t.name} className="group">
                    <TableCell className="pl-10">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 border bg-amber-accent/10 border-amber-accent/30">
                          <FileCheck2 size={12} className="text-amber-accent" />
                        </div>
                        <span className="text-xs font-semibold text-foreground group-hover:text-primary transition-colors">{t.name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{t.desc}</TableCell>
                    <TableCell className="text-right">
                      <a href={t.href} {...(t.download ? { download: true } : {})} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold text-muted-foreground hover:text-primary hover:bg-accent transition-colors">
                        {t.download ? <><Download size={13} /> Download</> : <><FileText size={13} /> Open</>}
                      </a>
                    </TableCell>
                  </TableRow>
                ))}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
