/**
 * CharterNfaPopup — the "Business Case" entry point as a modal.
 *
 * Both the sidebar "Business Case" CTA and the top-level "Charter + e-NFA"
 * nav item open this popup instead of navigating to a page. The two buttons
 * route the user into the right wizard:
 *   - Project Charter / e-NFA (for Projects)   → /charters/new
 *   - e-NFA (for non-projects)                  → /charters/nfa-new
 */

import { useEffect, Fragment } from "react";
import { useLocation } from "wouter";
import { Sparkles, FolderKanban, FileText, ChevronsRight } from "lucide-react";

const OPTIONS = [
  {
    href: "/charters/new",
    icon: FolderKanban,
    title: "Project Charter / e-NFA for projects",
    subtitle: "Select this workflow for Projects",
    blurb:
      "Build a full Project Charter merged with the e-NFA note — business case, scope, benefits, strategic scoring, investment detail and governance sign-off.",
  },
  {
    href: "/charters/nfa-new",
    icon: FileText,
    title: "e-NFA for non projects",
    subtitle: "Select this workflow for non-projects",
    blurb:
      "Raise a standalone e-NFA note for non-project spend — background, requirement items, recommendation and the approval signatory chain.",
  },
] as const;

export function CharterNfaPopup({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [, navigate] = useLocation();

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const choose = (href: string) => {
    onClose();
    navigate(href);
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      {/* Vertical stack — each option is a full-width row with its description
          visible below the title (no hover card needed). */}
      <div
        className="flex flex-col items-center gap-2.5 w-full max-w-sm"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="charter-nfa-popup-title"
      >
        <p id="charter-nfa-popup-title" className="inline-flex items-center gap-1.5 text-xs font-medium text-white/90 drop-shadow">
          <Sparkles size={12} /> Initiate a Business Case
          <span className="ml-1 text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-white/20 text-white inline-flex items-center gap-1">
            <Sparkles size={8} /> AI assisted
          </span>
        </p>
        <div className="grid gap-2.5 w-full [grid-auto-rows:1fr]">
          {OPTIONS.map((opt) => {
            const Icon = opt.icon;
            return (
              <Fragment key={opt.href}>
                <button
                  type="button"
                  onClick={() => choose(opt.href)}
                  className="group h-full flex flex-col gap-1 rounded-2xl border border-border bg-card shadow-xl px-3.5 py-3 text-left text-card-foreground hover:bg-accent hover:border-primary/50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                >
                  <span className="flex items-center gap-2 w-full">
                    <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-primary/10 text-primary flex-shrink-0">
                      <Icon size={14} />
                    </span>
                    <span className="text-[13px] font-semibold">{opt.title}</span>
                    {/* Floating arrow — highlighted call-to-action, with a styled
                        hover tooltip. */}
                    <span className="relative group/arrow ml-auto flex-shrink-0">
                      <span className="ph-arrow-float inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground shadow-md ring-2 ring-primary/20 transition-all duration-200 group-hover:ring-primary/40 group-hover:shadow-lg group-hover:scale-110">
                        <ChevronsRight size={13} strokeWidth={2.75} />
                      </span>
                      {/* Styled tooltip — appears above the arrow on hover */}
                      <span className="pointer-events-none absolute bottom-full right-0 mb-2 hidden group-hover/arrow:flex items-center whitespace-nowrap rounded-lg bg-foreground text-background text-[10px] font-semibold px-2.5 py-1.5 shadow-xl">
                        Click here to initiate the workflow
                        <span className="absolute top-full right-3 -mt-px h-2 w-2 rotate-45 bg-foreground" />
                      </span>
                    </span>
                  </span>
                  {/* Description below the button row */}
                  <span className="block pl-9 text-[10px] leading-relaxed text-muted-foreground">{opt.blurb}</span>
                </button>
              </Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}
