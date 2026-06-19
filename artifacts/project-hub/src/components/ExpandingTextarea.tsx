import { useRef, useLayoutEffect } from "react";

// A textarea that renders at exactly `minPx` (matching a normal input) and
// grows only once the text no longer fits — up to `maxPx`, after which it
// scrolls. Plain JS auto-grow (no field-sizing, which isn't reliably 36px or
// universally supported). Focus/click never changes the height; only content
// does. Grows inline, so it always stays inside its section.
export function ExpandingTextarea({
  value,
  onChange,
  placeholder,
  rows = 1,
  className = "",
  minPx = 36,
  maxPx = 320,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  className?: string;
  /** default height (matches an h-9 input) */
  minPx?: number;
  /** cap past which it scrolls instead of growing */
  maxPx?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  function resize() {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const h = Math.max(minPx, Math.min(el.scrollHeight, maxPx));
    el.style.height = `${h}px`;
    el.style.overflowY = el.scrollHeight > maxPx ? "auto" : "hidden";
  }

  // Re-fit on value change (typing, AI draft, autosave restore).
  useLayoutEffect(() => { resize(); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
      placeholder={placeholder}
      style={{ height: minPx }}
      className={`w-full resize-none ${className}`}
    />
  );
}
