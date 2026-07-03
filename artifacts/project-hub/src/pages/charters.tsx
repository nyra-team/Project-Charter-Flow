import { useListCharters, useUpdateCharter } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { api, openApiFile } from "@/lib/extra-api";
import { formatCurrency, formatDate } from "../lib/format";
import { Link, useLocation } from "wouter";
import { Search, FileText, Plus, IndianRupee, Calendar, Pencil, CheckCircle2, Download, FileDown } from "lucide-react";
import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { BoardColumn, BoardGroup } from "@/components/monday";
import { KanbanView } from "@/components/monday/KanbanView";

const STATUS_ORDER = [
  "draft", "submitted", "parallel_review", "scm_review",
  "chairman_review", "finance_review", "pmo_review", "approved", "active", "rejected",
];

// eNFA board lanes — collapse the 10 workflow statuses into the 4 the PMO
// tracks day-to-day (All is the unfiltered view). `dropStatus` is the concrete
// status a drag-into-lane persists; `statuses` is what the lane aggregates.
const BUCKETS: { key: string; label: string; color: string; statuses: string[]; dropStatus: string }[] = [
  { key: "draft",     label: "Draft",     color: "#94A3B8", statuses: ["draft"], dropStatus: "draft" },
  { key: "in_review", label: "In Review", color: "#8B5CF6", statuses: ["submitted", "parallel_review", "scm_review", "chairman_review", "finance_review", "pmo_review"], dropStatus: "parallel_review" },
  { key: "approved",  label: "Approved",  color: "#16A34A", statuses: ["approved"], dropStatus: "approved" },
  { key: "active",    label: "Active",    color: "#22C55E", statuses: ["active"], dropStatus: "active" },
];
const bucketOf = (status: string) => BUCKETS.find(b => b.statuses.includes(status));

// Standalone e-NFAs (pmo_nfas) — separate table from charters, shown as their
// own section below the board. Approval progress + signed versions come from
// the signatories/esign jsonb maintained by the Documenso webhook.
type Nfa = {
  id: number;
  noteNo: string;
  subject: string | null;
  status: string;
  createdAt?: string;
  signatories?: Array<{ role?: string; name?: string; email?: string; status?: string }> | null;
  esign?: {
    documentId?: number;
    sentAt?: string;
    completedAt?: string;
    signedObjectPath?: string;
    versions?: Array<{ v: number; path: string; signedBy?: string; at?: string }>;
  } | null;
};

const NFA_STATUS_STYLE: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600",
  pending_approval: "bg-violet-100 text-violet-700",
  approved: "bg-emerald-100 text-emerald-700",
  rejected: "bg-red-100 text-red-700",
};

function NfaSection({ search }: { search: string }) {
  const { data: nfas } = useQuery({
    queryKey: ["/api/nfas"],
    queryFn: () => api.get<Nfa[]>("/api/nfas"),
  });

  const q = search.trim().toLowerCase();
  const rows = (nfas ?? []).filter(n =>
    !q || (n.subject ?? "").toLowerCase().includes(q) || (n.noteNo ?? "").includes(q));
  if (rows.length === 0) return null;

  return (
    <div className="space-y-3">
      <h2 className="text-xl font-bold text-foreground">e-NFAs <span className="text-sm font-normal text-muted-foreground">— standalone Notes for Approval</span></h2>
      <div className="glass-surface rounded-2xl overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="border-b border-border/60">
              {["Note No", "Subject", "Status", "Approvals", "Signed versions", ""].map(h => (
                <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(n => {
              const sigs = n.signatories ?? [];
              const done = sigs.filter(s => s.status === "approved").length;
              const versions = n.esign?.versions ?? [];
              return (
                <tr key={n.id} className="border-b border-border/40 last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-mono font-semibold text-foreground whitespace-nowrap">{n.noteNo}</td>
                  <td className="px-4 py-3 text-foreground max-w-[320px] truncate" title={n.subject ?? ""}>{n.subject || "—"}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${NFA_STATUS_STYLE[n.status] ?? "bg-slate-100 text-slate-600"}`}>
                      {n.status.replace(/_/g, " ")}
                    </span>
                    {n.esign?.documentId && !n.esign?.completedAt && (
                      <span className="ml-1.5 text-[10px] font-medium text-indigo-500 whitespace-nowrap">e-sign sent</span>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-muted-foreground" title={sigs.map(s => `${s.role}: ${s.status}`).join(", ")}>
                    {sigs.length ? `${done}/${sigs.length} signed` : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {versions.map(v => (
                        <button key={v.v} onClick={() => void openApiFile(v.path)}
                          title={`Signed by ${v.signedBy || "?"}${v.at ? ` · ${formatDate(v.at)}` : ""}`}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors">
                          <CheckCircle2 size={10} /> v{v.v}
                        </button>
                      ))}
                      {n.esign?.signedObjectPath && (
                        <button onClick={() => void openApiFile(n.esign!.signedObjectPath!)}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold text-white"
                          style={{ background: "linear-gradient(135deg,#10B981,#059669)" }}>
                          <Download size={10} /> Final PDF
                        </button>
                      )}
                      {!versions.length && !n.esign?.signedObjectPath && <span className="text-muted-foreground">—</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button onClick={() => void openApiFile(`/api/nfas/${n.id}/docx`, `${(n.subject || `e-nfa-${n.noteNo}`).replace(/[^\w.-]+/g, "_")}.docx`)}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline">
                      <FileDown size={11} /> .docx
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type Charter = NonNullable<ReturnType<typeof useListCharters>["data"]>[number];

// `department` is a pmo_charters column the generated client type doesn't model
// (same reason status patches are cast to `never`). Read it through a cast.
const deptOf = (c: Charter) => ((c as unknown as Record<string, unknown>).department as string | undefined)?.trim() ?? "";

// Card cells (same column-config shape as the board's table).
const BOARD_COLUMNS: BoardColumn<Charter>[] = [
  { key: "budget", header: "Budget", render: (c) => (
      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><IndianRupee size={10} />{formatCurrency(c.tentativeBudget)}</span>
  ) },
  { key: "created", header: "Created", render: (c) => (
      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><Calendar size={10} />{formatDate(c.createdAt)}</span>
  ) },
  // Edit Charter — drafts only (matches the detail page's draft-only edit gate).
  // stopPropagation so the card's open-on-click doesn't also fire.
  { key: "edit", header: "", render: (c) => c.status === "draft" ? (
      <Link href={`/charters/${c.id}?edit=1`} onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline">
        <Pencil size={10} /> Edit
      </Link>
  ) : null },
];

export default function ChartersList() {
  const { data: charters, isLoading, refetch } = useListCharters();
  const updateCharter = useUpdateCharter();
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterDept, setFilterDept] = useState<string>("all");

  // Departments present in the data (drop blanks), for the filter dropdown.
  const departments = [...new Set((charters ?? []).map(deptOf).filter(Boolean))].sort();

  const filteredCharters = charters
    ?.filter(c => {
      const matchSearch = c.title.toLowerCase().includes(search.toLowerCase());
      const matchStatus = filterStatus === "all" || bucketOf(c.status)?.key === filterStatus;
      const matchDept = filterDept === "all" || deptOf(c) === filterDept;
      return matchSearch && matchStatus && matchDept;
    })
    .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));

  const statusCounts = charters?.reduce<Record<string, number>>((acc, c) => {
    acc[c.status] = (acc[c.status] ?? 0) + 1;
    return acc;
  }, {}) ?? {};

  // One Kanban column per lane. "All" shows every lane (even empty ones, so you
  // can drag a charter into a stage that has no cards yet); a specific tab keeps
  // only its populated lane.
  const boardGroups: BoardGroup<Charter>[] = BUCKETS
    .map(b => ({ key: b.key, label: b.label, color: b.color, rows: (filteredCharters ?? []).filter(c => bucketOf(c.status)?.key === b.key) }))
    .filter(g => filterStatus === "all" || g.rows.length > 0);

  const filterTabs = [
    { id: "all", label: "All", count: charters?.length ?? 0 },
    ...BUCKETS.map(b => ({ id: b.key, label: b.label, count: b.statuses.reduce((n, s) => n + (statusCounts[s] ?? 0), 0) })),
  ];

  return (
    <div className="space-y-5">
      {/* Header — title + filter tabs + search all on one row */}
      <div className="flex items-center justify-between gap-4 flex-wrap ph-rise">
        <h2 className="text-xl font-bold text-foreground shrink-0">Project Charters</h2>

        <div className="flex flex-1 flex-wrap items-center justify-end gap-3 min-w-0">
          <div className="flex gap-1 flex-wrap">
            {filterTabs.map(tab => {
              const isActive = filterStatus === tab.id;
              return (
                <button
                  key={tab.id}
                  data-tour={tab.id === "approved" ? "tour-charters-approved" : undefined}
                  onClick={() => setFilterStatus(tab.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    isActive
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {tab.label}
                  {tab.count > 0 && (
                    <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                      isActive ? "bg-primary-foreground/20 text-primary-foreground" : "bg-background/70 text-foreground/70"
                    }`}>
                      {tab.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <Select value={filterDept} onValueChange={setFilterDept}>
            <SelectTrigger className="w-full sm:w-44 h-9 text-xs">
              <SelectValue placeholder="All departments" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All departments</SelectItem>
              {departments.map(d => <SelectItem key={d} value={d!}>{d}</SelectItem>)}
            </SelectContent>
          </Select>

          <div className="relative w-full sm:w-56">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/70" />
            <input
              placeholder="Search charters..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm rounded-xl outline-none bg-muted/40 border border-border focus:border-primary/50 focus:ring-2 focus:ring-primary/20 text-foreground placeholder:text-muted-foreground/70 transition-all"
            />
          </div>
        </div>
      </div>

      {/* Charter board */}
      {isLoading ? (
        <div className="flex gap-3 overflow-x-auto">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-64 w-[270px] flex-shrink-0 rounded-lg" />)}
        </div>
      ) : filteredCharters && filteredCharters.length > 0 ? (
        <KanbanView<Charter>
          groups={boardGroups}
          columns={BOARD_COLUMNS}
          getRowId={(c) => `charter:${c.id}`}
          getName={(c) => c.title}
          onOpenRow={(c) => setLocation(`/charters/${c.id}`)}
          onMoveToGroup={(rowId, groupKey) => {
            const id = Number(rowId.replace("charter:", ""));
            const bucket = BUCKETS.find(b => b.key === groupKey);
            if (!id || !bucket) return;
            // Dropping inside the same lane (e.g. scm_review → In Review) isn't a
            // real status change — don't clobber the precise status.
            const cur = charters?.find(c => c.id === id);
            if (cur && bucketOf(cur.status)?.key === bucket.key) return;
            updateCharter.mutate(
              // `status` is an ExtendedCharterPatch field the generated client type
              // doesn't model (same reason charter-detail patches extended columns).
              { id, data: { status: bucket.dropStatus } as never },
              { onSuccess: () => { void refetch(); } },
            );
          }}
        />
      ) : (
        <div className="glass-surface rounded-2xl p-12 text-center ph-rise ph-rise-3">
          <FileText size={32} className="text-muted-foreground/40 mx-auto mb-3" />
          <p className="font-medium text-muted-foreground mb-1">
            {search ? `No charters found for "${search}"` : "No charters yet"}
          </p>
          <p className="text-sm text-muted-foreground/70 mb-4">
            {search ? "Try a different search term" : "Create your first project charter to get started."}
          </p>
          {!search && (
            <Link href="/charters/new">
              <button className="btn-glossy-cta inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold">
                <Plus size={14} />
                New Charter
              </button>
            </Link>
          )}
        </div>
      )}

      {/* Standalone e-NFAs — pmo_nfas, incl. e-sign progress + signed versions */}
      <NfaSection search={search} />
    </div>
  );
}
