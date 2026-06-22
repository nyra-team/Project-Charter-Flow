import { useListCharters } from "@workspace/api-client-react";
import { formatCurrency, formatDate } from "../lib/format";
import { Link, useLocation } from "wouter";
import { Search, FileText, Plus, IndianRupee, Calendar } from "lucide-react";
import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import type { BoardColumn, BoardGroup } from "@/components/monday";
import { KanbanView } from "@/components/monday/KanbanView";

const STATUS_ORDER = [
  "draft", "submitted", "parallel_review", "scm_review",
  "chairman_review", "finance_review", "pmo_review", "approved", "active", "rejected",
];

// Per-status column label + accent colour for the Kanban board (same board
// component the project view uses).
const STATUS_META: Record<string, { label: string; color: string }> = {
  draft:           { label: "Draft",           color: "#94A3B8" },
  submitted:       { label: "Submitted",       color: "#6366F1" },
  parallel_review: { label: "Parallel Review", color: "#8B5CF6" },
  scm_review:      { label: "SCM Review",       color: "#0EA5E9" },
  chairman_review: { label: "Chairman Review",  color: "#F59E0B" },
  finance_review:  { label: "Finance Review",   color: "#14B8A6" },
  pmo_review:      { label: "PMO Review",        color: "#3B82F6" },
  approved:        { label: "Approved",          color: "#16A34A" },
  active:          { label: "Active",            color: "#22C55E" },
  rejected:        { label: "Rejected",          color: "#EF4444" },
};

type Charter = NonNullable<ReturnType<typeof useListCharters>["data"]>[number];

// Card cells (same column-config shape as the board's table).
const BOARD_COLUMNS: BoardColumn<Charter>[] = [
  { key: "budget", header: "Budget", render: (c) => (
      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><IndianRupee size={10} />{formatCurrency(c.tentativeBudget)}</span>
  ) },
  { key: "created", header: "Created", render: (c) => (
      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><Calendar size={10} />{formatDate(c.createdAt)}</span>
  ) },
];

export default function ChartersList() {
  const { data: charters, isLoading } = useListCharters();
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");

  const filteredCharters = charters
    ?.filter(c => {
      const matchSearch = c.title.toLowerCase().includes(search.toLowerCase());
      const matchStatus = filterStatus === "all" || c.status === filterStatus;
      return matchSearch && matchStatus;
    })
    .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));

  const statusCounts = charters?.reduce<Record<string, number>>((acc, c) => {
    acc[c.status] = (acc[c.status] ?? 0) + 1;
    return acc;
  }, {}) ?? {};

  // Kanban groups — one column per workflow status that currently has charters
  // (after the search/tab filter).
  const boardGroups: BoardGroup<Charter>[] = STATUS_ORDER
    .map(status => {
      const m = STATUS_META[status] ?? { label: status.replace(/_/g, " "), color: "#94A3B8" };
      return { key: status, label: m.label, color: m.color, rows: (filteredCharters ?? []).filter(c => c.status === status) };
    })
    .filter(g => g.rows.length > 0);

  const filterTabs = [
    { id: "all", label: "All", count: charters?.length ?? 0 },
    { id: "draft", label: "Draft", count: statusCounts["draft"] ?? 0 },
    { id: "parallel_review", label: "In Review", count: (statusCounts["parallel_review"] ?? 0) + (statusCounts["scm_review"] ?? 0) + (statusCounts["chairman_review"] ?? 0) },
    { id: "approved", label: "Approved", count: statusCounts["approved"] ?? 0 },
    { id: "active", label: "Active", count: statusCounts["active"] ?? 0 },
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
    </div>
  );
}
