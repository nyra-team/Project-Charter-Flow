// Group-by control — a faithful port of the CXO Action Centre `PillSelect`
// "Group by" dropdown: rounded-full white pill trigger (Group icon + "Group by"
// prefix + current label + chevron that flips open), inline white popover with
// a check on the active option. Shared by the Projects and Tasks kanban boards.
import { useEffect, useRef, useState } from "react";
import { Group, ChevronDown, Check } from "lucide-react";

export type GroupByOption<V extends string> = { value: V; label: string };

export function GroupByPill<V extends string>({ value, onChange, options }: {
  value: V;
  onChange: (v: V) => void;
  options: GroupByOption<V>[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const cur = options.find((o) => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-full border font-medium transition-colors cursor-pointer h-7 px-3 text-[12px] bg-white border-slate-200 text-slate-700 hover:border-slate-300"
      >
        <Group className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        <span className="text-slate-400">Group by</span>
        <span>{cur?.label}</span>
        <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 min-w-[160px] rounded-lg bg-white border border-slate-200 shadow-lg py-1">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => { onChange(o.value); setOpen(false); }}
              className={`w-full flex items-center justify-between px-3 py-1.5 text-[13px] text-left transition-colors hover:bg-slate-50 ${
                o.value === value ? "text-blue-700 font-medium" : "text-slate-700"
              }`}
            >
              {o.label}
              {o.value === value && <Check className="w-3.5 h-3.5 shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
