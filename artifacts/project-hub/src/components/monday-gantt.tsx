// Monday.com-style Gantt — a single shared chart used by both the Projects-page
// Gantt (project bars, grouped by status) and the project-detail Gantt (task /
// subtask bars, grouped by milestone). Monday signature traits:
//   • solid rounded-pill bars in the group colour, with a lighter "remaining"
//     section so progress reads at a glance, plus a subtle shadow
//   • a two-row timeline header — Month / Year on top, Day or Week below — with
//     weekend columns shaded; Day · Week · Month · Year zoom presets (+ pinch)
//   • collapsible groups, each with an overarching rounded "summary" bar that
//     spans its items' date range
//   • milestone rows shown as diamonds
//   • dependency arrows (predecessor → successor) drawn as elbow connectors
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Check } from "lucide-react";

const DAY_MS = 86_400_000;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const msTime = (s?: string | null) => (s ? new Date(s.slice(0, 10)).getTime() : null);
const dayFloor = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const pad2 = (n: number) => String(n).padStart(2, "0");
// ISO-8601 week number (weeks start Monday; week 1 contains the first Thursday).
function isoWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  return 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
}

const SCALES = [
  { key: "day", label: "Day", px: 84 },
  { key: "week", label: "Week", px: 22 },
  { key: "month", label: "Month", px: 9 },
  { key: "year", label: "Year", px: 2.6 },
] as const;

export type GanttItem = {
  id: number;
  name: string;
  code?: string;
  start?: string | null;
  end?: string | null;
  progress?: number;          // 0-100
  color: string;              // bar colour
  depth?: number;             // indentation level (subtasks)
  isMilestone?: boolean;
  predecessorIds?: number[];  // for dependency arrows
  dim?: boolean;              // de-emphasise (e.g. off the critical path)
  emphasise?: boolean;        // ring + shadow (e.g. on the critical path)
  meta?: ReactNode;           // extra content under the name in the label rail
  // Milestone markers drawn ON this bar (diamonds at their dates). done ⇒ solid
  // green, else hollow (white + green outline). For "project bar with milestones".
  markers?: { date: string; done: boolean; label?: string }[];
};
export type GanttGroup = {
  key: string; label: string; color: string; items: GanttItem[];
  // Optional group-level dependency (e.g. milestone → milestone). When set, an
  // arrow is drawn from each predecessor group's summary bar to this one's.
  // `id` keys the group for predecessor lookups; both reference group ids.
  id?: number;
  predecessorIds?: number[];
};

const ROW_H = 42;
const GROUP_H = 36;
const BAR_H = 22;
// Milestone diamond (14px box, rotated 45°, drawn at left-1) → tips sit ~4px
// left and ~16px right of xOf(date). Offsets to land dependency arrows just
// outside it (3px gap) instead of inside, where the diamond would cover them.
const MS_LEFT = -7;
const MS_RIGHT = 19;

export function MondayGantt({
  groups,
  onOpen,
  onLink,
  showDeps = false,
  labelWidth = 320,
  labelHeader = "Name",
  labelHeaderExpanded,
  extraControls,
  autoFitOnLoad = false,
  defaultCollapsed = false,
  flat = false,
}: {
  groups: GanttGroup[];
  onOpen?: (id: number) => void;
  /** When provided, each bar / milestone grows a Monday-style round "connect"
   *  handle on hover. Dragging it onto another bar links the two as a
   *  dependency — `onLink(predecessorId, successorId)` fires on drop (the bar
   *  you drag FROM is the predecessor, the bar you drop ON is the successor). */
  onLink?: (predecessorId: number, successorId: number) => void;
  showDeps?: boolean;
  labelWidth?: number;
  labelHeader?: string;
  /** When a group (milestone) is expanded, the label-column header switches to
   *  this — e.g. "Milestones" collapsed → "Tasks" once a milestone is opened. */
  labelHeaderExpanded?: string;
  extraControls?: ReactNode;
  /** When true, the chart sizes itself to show the whole timeline without
   *  horizontal scrolling on first load (and once more when async data first
   *  arrives). Subsequent manual zoom / "Auto fit" clicks are never overridden. */
  autoFitOnLoad?: boolean;
  /** Collapse every group on first load (groups often arrive async, so this
   *  fires once when the first non-empty group set lands). User toggles after
   *  are preserved. */
  defaultCollapsed?: boolean;
  /** Flat mode: drop the group header band + summary bar + label-rail group
   *  header, rendering the item bars directly (always expanded). For lists that
   *  are conceptually a single flat set — e.g. one bar per project, no
   *  milestone/group layer. */
  flat?: boolean;
}) {
  const [pxPerDay, setPxPerDay] = useState(22);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const didInitCollapse = useRef(false);
  useEffect(() => {
    if (!defaultCollapsed || didInitCollapse.current || groups.length === 0) return;
    didInitCollapse.current = true;
    setCollapsed(Object.fromEntries(groups.map((g) => [g.key, true])));
  }, [defaultCollapsed, groups]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const pxRef = useRef(pxPerDay);
  useEffect(() => { pxRef.current = pxPerDay; }, [pxPerDay]);

  // ── Drag-to-link (Monday-style dependency creation) ────────────────────
  // `linkSrc` is the predecessor a connector is being dragged from; `linkCur`
  // tracks the cursor (in timeline-track coords) so we can rubber-band a live
  // line to it; `hoverTarget` is the bar currently under the cursor (the
  // would-be successor, highlighted with a ring). Refs mirror the state so the
  // window-level mouse handlers read fresh values without re-subscribing.
  const [linkSrc, setLinkSrc] = useState<{ id: number; x: number; y: number } | null>(null);
  const [linkCur, setLinkCur] = useState<{ x: number; y: number } | null>(null);
  const [hoverTarget, setHoverTarget] = useState<number | null>(null);
  const linkSrcRef = useRef(linkSrc);
  const hoverTargetRef = useRef<number | null>(null);
  useEffect(() => { linkSrcRef.current = linkSrc; }, [linkSrc]);
  const setTarget = (v: number | null) => { hoverTargetRef.current = v; setHoverTarget(v); };
  useEffect(() => {
    if (!linkSrc) return;
    const onMove = (e: MouseEvent) => {
      const r = trackRef.current?.getBoundingClientRect();
      if (r) setLinkCur({ x: e.clientX - r.left, y: e.clientY - r.top });
    };
    const onUp = () => {
      const tgt = hoverTargetRef.current;
      const src = linkSrcRef.current?.id;
      if (src != null && tgt != null && tgt !== src) onLink?.(src, tgt);
      setTarget(null);
      setLinkSrc(null);
      setLinkCur(null);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [linkSrc, onLink]);

  // Zoom-preset dropdown (Day / Week / Month / Year).
  const [zoomMenuOpen, setZoomMenuOpen] = useState(false);
  const zoomMenuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!zoomMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (zoomMenuRef.current && !zoomMenuRef.current.contains(e.target as Node)) setZoomMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [zoomMenuOpen]);

  // Auto-fit-on-load bookkeeping. `totalDaysRef` is written during render (once
  // the data range is known) and read by the effect below — it stays 0 while
  // there's no chartable data, so the one-shot fit waits for real data instead
  // of firing against an empty range. `didInitialFit` makes the fit one-shot so
  // a user's manual zoom isn't clobbered on later re-renders.
  const totalDaysRef = useRef(0);
  const didInitialFit = useRef(false);
  useEffect(() => {
    if (!autoFitOnLoad || didInitialFit.current) return;
    const el = scrollRef.current;
    if (!el) return;
    const td = totalDaysRef.current;
    if (td <= 0) return;
    const avail = el.clientWidth - labelWidth - 4;
    if (avail > 24) {
      setPxPerDay(Math.max(0.5, Math.min(120, avail / td)));
      didInitialFit.current = true;
    }
  });

  // Continuous zoom — Ctrl+scroll / two-finger pinch.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const clamp = (v: number) => Math.min(120, Math.max(1, v));
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setPxPerDay((v) => clamp(v * (e.deltaY < 0 ? 1.12 : 0.89)));
    };
    const dist = (t: TouchList) => Math.hypot(t[0]!.clientX - t[1]!.clientX, t[0]!.clientY - t[1]!.clientY);
    let pinchStart = 0, pinchBase = 0;
    const onTouchStart = (e: TouchEvent) => { if (e.touches.length === 2) { pinchStart = dist(e.touches); pinchBase = pxRef.current; } };
    const onTouchMove = (e: TouchEvent) => { if (e.touches.length === 2 && pinchStart) { e.preventDefault(); setPxPerDay(clamp(pinchBase * (dist(e.touches) / pinchStart))); } };
    const onTouchEnd = () => { pinchStart = 0; };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, []);

  const activeScale = SCALES.reduce((best, p) => (Math.abs(p.px - pxPerDay) < Math.abs(best.px - pxPerDay) ? p : best)).key;

  const allItems = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  const times: number[] = [];
  for (const it of allItems) { const s = msTime(it.start), e = msTime(it.end); if (s != null) times.push(s); if (e != null) times.push(e); }

  if (allItems.length === 0) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white text-sm text-muted-foreground text-center py-10">
        No start / end dates to chart.
      </div>
    );
  }

  // Items exist but none are dated (e.g. a search that matches only undated
  // projects) — anchor a default ±2-week window on today so their rows still
  // render with the "No dates" chip instead of the whole chart blanking out.
  if (times.length === 0) {
    const anchor = dayFloor(Date.now());
    times.push(anchor - DAY_MS * 14, anchor + DAY_MS * 14);
  }

  // Real data range (un-padded) — month labels only render for months that
  // actually contain a task, so an empty leading/trailing month (e.g. a few
  // padding days bleeding into the previous month) never shows.
  const earliest = dayFloor(Math.min(...times));
  const latest = dayFloor(Math.max(...times));
  const minMs = earliest - DAY_MS * 3;
  const maxMs = latest + DAY_MS * 3;
  const totalDays = Math.max(1, Math.round((maxMs - minMs) / DAY_MS) + 1);
  totalDaysRef.current = totalDays;
  const trackW = totalDays * pxPerDay;
  const xOf = (t: number) => ((dayFloor(t) - minMs) / DAY_MS) * pxPerDay;

  // Auto fit — pick the pixels-per-day that makes the whole timeline fill the
  // visible width (no horizontal scroll).
  const autoFit = () => {
    const el = scrollRef.current;
    if (!el || totalDays <= 0) return;
    const avail = el.clientWidth - labelWidth - 4;
    if (avail > 24) setPxPerDay(Math.max(0.5, Math.min(120, avail / totalDays)));
  };

  // Header granularity, aligned with the Day/Week/Month/Year presets:
  //   Day  (≥40px)  → individual day numbers
  //   Week (14–40)  → one "W## dd–dd" label per week (no per-day dates)
  //   Month/Year (<14) → Year on top, month names below (no dates at all)
  const dayScale = pxPerDay >= 40;
  const weekScale = pxPerDay >= 14 && pxPerDay < 40;
  const monthMode = pxPerDay < 14;

  // Month boundaries (top header at day/week zoom; bottom header at month/year zoom).
  const months: Date[] = [];
  const curM = new Date(minMs); curM.setDate(1);
  while (curM.getTime() <= maxMs) { months.push(new Date(curM)); curM.setMonth(curM.getMonth() + 1); }

  // Year boundaries (top header at month/year zoom).
  const years: { year: number; start: number; end: number }[] = [];
  {
    const yA = new Date(minMs).getFullYear(), yB = new Date(maxMs).getFullYear();
    for (let yy = yA; yy <= yB; yy++) {
      years.push({ year: yy, start: new Date(yy, 0, 1).getTime(), end: new Date(yy + 1, 0, 1).getTime() });
    }
  }

  // Bottom header ticks — days (day scale) or week-starts (Mondays, week scale).
  const dayTicks: number[] = [];
  if (dayScale) for (let i = 0; i < totalDays; i++) dayTicks.push(minMs + i * DAY_MS);
  const weekTicks: number[] = [];
  if (weekScale) {
    const first = new Date(minMs);
    const offset = (first.getDay() + 6) % 7; // days since Monday
    let t = minMs - offset * DAY_MS;
    while (t <= maxMs) { weekTicks.push(t); t += 7 * DAY_MS; }
  }

  const today = Date.now();
  const todayInRange = today >= minMs && today <= maxMs;

  // Lay rows out vertically; remember each item's centre-Y for arrows.
  const centerY = new Map<number, number>();
  let y = 0;
  const GH = flat ? 0 : GROUP_H;
  const laid = groups.map((g) => {
    const headerY = y; y += GH;
    const open = flat ? true : !collapsed[g.key];
    if (open) for (const it of g.items) { centerY.set(it.id, y + ROW_H / 2); y += ROW_H; }
    // Group span (summary bar) across its items' dates.
    const gTimes: number[] = [];
    for (const it of g.items) { const s = msTime(it.start), e = msTime(it.end); if (s != null) gTimes.push(s); if (e != null) gTimes.push(e); }
    const span = gTimes.length ? { lo: Math.min(...gTimes), hi: Math.max(...gTimes) } : null;
    return { g, headerY, open, span };
  });
  const bodyH = y;

  // Dependency arrows (predecessor end → successor start), only for items both
  // currently rendered (their group is expanded).
  const arrows: { x1: number; y1: number; x2: number; y2: number; critical: boolean }[] = [];
  if (showDeps) {
    const byId = new Map<number, GanttItem>();
    for (const it of allItems) byId.set(it.id, it);
    for (const it of allItems) {
      const succY = centerY.get(it.id);
      if (succY == null || !it.predecessorIds?.length) continue;
      const succStart = msTime(it.start) ?? msTime(it.end);
      if (succStart == null) continue;
      for (const pid of it.predecessorIds) {
        const predY = centerY.get(pid);
        const pred = byId.get(pid);
        if (predY == null || !pred) continue;
        const predEnd = msTime(pred.end) ?? msTime(pred.start);
        if (predEnd == null) continue;
        // Anchor points. A task bar is entered/left at its edges; a milestone
        // is a 14px diamond centred ~6px right of xOf(date) with tips ~±10px, so
        // land the arrow just OUTSIDE the diamond (else the arrowhead is buried
        // inside it and reads as "merged into the milestone").
        const x1 = pred.isMilestone ? xOf(predEnd) + MS_RIGHT : xOf(predEnd) + pxPerDay;
        const x2 = it.isMilestone ? xOf(succStart) + MS_LEFT : xOf(succStart);
        // Monday-style critical path: an edge is "critical" (drawn as a red
        // connector) only when BOTH endpoints sit on the critical path — i.e.
        // the caller flagged them with `emphasise`.
        arrows.push({ x1, y1: predY, x2, y2: succY, critical: !!(pred.emphasise && it.emphasise) });
      }
    }
    // Group-level (milestone → milestone) arrows between summary bars. The
    // summary bar sits at the group header's mid-line spanning [lo, hi]; we link
    // a predecessor group's end to this group's start. Always visible (groups
    // render even when collapsed), so the milestone chain reads as a roadmap.
    const groupAnchor = new Map<number, { y: number; lo: number; hi: number }>();
    for (const { g, headerY, span } of laid) {
      if (g.id != null && span) groupAnchor.set(g.id, { y: headerY + GROUP_H / 2, lo: span.lo, hi: span.hi });
    }
    for (const { g, headerY, span } of laid) {
      if (g.id == null || !g.predecessorIds?.length || !span) continue;
      const succY = headerY + GROUP_H / 2;
      for (const pid of g.predecessorIds) {
        const pred = groupAnchor.get(pid);
        if (!pred) continue;
        // Stop 4px short of the successor bar's left edge so the arrowhead sits
        // beside the summary bar, not tucked under it.
        arrows.push({ x1: xOf(pred.hi) + pxPerDay, y1: pred.y, x2: xOf(span.lo) - 4, y2: succY, critical: false });
      }
    }
    // Draw the red critical edges last so the chain reads on top of the grey ones.
    arrows.sort((a, b) => Number(a.critical) - Number(b.critical));
  }
  // True when a critical path is active — used to fade the off-path arrows.
  const hasCritical = arrows.some((a) => a.critical);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden shadow-sm">
      {/* Toolbar — zoom presets + caller controls */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-gray-200 bg-white">
        <div className="relative" ref={zoomMenuRef}>
          <button
            type="button"
            onClick={() => setZoomMenuOpen((o) => !o)}
            title="Timeline zoom"
            className="inline-flex items-center gap-1 px-2.5 h-6 rounded-md text-[11px] font-medium bg-white border border-gray-200 text-gray-600 hover:bg-gray-100 transition-colors"
          >
            {SCALES.find((s) => s.key === activeScale)?.label ?? "Zoom"}
            <ChevronDown size={12} className={`text-gray-400 transition-transform ${zoomMenuOpen ? "rotate-180" : ""}`} />
          </button>
          {zoomMenuOpen && (
            <div className="absolute left-0 top-full mt-1 z-50 min-w-[124px] rounded-lg border border-gray-200 bg-white shadow-lg py-1">
              {SCALES.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => { setPxPerDay(s.px); setZoomMenuOpen(false); }}
                  className={`flex items-center justify-between w-full px-3 h-7 text-[11px] font-medium text-left transition-colors ${activeScale === s.key ? "text-primary bg-primary/10" : "text-gray-600 hover:bg-gray-100"}`}
                >
                  {s.label}
                  {activeScale === s.key && <Check size={12} />}
                </button>
              ))}
            </div>
          )}
        </div>
        <span className="mx-1 w-px h-5 bg-gray-200" />
        <button
          type="button"
          onClick={autoFit}
          title="Auto fit — size the timeline to show the whole project without scrolling"
          className="px-2.5 h-6 rounded-md text-[11px] font-medium transition-colors bg-white border border-gray-200 text-gray-500 hover:bg-gray-200"
        >
          Auto fit
        </button>
        <span className="ml-2 text-[10px] text-gray-400 hidden sm:inline">Ctrl+scroll / pinch to zoom</span>
        {extraControls && <div className="ml-auto flex items-center gap-1">{extraControls}</div>}
      </div>

      <div className="overflow-auto max-h-[70vh]" ref={scrollRef}>
        <div style={{ width: labelWidth + trackW }} className="relative">
          {/* ── Header row ───────────────────────────────────────────── */}
          <div className="flex sticky top-0 z-30">
            <div
              style={{ width: labelWidth }}
              className="shrink-0 sticky left-0 z-40 bg-white border-r border-b border-gray-200 flex items-end px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400"
            >
              {groups.some((g) => !collapsed[g.key]) && labelHeaderExpanded ? labelHeaderExpanded : labelHeader}
            </div>
            <div className="relative bg-white border-b border-gray-200" style={{ width: trackW, height: 40 }}>
              {/* divider between the year/month names (top) and the day/week
                  labels (bottom), separating them from the data below */}
              <div className="absolute left-0 right-0 bg-gray-200" style={{ top: 20, height: 1 }} />
              {/* TOP ROW — the larger unit. Zoomed in (day/week): Month + Year.
                  Zoomed out (month/year): just the Year, spanning its months, so
                  labels never overlap. Left-aligned, not clipped. */}
              {monthMode
                ? years.map((y, i) => {
                    if (y.start > maxMs || y.end <= minMs) return null;
                    const x = Math.max(0, xOf(Math.max(y.start, minMs)));
                    const xEnd = xOf(Math.min(y.end, maxMs));
                    return (
                      <div
                        key={`y${i}`}
                        className="absolute top-0 h-5 flex items-center justify-center border-l border-gray-200 text-[11px] font-semibold text-gray-600 overflow-hidden"
                        style={{ left: x, width: Math.max(0, xEnd - x) }}
                      >
                        {y.year}
                      </div>
                    );
                  })
                : months.map((m, i) => {
                    const mStart = m.getTime();
                    const mEnd = i + 1 < months.length ? months[i + 1]!.getTime() : maxMs;
                    if (mStart > latest || mEnd <= earliest) return null;
                    const x = Math.max(0, xOf(mStart));
                    const xEnd = i + 1 < months.length ? xOf(months[i + 1]!.getTime()) : trackW;
                    return (
                      <div
                        key={`m${i}`}
                        className="absolute top-0 h-5 flex items-center justify-center border-l border-gray-200 text-[11px] font-semibold text-gray-600 whitespace-nowrap overflow-hidden"
                        style={{ left: x, width: Math.max(0, xEnd - x) }}
                      >
                        {MON[m.getMonth()]} {m.getFullYear()}
                      </div>
                    );
                  })}
              {/* BOTTOM ROW — the smaller unit: day numbers / week-start dates /
                  month abbreviations (when zoomed out). */}
              {dayScale && dayTicks.map((t, i) => {
                const wd = new Date(t).getDay();
                return (
                  <div
                    key={`d${i}`}
                    className={`absolute top-5 h-5 flex items-center justify-center text-[9px] tabular-nums border-l border-gray-200 ${wd === 0 || wd === 6 ? "text-gray-400" : "text-gray-500"}`}
                    style={{ left: xOf(t), width: pxPerDay }}
                  >
                    {new Date(t).getDate()}
                  </div>
                );
              })}
              {weekScale && weekTicks.map((t, i) => {
                const start = new Date(t);
                const end = new Date(t + 6 * DAY_MS);
                return (
                  <div
                    key={`w${i}`}
                    className="absolute top-5 h-5 flex items-center justify-center text-[9px] font-medium text-gray-500 tabular-nums border-l border-gray-200 whitespace-nowrap overflow-hidden"
                    style={{ left: xOf(t), width: 7 * pxPerDay }}
                  >
                    W{isoWeek(start)} · {pad2(start.getDate())}–{pad2(end.getDate())}
                  </div>
                );
              })}
              {monthMode && months.map((m, i) => {
                const mStart = m.getTime();
                const mEnd = i + 1 < months.length ? months[i + 1]!.getTime() : maxMs;
                if (mStart > latest || mEnd <= earliest) return null;
                const x = Math.max(0, xOf(mStart));
                const xEnd = i + 1 < months.length ? xOf(months[i + 1]!.getTime()) : trackW;
                return (
                  <div
                    key={`mb${i}`}
                    className="absolute top-5 h-5 flex items-center justify-center border-l border-gray-200 text-xs font-semibold text-gray-700 whitespace-nowrap overflow-hidden"
                    style={{ left: x, width: Math.max(0, xEnd - x) }}
                  >
                    {MON[m.getMonth()]}
                  </div>
                );
              })}
              {todayInRange && (
                <div className="absolute z-30 -translate-x-1/2" style={{ left: xOf(today), bottom: -4 }}>
                  <span className="block w-2.5 h-2.5 rounded-full border-2 border-white shadow" style={{ background: "#0073ea" }} />
                </div>
              )}
            </div>
          </div>

          {/* ── Body ─────────────────────────────────────────────────── */}
          <div className="flex">
            {/* Label rail — pinned left when scrolling the timeline horizontally.
                z-30 keeps it above the today line / bars so they tuck under it. */}
            <div style={{ width: labelWidth }} className="shrink-0 sticky left-0 z-30 bg-white border-r border-gray-200">
              {laid.map(({ g, open }) => (
                <Fragment key={g.key}>
                  {!flat && (
                  <button
                    type="button"
                    onClick={() => setCollapsed((c) => ({ ...c, [g.key]: !c[g.key] }))}
                    style={{ height: GROUP_H }}
                    className="w-full flex items-center gap-2 px-2 bg-white border-b border-gray-200 text-left hover:bg-gray-50"
                  >
                    <ChevronDown size={14} className={`text-gray-400 transition-transform ${open ? "" : "-rotate-90"}`} />
                    <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: g.color }} />
                    <span className="text-xs font-semibold text-gray-800 truncate">{g.label}</span>
                    <span className="text-[10px] text-gray-400">({g.items.length})</span>
                  </button>
                  )}
                  {open && g.items.map((it) => (
                    <div
                      key={it.id}
                      style={{ height: ROW_H }}
                      onClick={() => onOpen?.(it.id)}
                      className={`flex flex-col justify-center gap-0.5 px-2 border-b border-gray-200 overflow-hidden hover:bg-accent/40 ${onOpen ? "cursor-pointer" : ""} ${it.dim ? "opacity-40" : ""}`}
                    >
                      <div className="flex items-center gap-1.5 min-w-0" style={{ paddingLeft: (it.depth ?? 0) * 14 }}>
                        {it.isMilestone && <span className="w-2 h-2 rotate-45 shrink-0" style={{ background: it.color }} />}
                        {it.code && <span className="font-mono text-[10px] text-gray-400 shrink-0">{it.code}</span>}
                        <span className="text-xs font-medium text-gray-800 truncate min-w-0" title={it.name}>{it.name}</span>
                      </div>
                      {it.meta && <div className="flex items-center gap-1.5 pl-0.5 min-w-0">{it.meta}</div>}
                    </div>
                  ))}
                </Fragment>
              ))}
            </div>

            {/* Timeline */}
            <div ref={trackRef} className="relative" style={{ width: trackW, height: bodyH }}>
              {/* vertical gridlines — ONE set per active scale (so week view
                  doesn't get a month line a few days off every week line). In
                  day / month / year view the stronger boundary lines land on a
                  column line, so they coincide rather than doubling up. */}
              {dayScale && dayTicks.map((t, i) => (
                <div key={`dg${i}`} className="absolute top-0 bottom-0 w-px bg-gray-200" style={{ left: xOf(t) }} />
              ))}
              {dayScale && months.map((m, i) => { const x = xOf(m.getTime()); return x < 0 ? null : <div key={`dmg${i}`} className="absolute top-0 bottom-0 w-px bg-gray-300" style={{ left: x }} />; })}
              {weekScale && weekTicks.map((t, i) => (
                <div key={`wg${i}`} className="absolute top-0 bottom-0 w-px bg-gray-200" style={{ left: xOf(t) }} />
              ))}
              {monthMode && months.map((m, i) => { const x = xOf(m.getTime()); return x < 0 ? null : <div key={`mg${i}`} className="absolute top-0 bottom-0 w-px bg-gray-200" style={{ left: x }} />; })}
              {monthMode && years.map((y, i) => { const x = xOf(y.start); return (x < 0 || x > trackW) ? null : <div key={`yg${i}`} className="absolute top-0 bottom-0 w-px bg-gray-300" style={{ left: x }} />; })}
              {/* horizontal row separators (align with the label rail) */}
              {Array.from(centerY.values()).map((cy, i) => (
                <div key={`row${i}`} className="absolute left-0 right-0 border-b border-gray-200" style={{ top: cy - ROW_H / 2, height: ROW_H }} />
              ))}
              {/* today line — Monday-style thin blue marker */}
              {todayInRange && <div className="absolute top-0 bottom-0 z-20" style={{ left: xOf(today), width: 2, marginLeft: -1, background: "#0073ea" }} />}

              {/* dependency arrows */}
              {showDeps && arrows.length > 0 && (
                <svg className="absolute inset-0 z-20 pointer-events-none overflow-visible" width={trackW} height={bodyH}>
                  <defs>
                    <marker id="mg-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                      <path d="M0,0 L6,3 L0,6 Z" fill="#9ca3af" />
                    </marker>
                    <marker id="mg-arrow-crit" markerWidth="7" markerHeight="7" refX="5" refY="3" orient="auto">
                      <path d="M0,0 L6,3 L0,6 Z" fill="#e2445c" />
                    </marker>
                  </defs>
                  {arrows.map((a, i) => {
                    // Elbow connector. When the successor starts with room ahead of
                    // the predecessor's end, a simple 3-segment elbow reads cleanly.
                    // When it starts at/left of it (x2 near/behind x1), that elbow
                    // would double back through the bars — so route around: exit the
                    // predecessor right, drop into the gutter between the two rows,
                    // travel left, then enter the successor from its left.
                    const stub = 10;
                    const d =
                      a.x2 >= a.x1 + 2 * stub
                        ? `M ${a.x1} ${a.y1} H ${a.x2 - stub} V ${a.y2} H ${a.x2}`
                        : `M ${a.x1} ${a.y1} h ${stub} V ${(a.y1 + a.y2) / 2} H ${a.x2 - stub} V ${a.y2} H ${a.x2}`;
                    return (
                      <path
                        key={i}
                        d={d}
                        fill="none"
                        stroke={a.critical ? "#e2445c" : "#9ca3af"}
                        strokeWidth={a.critical ? 2 : 1.2}
                        // When a critical chain is shown, fade the off-path links
                        // so the red critical path stands clearly apart from them.
                        opacity={hasCritical && !a.critical ? 0.2 : 1}
                        markerEnd={a.critical ? "url(#mg-arrow-crit)" : "url(#mg-arrow)"}
                      />
                    );
                  })}
                </svg>
              )}

              {/* live drag-to-link connector (rubber band) */}
              {linkSrc && linkCur && (
                <svg className="absolute inset-0 z-20 pointer-events-none overflow-visible" width={trackW} height={bodyH}>
                  <defs>
                    <marker id="mg-link-live" markerWidth="7" markerHeight="7" refX="5" refY="3" orient="auto">
                      <path d="M0,0 L6,3 L0,6 Z" fill="#0073ea" />
                    </marker>
                  </defs>
                  <path
                    d={`M ${linkSrc.x} ${linkSrc.y} H ${Math.max(linkSrc.x + 8, linkCur.x - 8)} V ${linkCur.y} H ${linkCur.x}`}
                    fill="none"
                    stroke="#0073ea"
                    strokeWidth={2}
                    strokeDasharray="4 3"
                    markerEnd="url(#mg-link-live)"
                  />
                </svg>
              )}

              {/* group summary bars + rows */}
              {laid.map(({ g, headerY, open, span }) => (
                <Fragment key={g.key}>
                  {/* group header band */}
                  {!flat && <div className="absolute left-0 right-0 bg-white border-b border-gray-200" style={{ top: headerY, height: GROUP_H }} />}
                  {!flat && span && (() => {
                    // Group progress = average of its (non-milestone) item bars,
                    // surfaced as a very subtle lighter shade over the done portion.
                    const prog = g.items.filter((it) => !it.isMilestone);
                    const gp = prog.length
                      ? Math.round(prog.reduce((a, it) => a + Math.max(0, Math.min(100, it.progress ?? 0)), 0) / prog.length)
                      : 0;
                    return (
                      <div
                        className="absolute rounded-[3px] shadow-sm overflow-hidden"
                        style={{
                          top: headerY + GROUP_H / 2 - 3,
                          left: xOf(span.lo),
                          width: Math.max(xOf(span.hi) - xOf(span.lo) + pxPerDay, 6),
                          height: 6,
                          background: g.color,
                        }}
                        title={`${g.label} · ${g.items.length} item(s) · ${gp}% complete`}
                      >
                        {/* done = rich solid colour; remaining lightened very subtly */}
                        {gp < 100 && (
                          <div className="absolute top-0 bottom-0 right-0" style={{ left: `${gp}%`, background: "rgba(255,255,255,0.45)" }} />
                        )}
                      </div>
                    );
                  })()}
                  {/* item bars */}
                  {open && g.items.map((it) => {
                    const cy = centerY.get(it.id)!;
                    const s = msTime(it.start) ?? msTime(it.end) ?? minMs;
                    const e = msTime(it.end) ?? s;
                    const lo = Math.min(s, e), hi = Math.max(s, e);
                    const left = xOf(lo);
                    const progress = Math.max(0, Math.min(100, it.progress ?? 0));

                    if (it.isMilestone) {
                      const isTarget = !!linkSrc && hoverTarget === it.id && linkSrc.id !== it.id;
                      return (
                        <div
                          key={it.id}
                          onClick={() => onOpen?.(it.id)}
                          onMouseEnter={() => { if (linkSrcRef.current) setTarget(it.id); }}
                          onMouseLeave={() => { if (hoverTargetRef.current === it.id) setTarget(null); }}
                          title={`${it.name} · ${it.start ?? it.end ?? ""}`}
                          className={`group absolute z-10 ${onOpen ? "cursor-pointer" : ""} ${it.dim ? "opacity-40" : ""}`}
                          style={{ top: cy - 7, left: left - 1 }}
                        >
                          <span className={`block w-3.5 h-3.5 rotate-45 rounded-[2px] shadow ${isTarget ? "ring-2 ring-[#0073ea]" : ""}`} style={{ background: it.color }} />
                          {onLink && (
                            <span
                              onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); const x = left + 6; setLinkSrc({ id: it.id, x, y: cy }); setLinkCur({ x, y: cy }); }}
                              onClick={(e) => e.stopPropagation()}
                              title="Drag onto a task to link it as the successor"
                              className="absolute top-1/2 -right-2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-white border-2 border-[#0073ea] shadow cursor-crosshair opacity-40 group-hover:opacity-100 hover:scale-125 transition-all z-30"
                            />
                          )}
                        </div>
                      );
                    }

                    // Undated project/task: no bar to plot. Show a muted "No dates"
                    // chip pinned to the track start so the row is still visible and
                    // honestly distinct from a real one-day bar at the chart edge.
                    if (msTime(it.start) == null && msTime(it.end) == null) {
                      return (
                        <div
                          key={it.id}
                          onClick={() => onOpen?.(it.id)}
                          title={`${it.name}\nNo start/end dates set`}
                          className={`absolute ${onOpen ? "cursor-pointer" : ""} ${it.dim ? "opacity-40" : ""}`}
                          style={{ top: cy - BAR_H / 2, left: 4, height: BAR_H }}
                        >
                          <span className="inline-flex items-center h-full px-2 rounded-[4px] border border-dashed border-gray-300 bg-gray-50 text-[10px] font-medium text-gray-400 whitespace-nowrap">No dates</span>
                        </div>
                      );
                    }

                    const width = Math.max((dayFloor(hi) - dayFloor(lo)) / DAY_MS * pxPerDay + pxPerDay, 8);
                    const isTarget = !!linkSrc && hoverTarget === it.id && linkSrc.id !== it.id;
                    return (
                      <Fragment key={it.id}>
                      <div
                        onClick={() => onOpen?.(it.id)}
                        onMouseEnter={() => { if (linkSrcRef.current) setTarget(it.id); }}
                        onMouseLeave={() => { if (hoverTargetRef.current === it.id) setTarget(null); }}
                        title={`${it.name}\n${it.start ?? "?"} → ${it.end ?? "?"} · ${progress}% complete`}
                        className={`group absolute ${onOpen ? "cursor-pointer" : ""} ${it.dim ? "opacity-40" : ""}`}
                        style={{ top: cy - BAR_H / 2, left, width, height: BAR_H }}
                      >
                        <div
                          className={`absolute inset-0 rounded-[4px] overflow-hidden ${isTarget ? "ring-2 ring-[#0073ea] ring-offset-1" : it.emphasise ? "ring-2 ring-[#e2445c] shadow" : "shadow-sm"}`}
                          style={{ background: it.color }}
                        >
                          {/* solid colour bar; the done portion is a darker shade
                              (Monday-style progress), so the bar reads rich, not pale */}
                          {progress > 0 && (
                            <div className="absolute left-0 top-0 bottom-0" style={{ width: `${progress}%`, background: "rgba(0,0,0,0.22)" }} />
                          )}
                        </div>
                        {onLink && (
                          <span
                            onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); const x = left + width; setLinkSrc({ id: it.id, x, y: cy }); setLinkCur({ x, y: cy }); }}
                            onClick={(e) => e.stopPropagation()}
                            title="Drag onto another task to link it as the successor (creates a dependency)"
                            className="absolute top-1/2 -right-1.5 -translate-y-1/2 w-3 h-3 rounded-full bg-white border-2 border-[#0073ea] shadow cursor-crosshair opacity-40 group-hover:opacity-100 hover:scale-125 transition-all z-30"
                          />
                        )}
                      </div>
                      {/* Milestone diamonds ON the bar — solid green = done, hollow = due. */}
                      {it.markers?.map((m, mi) => {
                        const mt = msTime(m.date);
                        if (mt == null) return null;
                        const mx = xOf(mt) + pxPerDay / 2;
                        return (
                          <span
                            key={`m${mi}`}
                            onClick={() => onOpen?.(it.id)}
                            title={`${m.label ?? "Milestone"} · ${m.date} · ${m.done ? "done" : "due"}`}
                            className={`absolute z-20 w-3 h-3 rotate-45 rounded-[2px] shadow-sm hover:scale-125 transition-transform ${onOpen ? "cursor-pointer" : ""}`}
                            style={{ left: mx - 6, top: cy - 6, background: m.done ? "#16a34a" : "#ffffff", border: m.done ? "1px solid #15803d" : "2px solid #16a34a" }}
                          />
                        );
                      })}
                      </Fragment>
                    );
                  })}
                </Fragment>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
