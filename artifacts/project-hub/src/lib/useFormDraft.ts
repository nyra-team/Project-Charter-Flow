import { useEffect, useRef } from "react";

// Device-local autosave for long forms (Charter / e-NFA). Snapshots `values`
// to localStorage (debounced) and restores once on mount via `apply`. No
// backend — survives reload / accidental navigation, scoped per browser.
export function useFormDraft<T extends Record<string, unknown>>(
  key: string,
  values: T,
  apply: (saved: Partial<T>) => void,
) {
  const restored = useRef(false);

  // Restore once, before the first save effect runs.
  if (!restored.current) {
    restored.current = true;
    try {
      const raw = localStorage.getItem(key);
      if (raw) apply(JSON.parse(raw) as Partial<T>);
    } catch { /* corrupt / unavailable storage — start fresh */ }
  }

  useEffect(() => {
    const t = setTimeout(() => {
      try { localStorage.setItem(key, JSON.stringify(values)); } catch { /* quota / private mode */ }
    }, 600);
    return () => clearTimeout(t);
  }, [key, values]);
}

export function clearFormDraft(key: string) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}
