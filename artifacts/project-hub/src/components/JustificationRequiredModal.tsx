// Mandatory, NON-DISMISSABLE gate. Whenever the signed-in user OWNS a project
// that has gone DELAYED or OFF-TRACK (schedule health — same rule as the
// Delivery bar) and hasn't justified the current episode, this full-screen
// modal blocks the entire app until a justification is submitted. There is no
// close / cancel / Esc / outside-click — the only way out is to submit.
//
// Backend: GET /api/projects/justifications/required (owner's due projects),
// POST /api/project-justifications. The justification then shows in the
// Projects list "Justification" column.

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Kind = "delayed" | "off_track";
type DueItem = { projectId: number; name: string; kind: Kind };

const KIND_META: Record<Kind, { label: string; color: string; line: string }> = {
  delayed: { label: "Delayed", color: "#DC2626", line: "is past its target end date and not yet complete" },
  off_track: { label: "Off Track", color: "#D97706", line: "has fallen behind its schedule" },
};

const MIN_LEN = 10;

export function JustificationRequiredModal() {
  const { toast } = useToast();
  const [due, setDue] = useState<DueItem[]>([]);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/projects/justifications/required", { credentials: "include" });
      if (!r.ok) { setDue([]); return; } // pre-auth 401 etc → no gate
      const data = await r.json();
      setDue(Array.isArray(data) ? (data as DueItem[]) : []);
    } catch { /* offline → don't block */ }
  }, []);

  // Poll on mount, on a slow interval, and whenever the tab regains focus.
  useEffect(() => {
    void refresh();
    const t = window.setInterval(() => void refresh(), 60_000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => { window.clearInterval(t); window.removeEventListener("focus", onFocus); };
  }, [refresh]);

  const current = due[0];

  // Reset the textarea when the project/episode being asked about changes.
  useEffect(() => { setText(""); }, [current?.projectId, current?.kind]);

  if (!current) return null;
  const meta = KIND_META[current.kind];

  async function submit() {
    if (text.trim().length < MIN_LEN || submitting) return;
    setSubmitting(true);
    try {
      const r = await fetch("/api/project-justifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ projectId: current.projectId, kind: current.kind, justification: text.trim() }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        toast({ title: (e as { error?: string })?.error || "Failed to save justification", variant: "destructive" });
        setSubmitting(false);
        return;
      }
      toast({ title: "Justification recorded" });
      // Drop this one and re-check for any further owned projects still due.
      setDue((d) => d.slice(1));
      await refresh();
    } catch {
      toast({ title: "Network error — please try again", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="justify-title"
    >
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        <div className="h-1.5 w-full" style={{ background: meta.color }} />
        <div className="p-6">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full" style={{ background: `${meta.color}1a`, color: meta.color }}>
              <AlertTriangle size={20} />
            </span>
            <div className="min-w-0">
              <h2 id="justify-title" className="text-lg font-bold tracking-tight text-foreground">Justification required</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Your project{" "}
                <span className="font-semibold text-foreground">“{current.name}”</span>{" "}
                <span className="font-semibold uppercase tracking-wider" style={{ color: meta.color }}>{meta.label}</span>{" "}
                — it {meta.line}. Please record why before continuing.
              </p>
            </div>
          </div>

          <textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            placeholder="Explain the reason for the delay / off-track status and the recovery plan…"
            className="mt-4 w-full rounded-xl border border-border bg-white px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/60 outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
          <div className="mt-1 flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">{text.trim().length < MIN_LEN ? `At least ${MIN_LEN} characters` : `${text.trim().length} characters`}</span>
            {due.length > 1 && <span className="text-[11px] font-medium text-muted-foreground">{due.length} projects need a justification</span>}
          </div>

          <div className="mt-5 flex items-center justify-between gap-3">
            <p className="text-[11px] text-muted-foreground">This step is mandatory and can’t be dismissed.</p>
            <button
              type="button"
              onClick={submit}
              disabled={submitting || text.trim().length < MIN_LEN}
              className="inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold text-white shadow-md transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              style={{ background: meta.color }}
            >
              {submitting ? <Loader2 size={15} className="animate-spin" /> : null}
              {submitting ? "Saving…" : "Submit justification"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
