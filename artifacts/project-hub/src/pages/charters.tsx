import { useListCharters } from "@workspace/api-client-react";
import { formatCurrency, formatDate } from "../lib/format";
import { StatusBadge } from "../components/status-badge";
import { Link } from "wouter";
import { Search, FileText, Plus, ChevronRight, DollarSign, Calendar } from "lucide-react";
import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";

const STATUS_ORDER = [
  "draft", "submitted", "parallel_review", "scm_review",
  "chairman_review", "finance_review", "pmo_review", "approved", "active", "rejected",
];

export default function ChartersList() {
  const { data: charters, isLoading } = useListCharters();
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

  const filterTabs = [
    { id: "all", label: "All", count: charters?.length ?? 0 },
    { id: "draft", label: "Draft", count: statusCounts["draft"] ?? 0 },
    { id: "parallel_review", label: "In Review", count: (statusCounts["parallel_review"] ?? 0) + (statusCounts["scm_review"] ?? 0) + (statusCounts["chairman_review"] ?? 0) },
    { id: "approved", label: "Approved", count: statusCounts["approved"] ?? 0 },
    { id: "active", label: "Active", count: statusCounts["active"] ?? 0 },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Project Charters</h2>
          <p className="text-sm text-gray-500 mt-0.5">Manage and track all project charter requests</p>
        </div>
        <Link href="/charters/new">
          <button
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90 active:scale-95"
            style={{ background: "linear-gradient(135deg, #6366F1, #8B5CF6)" }}
          >
            <Plus size={14} />
            New Charter
          </button>
        </Link>
      </div>

      {/* Filter + Search bar */}
      <div
        className="rounded-2xl p-4 flex flex-col sm:flex-row gap-3 items-start sm:items-center"
        style={{ background: "white", border: "1px solid #E2E8F0" }}
      >
        {/* Status filter tabs */}
        <div className="flex gap-1 flex-wrap">
          {filterTabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setFilterStatus(tab.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
              style={{
                background: filterStatus === tab.id ? "linear-gradient(135deg, #6366F1, #8B5CF6)" : "#F1F5F9",
                color: filterStatus === tab.id ? "white" : "#64748B",
              }}
            >
              {tab.label}
              {tab.count > 0 && (
                <span
                  className="px-1.5 py-0.5 rounded-full text-[10px] font-bold"
                  style={{
                    background: filterStatus === tab.id ? "rgba(255,255,255,0.25)" : "#E2E8F0",
                    color: filterStatus === tab.id ? "white" : "#475569",
                  }}
                >
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative sm:ml-auto w-full sm:w-64">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            placeholder="Search charters..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm rounded-xl outline-none focus:ring-2 focus:ring-indigo-300 transition-all"
            style={{ background: "#F8FAFC", border: "1px solid #E2E8F0" }}
          />
        </div>
      </div>

      {/* Charter cards */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 rounded-2xl" />)}
        </div>
      ) : filteredCharters && filteredCharters.length > 0 ? (
        <div className="space-y-3">
          {filteredCharters.map(charter => (
            <Link key={charter.id} href={`/charters/${charter.id}`}>
              <div
                className="rounded-2xl p-4 flex items-center gap-4 cursor-pointer transition-all hover:shadow-md hover:-translate-y-0.5"
                style={{ background: "white", border: "1px solid #E2E8F0" }}
              >
                {/* Icon */}
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: "linear-gradient(135deg, #EEF2FF, #F5F3FF)" }}
                >
                  <FileText size={18} className="text-indigo-500" />
                </div>

                {/* Main info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-gray-900 truncate">{charter.title}</h3>
                    <StatusBadge status={charter.status} />
                  </div>
                  <div className="flex items-center gap-4 text-xs text-gray-400">
                    <span className="flex items-center gap-1">
                      <DollarSign size={11} />
                      {formatCurrency(charter.tentativeBudget)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Calendar size={11} />
                      {formatDate(charter.createdAt)}
                    </span>
                    {charter.startDate && (
                      <span>Start: {formatDate(charter.startDate)}</span>
                    )}
                  </div>
                </div>

                <ChevronRight size={16} className="text-gray-300 flex-shrink-0" />
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div
          className="rounded-2xl p-12 text-center"
          style={{ background: "white", border: "1px solid #E2E8F0" }}
        >
          <FileText size={32} className="text-gray-200 mx-auto mb-3" />
          <p className="font-medium text-gray-500 mb-1">
            {search ? `No charters found for "${search}"` : "No charters yet"}
          </p>
          <p className="text-sm text-gray-400 mb-4">
            {search ? "Try a different search term" : "Create your first project charter to get started."}
          </p>
          {!search && (
            <Link href="/charters/new">
              <button
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white"
                style={{ background: "linear-gradient(135deg, #6366F1, #8B5CF6)" }}
              >
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
