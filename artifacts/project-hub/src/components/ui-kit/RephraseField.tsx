// RephraseField — a labelled textarea with an inline "Rephrase with AI" button.
//
// The standard narrative-field control for the Charter + e-NFA two-step flow:
// the user edits freely, then clicks "Rephrase with AI" to have the model
// tighten that one field in place (POST /api/ai/improve-text, which preserves
// facts/numbers and returns crisper prose). `context` tells the model what the
// field is so the rewrite stays on-voice.

import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

export function RephraseField({
  label,
  value,
  onChange,
  rows = 3,
  placeholder,
  context,
  required,
  aiEnabled = true,
  onDraft,
  drafting = false,
  textareaClassName,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  textareaClassName?: string;
  placeholder?: string;
  /** What this field is, woven into the rephrase instruction — e.g.
   *  "the 'In Scope' section of a Project Charter". */
  context?: string;
  required?: boolean;
  /** Hide the button when the backend has no LLM configured. */
  aiEnabled?: boolean;
  /** When provided, shows a "Draft with AI" button that generates the field
   *  from scratch (the caller does the drafting + setValue). */
  onDraft?: () => void;
  /** External busy flag for the draft action (drives the button spinner). */
  drafting?: boolean;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  async function rephrase() {
    if (!value.trim()) {
      toast({ title: "Nothing to rephrase yet", description: "Write or edit the text first, then rephrase.", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/ai/improve-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: value,
          instruction: context ? `This is ${context}. Keep the same facts; make it crisp and executive-grade.` : undefined,
        }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e?.message || e?.error || `Rephrase failed (${res.status})`);
      }
      const d = (await res.json()) as { rewritten?: string };
      if (d.rewritten && d.rewritten.trim()) {
        onChange(d.rewritten.trim());
        toast({ title: "Rephrased with AI" });
      }
    } catch (e) {
      toast({ title: (e as Error)?.message || "Rephrase failed", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label className="text-sm font-medium text-foreground">
          {label}
          {required && <span className="text-destructive ml-0.5">*</span>}
        </label>
        {aiEnabled && (
          <div className="flex items-center gap-1.5 shrink-0">
            {onDraft && (
              <button
                type="button"
                onClick={onDraft}
                disabled={drafting || busy}
                title="Draft this field with AI"
                className="inline-flex items-center gap-1.5 px-2.5 h-7 rounded-full text-[11px] font-semibold text-primary-foreground bg-primary hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {drafting ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                {drafting ? "Drafting…" : "Draft with AI"}
              </button>
            )}
            <button
              type="button"
              onClick={rephrase}
              disabled={busy || drafting || !value.trim()}
              title={!value.trim() ? "Write some text first" : "Rephrase this field with AI"}
              className="inline-flex items-center gap-1.5 px-2.5 h-7 rounded-full text-[11px] font-semibold text-primary bg-primary/10 hover:bg-primary/15 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
              {busy ? "Rephrasing…" : "Rephrase with AI"}
            </button>
          </div>
        )}
      </div>
      <Textarea value={value} onChange={(e) => onChange(e.target.value)} rows={rows} placeholder={placeholder} className={textareaClassName} />
    </div>
  );
}
