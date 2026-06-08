// Consistent page + section headers — larger type, generous spacing, no heavy
// borders. Used to give every redesigned page the same Monday-clean top band.
//
// Interaction (the "Apple notification" pattern the user asked for):
//   • At page load: a LARGE contextual header in normal flow (eyebrow, title,
//     status/health chips, meta rows, stat strip, controls row). It scrolls
//     away naturally as you read down.
//   • On scroll past it: a COMPACT glassmorphic pill SPRINGS IN from the top
//     (framer-motion spring, like an iOS notification / Dynamic Island),
//     floating over the content (content scrolls UNDER it — it sits in a
//     zero-height sticky anchor so it never pushes layout). It carries the
//     title + key chips + search + actions so controls stay reachable, and
//     springs back out when you scroll to the top again.
//
// Self-contained (framer-motion only; listens to the nearest scroll
// container). Pure presentation — renders whatever the caller passes and
// changes no governance/data.

import React, { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft } from "lucide-react";

export interface PageHeaderChip {
  text: string;
  className?: string;
}
export interface PageHeaderMeta {
  label: string;
  value: React.ReactNode;
}
export interface PageHeaderStat {
  label: string;
  value: React.ReactNode;
  valueClassName?: string;
}

function Chip({ c }: { c: PageHeaderChip }) {
  return (
    <span
      className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
        c.className || "bg-muted text-muted-foreground border-border"
      }`}
    >
      {c.text}
    </span>
  );
}

export function PageHeader({
  title,
  subtitle,
  eyebrow,
  icon: Icon,
  chips,
  meta,
  stats,
  search,
  actions,
  onBack,
  children,
  accent = "hsl(var(--primary))",
  className = "",
  titleClassName = "text-2xl sm:text-[28px]",
  pill = true,
}: {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  /** Override the big-header title font size (Tailwind text-* classes). */
  titleClassName?: string;
  /** Show the floating glass pill that springs in on scroll (default true). */
  pill?: boolean;
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  chips?: PageHeaderChip[];
  meta?: PageHeaderMeta[];
  stats?: PageHeaderStat[];
  search?: React.ReactNode;
  actions?: React.ReactNode;
  onBack?: () => void;
  children?: React.ReactNode;
  accent?: string;
  className?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);

  // Detect scroll on the nearest scrollable ancestor (project-hub scrolls
  // inside the Layout's overflow-y-auto container, not the window). The pill
  // appears once the large header has been scrolled past.
  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return;
    let p: HTMLElement | null = node.parentElement;
    while (p && p !== document.body) {
      const oy = getComputedStyle(p).overflowY;
      if (oy === "auto" || oy === "scroll") break;
      p = p.parentElement;
    }
    const target: HTMLElement | Window = p && p !== document.body ? p : window;
    const read = () => {
      const top = target instanceof Window ? window.scrollY : target.scrollTop;
      // Trigger as the large header scrolls past (its own height − a little),
      // so the pill springs in right when the header leaves, not before.
      const h = node.offsetHeight || 120;
      setStuck(top > Math.max(48, h - 56));
    };
    read();
    target.addEventListener("scroll", read, { passive: true });
    return () => target.removeEventListener("scroll", read);
  }, []);

  return (
    <>
      {/* Floating Apple-style pill — zero-height sticky anchor so it overlays
          content (no layout shift); springs in/out on scroll. */}
      <div className="sticky top-0 z-40 h-0 pointer-events-none">
        <AnimatePresence>
          {pill && stuck && (
            <motion.div
              initial={{ y: -60, opacity: 0, scale: 0.95 }}
              animate={{ y: 10, opacity: 1, scale: 1 }}
              exit={{ y: -60, opacity: 0, scale: 0.95 }}
              transition={{ type: "spring", stiffness: 460, damping: 30, mass: 0.7 }}
              className="pointer-events-auto mx-auto flex max-w-4xl items-center gap-3 rounded-2xl border border-border/60 bg-card/75 px-4 py-2.5 shadow-xl shadow-black/10 backdrop-blur-xl"
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: accent }} />
              <h2 className="truncate text-sm font-semibold text-foreground">{title}</h2>
              <div className="hidden items-center gap-1.5 sm:flex">
                {chips?.slice(0, 2).map((c, i) => <Chip key={`p-${c.text}-${i}`} c={c} />)}
              </div>
              {(search || actions) && (
                <div className="ml-auto flex shrink-0 items-center gap-2">
                  {search && <div className="w-40 sm:w-56">{search}</div>}
                  {actions}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Large contextual header — normal flow, scrolls away. */}
      <div
        ref={wrapRef}
        className={`relative mb-6 rounded-2xl border border-card-border bg-card glass-surface ${className}`}
        style={{ backgroundImage: `linear-gradient(90deg, color-mix(in srgb, ${accent} 8%, transparent), transparent 62%)` }}
      >
        <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l-2xl" style={{ backgroundColor: accent }} aria-hidden />

        <div className="flex items-center gap-3 px-5 pt-4 pb-2">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label="Back"
              className="shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
            >
              <ChevronLeft size={18} />
            </button>
          )}
          {Icon && (
            <span className="flex-shrink-0 rounded-lg bg-primary/10 p-2 text-primary">
              <Icon size={20} />
            </span>
          )}
          <div className="min-w-0 flex-1">
            {eyebrow && <p className="text-[10px] font-mono uppercase tracking-[0.22em] text-muted-foreground">{eyebrow}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <h1 className={`truncate font-display font-semibold leading-tight tracking-tight text-foreground ${titleClassName}`}>
                {title}
              </h1>
              {chips?.map((c, i) => <Chip key={`${c.text}-${i}`} c={c} />)}
            </div>
          </div>
          {search && <div className="hidden w-52 shrink-0 sm:block sm:w-64">{search}</div>}
          {actions && <div className="flex flex-shrink-0 items-center gap-2">{actions}</div>}
        </div>

        {(subtitle || (meta?.length ?? 0) > 0 || (stats?.length ?? 0) > 0) && (
          <div className="flex flex-wrap items-end gap-x-8 gap-y-3 px-5 pb-4 pt-1">
            {subtitle && <p className="-mt-1 w-full text-sm text-muted-foreground">{subtitle}</p>}
            {meta && meta.length > 0 && (
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                {meta.map((m, i) => (
                  <div key={`${m.label}-${i}`} className="flex flex-col">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{m.label}</span>
                    <span className="text-sm font-medium text-foreground">{m.value}</span>
                  </div>
                ))}
              </div>
            )}
            {stats && stats.length > 0 && (
              <div className="ml-auto flex items-end gap-6">
                {stats.map((s, i) => (
                  <div key={`${s.label}-${i}`} className="flex flex-col items-end">
                    <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">{s.label}</span>
                    <span className={`text-lg font-bold leading-tight ${s.valueClassName ?? "text-foreground"}`}>{s.value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {children && <div className="px-5 pb-4">{children}</div>}
      </div>
    </>
  );
}

export function SectionHeader({
  title,
  subtitle,
  actions,
  className = "",
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-end justify-between gap-3 mb-3 ${className}`}>
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold tracking-tight text-foreground">{title}</h2>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
    </div>
  );
}
