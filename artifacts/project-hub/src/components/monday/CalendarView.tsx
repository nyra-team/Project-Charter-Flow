// CalendarView — the one Monday view type the app was missing. A month grid
// (date-fns, no new dependency) that places work items on their due/target
// date. Generic over any item with a date + title; clicking an item bubbles up.
import { useMemo, useState } from "react";
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval,
  addMonths, subMonths, format, isSameMonth, isSameDay, parseISO, isValid,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getStatusMeta } from "@/lib/task-constants";

export interface CalendarItem {
  id: string | number;
  date: string | null;       // YYYY-MM-DD or ISO
  title: string;
  status?: string;           // drives the dot colour via task-constants
}

function toDate(v?: string | null): Date | null {
  if (!v) return null;
  const d = v.length <= 10 ? parseISO(v) : new Date(v);
  return isValid(d) ? d : null;
}

export function CalendarView<T extends CalendarItem>({
  items, onOpenItem,
}: {
  items: T[];
  onOpenItem?: (item: T) => void;
}) {
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));

  const days = useMemo(() => {
    const gridStart = startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 });
    const gridEnd = endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 });
    return eachDayOfInterval({ start: gridStart, end: gridEnd });
  }, [cursor]);

  const byDay = useMemo(() => {
    const map = new Map<string, T[]>();
    for (const it of items) {
      const d = toDate(it.date);
      if (!d) continue;
      const key = format(d, "yyyy-MM-dd");
      const arr = map.get(key) ?? [];
      arr.push(it);
      map.set(key, arr);
    }
    return map;
  }, [items]);

  const today = new Date();

  return (
    <div className="rounded-xl border border-card-border bg-card glass-surface overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
        <h3 className="text-sm font-semibold text-foreground">{format(cursor, "MMMM yyyy")}</h3>
        <div className="flex items-center gap-1">
          <button onClick={() => setCursor((c) => subMonths(c, 1))} className="p-1.5 rounded-md hover:bg-accent text-muted-foreground" aria-label="Previous month"><ChevronLeft size={15} /></button>
          <button onClick={() => setCursor(startOfMonth(new Date()))} className="px-2 h-7 rounded-md text-xs font-medium hover:bg-accent text-muted-foreground">Today</button>
          <button onClick={() => setCursor((c) => addMonths(c, 1))} className="p-1.5 rounded-md hover:bg-accent text-muted-foreground" aria-label="Next month"><ChevronRight size={15} /></button>
        </div>
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7 border-b border-border bg-muted/30">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-center">{d}</div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const key = format(day, "yyyy-MM-dd");
          const dayItems = byDay.get(key) ?? [];
          const inMonth = isSameMonth(day, cursor);
          const isToday = isSameDay(day, today);
          return (
            <div
              key={key}
              className={`min-h-[96px] border-b border-r border-border/50 p-1.5 ${inMonth ? "" : "bg-muted/20"}`}
            >
              <div className={`text-[11px] mb-1 inline-flex items-center justify-center w-5 h-5 rounded-full ${
                isToday ? "bg-primary text-primary-foreground font-bold" : inMonth ? "text-foreground" : "text-muted-foreground/40"
              }`}>
                {format(day, "d")}
              </div>
              <div className="space-y-1">
                {dayItems.slice(0, 4).map((it) => {
                  const color = it.status ? getStatusMeta(it.status).bg : "#6366F1";
                  return (
                    <button
                      key={it.id}
                      onClick={() => onOpenItem?.(it)}
                      title={it.title}
                      className="w-full flex items-center gap-1 text-left px-1 py-0.5 rounded text-[10px] text-white truncate hover:opacity-90"
                      style={{ background: color }}
                    >
                      <span className="truncate">{it.title}</span>
                    </button>
                  );
                })}
                {dayItems.length > 4 && (
                  <div className="text-[10px] text-muted-foreground pl-1">+{dayItems.length - 4} more</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
