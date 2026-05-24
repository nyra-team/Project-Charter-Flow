// Monday.com-style person avatar — coloured circle with initials.
// Deterministic colour per user id so people are visually recognisable.

const PALETTE = [
  "#6366F1", "#EC4899", "#F59E0B", "#10B981", "#3B82F6",
  "#8B5CF6", "#EF4444", "#14B8A6", "#F97316", "#A855F7",
];

function pickColor(id?: number | null): string {
  if (id == null) return "#94A3B8";
  return PALETTE[Math.abs(id) % PALETTE.length];
}

function initials(name?: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export function PersonAvatar({
  id,
  name,
  size = 22,
}: {
  id?: number | null;
  name?: string | null;
  size?: number;
}) {
  const color = pickColor(id);
  return (
    <span
      title={name ?? ""}
      className="inline-flex items-center justify-center rounded-full font-semibold text-white flex-shrink-0"
      style={{
        width: size,
        height: size,
        background: color,
        fontSize: Math.max(9, Math.floor(size * 0.4)),
        boxShadow: "0 0 0 1.5px rgba(255,255,255,0.6)",
      }}
    >
      {initials(name)}
    </span>
  );
}

export function PersonChip({
  id,
  name,
  onClear,
}: {
  id?: number | null;
  name?: string | null;
  onClear?: () => void;
}) {
  if (!id || !name) {
    return <span className="text-muted-foreground/60 italic text-xs">Unassigned</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5 max-w-full">
      <PersonAvatar id={id} name={name} size={20} />
      <span className="text-xs text-foreground truncate">{name}</span>
      {onClear && (
        <button
          onClick={(e) => { e.stopPropagation(); onClear(); }}
          className="text-muted-foreground/60 hover:text-destructive text-xs"
          title="Clear"
        >
          ×
        </button>
      )}
    </span>
  );
}
