// ViewSwitcher — the Monday-style segmented control that flips one dataset
// between Table / Board / Timeline / Gantt / Calendar (and Tree where the
// surface is hierarchical). Presentational only; the parent owns which views
// it offers and renders the active one.
import type { ComponentType } from "react";
import { Table2, Kanban, GanttChartSquare, CalendarDays, ListTree, BarChart2, LayoutGrid } from "lucide-react";

export type BoardView = "table" | "board" | "timeline" | "gantt" | "calendar" | "tree" | "cards";

const VIEW_META: Record<BoardView, { label: string; icon: ComponentType<{ size?: number; className?: string }> }> = {
  table: { label: "Table", icon: Table2 },
  board: { label: "Board", icon: Kanban },
  timeline: { label: "Timeline", icon: BarChart2 },
  gantt: { label: "Gantt", icon: GanttChartSquare },
  calendar: { label: "Calendar", icon: CalendarDays },
  tree: { label: "Tree", icon: ListTree },
  cards: { label: "Cards", icon: LayoutGrid },
};

export function ViewSwitcher({
  views, value, onChange, className,
}: {
  views: BoardView[];
  value: BoardView;
  onChange: (v: BoardView) => void;
  className?: string;
}) {
  return (
    <div className={`inline-flex items-center gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5 ${className ?? ""}`}>
      {views.map((v) => {
        const meta = VIEW_META[v];
        const Icon = meta.icon;
        const active = v === value;
        return (
          <button
            key={v}
            onClick={() => onChange(v)}
            aria-pressed={active}
            className={`inline-flex items-center gap-1.5 px-2.5 h-7 rounded-md text-xs font-medium transition-colors ${
              active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon size={13} />
            <span className="hidden sm:inline">{meta.label}</span>
          </button>
        );
      })}
    </div>
  );
}
