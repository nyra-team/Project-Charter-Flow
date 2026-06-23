import { useEffect, useRef } from "react";

// Device-local autosave for long forms (Charter / e-NFA). Snapshots `values`
// to localStorage (debounced) and restores once on mount via `apply`. No
// backend — survives reload / accidental navigation, scoped per browser.
export function useFormDraft<T extends Record<string, unknown>>(
  key: string,
  values: T,
  apply: (saved: Partial<T>) => void,
  enabled = true,
) {
  const restored = useRef(false);

  // Restore once, before the first save effect runs.
  if (enabled && !restored.current) {
    restored.current = true;
    try {
      const raw = localStorage.getItem(key);
      if (raw) apply(JSON.parse(raw) as Partial<T>);
    } catch { /* corrupt / unavailable storage — start fresh */ }
  }

  useEffect(() => {
    // Once disabled (e.g. after the form is submitted + cleared), stop saving so
    // the debounce can't resurrect a draft that clearFormDraft just removed.
    if (!enabled) return;
    const t = setTimeout(() => {
      try { localStorage.setItem(key, JSON.stringify(values)); } catch { /* quota / private mode */ }
    }, 600);
    return () => clearTimeout(t);
  }, [key, values, enabled]);
}

export function clearFormDraft(key: string) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}
