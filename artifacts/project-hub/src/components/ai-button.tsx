import { useState, useEffect, type ReactNode } from "react";
import { Sparkles, Loader2, AlertCircle } from "lucide-react";
import { api, getAiStatus, type AiStatus } from "../lib/extra-api";

let cached: AiStatus | null = null;
let pending: Promise<AiStatus> | null = null;
async function fetchStatus(): Promise<AiStatus> {
  if (cached) return cached;
  if (pending) return pending;
  pending = getAiStatus().then(s => { cached = s; pending = null; return s; }).catch(() => {
    pending = null;
    return { configured: false, provider: "anthropic", model: "" };
  });
  return pending;
}

export function useAiStatus() {
  const [status, setStatus] = useState<AiStatus | null>(cached);
  useEffect(() => { void fetchStatus().then(setStatus); }, []);
  return status;
}

type Props = {
  label?: string;
  endpoint: string; // e.g. /api/ai/charters/12/rewrite-brd
  payload?: Record<string, unknown>;
  onResult?: (data: unknown) => void;
  children?: (state: { run: () => void; loading: boolean; result: unknown; error: string | null }) => ReactNode;
  variant?: "primary" | "ghost" | "subtle";
  size?: "sm" | "md";
  className?: string;
  hideWhenNoKey?: boolean;
};

export function AiButton({ label = "AI Insights", endpoint, payload, onResult, children, variant = "subtle", size = "sm", className, hideWhenNoKey }: Props) {
  const status = useAiStatus();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true); setError(null); setResult(null);
    try {
      const data = await api.post<unknown>(endpoint, payload ?? {});
      setResult(data); onResult?.(data);
    } catch (e: unknown) {
      const msg = (e as Error & { body?: { error?: string; message?: string } })?.body?.error
        ?? (e as Error & { body?: { error?: string; message?: string } })?.body?.message
        ?? (e as Error)?.message ?? "AI request failed";
      setError(msg);
    } finally { setLoading(false); }
  }

  if (children) return <>{children({ run, loading, result, error })}</> as ReactNode;

  if (status && !status.configured && hideWhenNoKey) return null;

  const base = "inline-flex items-center gap-1.5 font-semibold rounded-md transition-all";
  const sizes = size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm";
  const variants = {
    primary: "bg-gradient-to-r from-indigo-500 to-purple-500 text-white hover:from-indigo-600 hover:to-purple-600 shadow-sm",
    ghost: "text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950",
    subtle: "bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-100 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-900",
  }[variant];

  const disabled = loading || (status != null && !status.configured);
  const title = status && !status.configured ? "Add ANTHROPIC_API_KEY in Tools → Secrets to enable" : undefined;

  return (
    <button
      type="button"
      onClick={run}
      disabled={disabled}
      title={title}
      className={`${base} ${sizes} ${variants} disabled:opacity-50 disabled:cursor-not-allowed ${className ?? ""}`}
    >
      {loading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
      {label}
      {error && <AlertCircle size={12} className="text-red-500" />}
    </button>
  );
}

export function AiResultPanel({ title, loading, error, result, render }: {
  title?: string; loading?: boolean; error?: string | null; result: unknown;
  render?: (result: unknown) => ReactNode;
}) {
  if (!loading && !error && !result) return null;
  return (
    <div className="mt-3 rounded-lg border border-indigo-200 dark:border-indigo-900 bg-gradient-to-br from-indigo-50/60 to-purple-50/40 dark:from-indigo-950/30 dark:to-purple-950/20 p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-300 mb-2">
        <Sparkles size={11} /> {title ?? "AI Insights"}
      </div>
      {loading && <div className="text-xs text-indigo-700 dark:text-indigo-300">Thinking…</div>}
      {error && <div className="text-xs text-red-600">{error}</div>}
      {result != null && !loading && !error && (
        render ? render(result) : (
          <pre className="text-xs whitespace-pre-wrap text-gray-700 dark:text-gray-200">
            {typeof result === "string" ? result : JSON.stringify(result, null, 2)}
          </pre>
        )
      )}
    </div>
  );
}
