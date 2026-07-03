import { useState, useEffect } from "react";
import { Search, X } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TASK_STATUSES, TASK_PRIORITIES } from "../lib/task-constants";

export interface TaskFilters {
  search: string;
  status: string;
  priority: string;
  rag: string;
  dateFrom: string;
  dateTo: string;
}

interface TaskFilterBarProps {
  filters: TaskFilters;
  onChange: (f: TaskFilters) => void;
  owners: Array<{ id: number; name: string }>;
  ownerFilter: string;
  onOwnerChange: (v: string) => void;
  // Kanban groups by status already, so hide the Status/Priority selects there.
  hideStatusPriority?: boolean;
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export function TaskFilterBar({ filters, onChange, owners, ownerFilter, onOwnerChange, hideStatusPriority }: TaskFilterBarProps) {
  const [searchInput, setSearchInput] = useState(filters.search);
  // Search starts collapsed to an icon and pops out the field on click.
  const [searchOpen, setSearchOpen] = useState(!!filters.search);
  const debouncedSearch = useDebounce(searchInput, 280);

  useEffect(() => {
    if (debouncedSearch !== filters.search) {
      onChange({ ...filters, search: debouncedSearch });
    }
  }, [debouncedSearch]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasAny = filters.search || searchInput || filters.status || filters.priority || filters.rag
    || filters.dateFrom || filters.dateTo || ownerFilter;

  function clear() {
    setSearchInput("");
    onChange({ search: "", status: "", priority: "", rag: "", dateFrom: "", dateTo: "" });
    onOwnerChange("");
  }

  return (
    <div className="flex flex-wrap items-center gap-2 py-1">
      {searchOpen ? (
        <div className="relative flex-1 min-w-[180px]">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            autoFocus
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Escape") { setSearchInput(""); setSearchOpen(false); } }}
            placeholder="Search tasks..."
            className="w-full pl-8 pr-7 text-xs border border-input bg-background text-foreground rounded-lg py-1.5 h-8 outline-none focus:ring-2 focus:ring-ring/40"
          />
          <button
            onClick={() => { setSearchInput(""); setSearchOpen(false); }}
            title="Close search"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground"
          >
            <X size={12} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          title="Search tasks"
          className={`inline-flex items-center justify-center h-8 w-8 rounded-lg border border-input transition-colors ${filters.search ? "bg-primary/10 text-primary border-primary/40" : "bg-background text-muted-foreground hover:text-foreground hover:bg-accent"}`}
        >
          <Search size={14} />
        </button>
      )}

      {!hideStatusPriority && (
      <Select value={filters.status} onValueChange={v => onChange({ ...filters, status: v === "all" ? "" : v })}>
        <SelectTrigger className="w-36 h-8 text-xs"><SelectValue placeholder="All Statuses" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Statuses</SelectItem>
          {TASK_STATUSES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
        </SelectContent>
      </Select>
      )}

      {!hideStatusPriority && (
      <Select value={filters.priority} onValueChange={v => onChange({ ...filters, priority: v === "all" ? "" : v })}>
        <SelectTrigger className="w-32 h-8 text-xs"><SelectValue placeholder="All Priorities" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Priorities</SelectItem>
          {TASK_PRIORITIES.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
        </SelectContent>
      </Select>
      )}

      <Select value={filters.rag} onValueChange={v => onChange({ ...filters, rag: v === "all" ? "" : v })}>
        <SelectTrigger className="w-28 h-8 text-xs"><SelectValue placeholder="All RAG" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All RAG</SelectItem>
          <SelectItem value="green">Green</SelectItem>
          <SelectItem value="amber">Amber</SelectItem>
          <SelectItem value="red">Red</SelectItem>
        </SelectContent>
      </Select>

      <Select value={ownerFilter} onValueChange={v => onOwnerChange(v === "all" ? "" : v)}>
        <SelectTrigger className="w-36 h-8 text-xs"><SelectValue placeholder="All Owners" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Owners</SelectItem>
          {owners.map(u => <SelectItem key={u.id} value={u.id.toString()}>{u.name}</SelectItem>)}
        </SelectContent>
      </Select>

      <div className="flex items-center gap-1">
        <span className="text-xs text-muted-foreground whitespace-nowrap">From</span>
        <input
          type="date"
          value={filters.dateFrom}
          onChange={e => onChange({ ...filters, dateFrom: e.target.value })}
          className="text-xs border border-input bg-background text-foreground rounded-md px-1.5 py-1 h-8 outline-none focus:ring-2 focus:ring-ring/40"
          style={{ maxWidth: 128 }}
        />
      </div>
      <div className="flex items-center gap-1">
        <span className="text-xs text-muted-foreground whitespace-nowrap">To</span>
        <input
          type="date"
          value={filters.dateTo}
          onChange={e => onChange({ ...filters, dateTo: e.target.value })}
          className="text-xs border border-input bg-background text-foreground rounded-md px-1.5 py-1 h-8 outline-none focus:ring-2 focus:ring-ring/40"
          style={{ maxWidth: 128 }}
        />
      </div>

      {hasAny && (
        <button
          onClick={clear}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded-lg hover:bg-accent/40 transition-colors"
        >
          <X size={12} /> Clear
        </button>
      )}
    </div>
  );
}

export function applyTaskFilters<T extends {
  name: string;
  status: string;
  priority: string;
  rag?: string | null;
  assigneeId?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  dueDate?: string | null;
}>(items: T[], filters: TaskFilters, ownerFilter: string): T[] {
  return items.filter(t => {
    if (filters.search && !t.name.toLowerCase().includes(filters.search.toLowerCase())) return false;
    if (filters.status && t.status !== filters.status) return false;
    if (filters.priority && t.priority !== filters.priority) return false;
    if (filters.rag && t.rag !== filters.rag) return false;
    if (ownerFilter && t.assigneeId?.toString() !== ownerFilter) return false;
    const effectiveEnd = t.endDate ?? t.dueDate;
    if (filters.dateFrom && effectiveEnd && effectiveEnd < filters.dateFrom) return false;
    if (filters.dateTo && effectiveEnd && effectiveEnd > filters.dateTo) return false;
    return true;
  });
}
