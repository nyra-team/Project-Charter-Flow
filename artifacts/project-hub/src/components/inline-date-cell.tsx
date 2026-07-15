import { useState } from "react";

// Click-to-edit date cell used by the grids (milestones, projects). Shows a
// compact "12 Mar 26" and swaps to a date input on click; saves on blur/Enter,
// discards on Escape. An empty value clears the date.
export function InlineDateCell({ value, onSave, title }: { value?: string | null; onSave: (v: string) => void; title?: string }) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState(value ?? "");

  if (!editing) {
    return (
      <span
        title={title}
        className="text-xs text-foreground cursor-pointer hover:bg-primary/10 px-1 rounded block truncate"
        onClick={(e) => { e.stopPropagation(); setLocal(value ?? ""); setEditing(true); }}
      >
        {value
          ? new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" })
          : <span className="text-muted-foreground/60 italic">—</span>}
      </span>
    );
  }

  return (
    <input
      autoFocus
      type="date"
      value={local}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => { setEditing(false); if (local !== (value ?? "")) onSave(local); }}
      onKeyDown={(e) => {
        if (e.key === "Enter") { setEditing(false); if (local !== (value ?? "")) onSave(local); }
        if (e.key === "Escape") setEditing(false);
      }}
      className="text-xs border border-input bg-background text-foreground rounded-md px-1.5 py-0.5 w-full outline-none focus:ring-2 focus:ring-ring/40"
      style={{ maxWidth: 110 }}
    />
  );
}
