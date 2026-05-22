import { useEffect, useState, useCallback } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "project-hub:theme";

function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  // URL param override (useful for testing/screenshots) — persists into storage
  try {
    const url = new URL(window.location.href);
    const q = url.searchParams.get("theme");
    if (q === "light" || q === "dark") {
      window.localStorage.setItem(STORAGE_KEY, q);
      return q;
    }
  } catch { /* ignore */ }
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (theme === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
  root.style.colorScheme = theme;
}

export function initThemeEarly() {
  applyTheme(getInitialTheme());
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => getInitialTheme());

  useEffect(() => {
    applyTheme(theme);
    try { window.localStorage.setItem(STORAGE_KEY, theme); } catch { /* ignore */ }
  }, [theme]);

  const setTheme = useCallback((next: Theme) => setThemeState(next), []);
  const toggleTheme = useCallback(() => setThemeState(t => (t === "dark" ? "light" : "dark")), []);

  return { theme, setTheme, toggleTheme };
}
