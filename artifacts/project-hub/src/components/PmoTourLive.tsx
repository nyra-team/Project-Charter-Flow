import { useCallback, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { driver, type DriveStep, type Driver } from "driver.js";
import "driver.js/dist/driver.css";
import "./PmoTourLive.css";

/**
 * PmoTourLive — guided product tour for the PMO Project Hub.
 *
 * Teaches the core business flow: raise a charter → pick the charter type →
 * CapEx options → AI draft → an RFP is auto-created → it moves to Approved →
 * Create Project → milestones & tasks auto-generate.
 *
 * Guided / user-clicks: each step highlights a REAL control with an
 * instruction; the user clicks it to open the popup / form / CapEx panel, and
 * the tour follows along. "Opener" steps advance when the highlighted element
 * is clicked; the rest advance via driver's Next. After a navigation the next
 * anchor is polled for (pages/modals mount a tick later) before highlighting —
 * same trick as the OHC tour (OhcTourLive.tsx).
 *
 * driver.js does the highlight cutout / popover / progress / keyboard. PMO runs
 * wouter, so we navigate with useLocation()'s setLocation. Renders null when
 * idle; event-driven:
 *   - first-run auto-open once per browser (localStorage)
 *   - replays on `pmo:start-tour-live` (sidebar Tour item + header compass)
 */

const SEEN_KEY = "pmo:tour-seen-v1";
const START_EVENT = "pmo:start-tour-live";

const TOUR_MIN_WIDTH = 768; // mobile UI isn't mapped — disable below this
const isMobileViewport = () =>
  typeof window !== "undefined" && window.innerWidth < TOUR_MIN_WIDTH;

interface FlowStep {
  /** Land on this route before the step (the live screen behind the popover). */
  route?: string;
  /** Window event to dispatch on entry — opens/closes the Business Case chooser
   *  (Layout listens) or switches the project view (project-detail listens), so
   *  the tour can drive UI it doesn't own. */
  event?: string;
  /** Optional CustomEvent detail payload (e.g. the project view key). */
  eventDetail?: string;
  /** Extra events to dispatch on entry, alongside `event` — for steps that need
   *  to drive two things at once (e.g. switch the charter back to Standard AND
   *  jump it to the narrative form-step so the "Draft with AI" button mounts). */
  events?: Array<{ name: string; detail?: string }>;
  /** `data-tour` anchor to highlight; omit for a centred narration card. */
  anchor?: string;
  /** Raw CSS selector to highlight — takes precedence over `anchor` when the
   *  target isn't tagged with a `data-tour` (e.g. the sidebar Business Case CTA
   *  rendered by the shared CollapsibleSidebar). */
  selector?: string;
  /** Clicking the highlighted element opens something AND advances the tour. */
  openerClick?: boolean;
  /** Force the popover to a side so it never covers the highlighted element. */
  side?: "top" | "right" | "bottom" | "left";
  /** Auto-open the first real project before this step (the view walkthrough
   *  needs a live project-detail page to switch Table/Gantt/Calendar/etc.). */
  openFirstProject?: boolean;
  /** Auto-open the first real charter ("charter") or RFP ("rfx") detail before
   *  this step, so the tour shows a finished document rather than a blank form. */
  openDemo?: "charter" | "rfx";
  title: string;
  description: string;
}

// The full flow, in order. Charter (both paths: projects + non-projects, with
// CapEx and e-NFA shown separately) → RFx → Approved → Project (every view +
// Team). Numbering is intentionally NOT in the titles — the "x of N" progress
// covers it, so steps can be inserted without renumbering.
const STEPS: FlowStep[] = [
  {
    route: "/portfolio",
    title: "The charter → project flow",
    description:
      "A quick walk from raising a charter to a live project with auto-generated milestones. This is your Portfolio — the home base. Hit Next to begin.",
  },
  {
    route: "/portfolio",
    // Make sure the rail is expanded (the CTA is dropped when collapsed) and the
    // chooser is closed, so this step highlights the actual button — not a popup.
    events: [
      { name: "pmo:tour:expand-sidebar" },
      { name: "pmo:tour:close-business-case" },
    ],
    selector: 'a[href="#business-case"]',
    side: "right",
    title: "Start here — the Business Case button",
    description:
      "Everything begins with this Business Case button. Click it and two options open up — a Project Charter (for projects) and an e-NFA (for non-projects). Hit Next to open it.",
  },
  {
    route: "/portfolio",
    event: "pmo:tour:open-business-case",
    anchor: "tour-charter-chooser",
    side: "right",
    title: "Two workflows to choose from",
    description:
      "There they are — the two buttons that just opened. Project Charter — for projects (also auto-floats an RFP) — and e-NFA — for non-projects (a standalone note for approval). We'll walk both. Next opens the projects one.",
  },
  // ── Path 1: Project Charter (for projects) — walk Standard e-NFA → Draft
  // with AI → CapEx, then Create (which floats the RFP). ──────────────────
  {
    route: "/charters/new",
    event: "pmo:tour:set-charter-mode",
    eventDetail: "standard",
    anchor: "tour-charter-capex",
    side: "bottom",
    title: "Project charter — Standard e-NFA",
    description:
      "This is the for-projects charter, in its default Standard e-NFA mode. The toggle here switches it between Standard and CapEx.",
  },
  {
    route: "/charters/new",
    event: "pmo:tour:set-charter-mode",
    eventDetail: "standard",
    // The "Draft with AI" button lives on the Charter Narrative form-step (2),
    // so jump there too — otherwise this anchor never mounts and the popover
    // hangs/centres while waiting for it.
    events: [{ name: "pmo:tour:set-charter-step", detail: "2" }],
    anchor: "tour-charter-ai",
    title: "Draft it with AI",
    description:
      "On the narrative step. Each field has a Draft / Rephrase with AI button — and 'Draft with AI' writes the whole narrative for you.",
  },
  {
    route: "/charters/new",
    event: "pmo:tour:set-charter-mode",
    eventDetail: "capex",
    anchor: "tour-capex-options",
    title: "…or a CapEx charter",
    description:
      "Flip the toggle to CapEx — the capital-expenditure options: project type, economic evaluation, required approvals and the budget table.",
  },
  {
    route: "/charters/new",
    // Create lives on the standard narrative step, so switch back before it.
    event: "pmo:tour:set-charter-mode",
    eventDetail: "standard",
    events: [{ name: "pmo:tour:set-charter-step", detail: "2" }],
    anchor: "tour-charter-submit",
    title: "Create — and an RFP is floated",
    description:
      "Hitting Create Project Charter also auto-generates a draft RFP for vendor selection — an 'RFP generated' toast, linked back to this charter.",
  },
  // ── Path 2: standalone e-NFA (for non-projects) — same walk: e-NFA → Draft
  // with AI → CapEx. No project, no RFP — just the approval note. ──────────
  {
    route: "/charters/nfa-new",
    event: "pmo:tour:set-charter-mode",
    eventDetail: "standard",
    anchor: "tour-enfa-workflow",
    side: "bottom",
    title: "e-NFA — for non-projects",
    description:
      "The other path: a standalone e-NFA for non-project spend — background, requirement items, recommendation and the approval signatory chain. No project and no RFP — just the note.",
  },
  {
    route: "/charters/nfa-new",
    event: "pmo:tour:set-charter-mode",
    eventDetail: "standard",
    // Draft with AI sits on the Note Details step (2) — jump there so it mounts.
    events: [{ name: "pmo:tour:set-charter-step", detail: "2" }],
    anchor: "tour-enfa-ai",
    title: "Draft the note with AI",
    description:
      "Same AI assist here — 'Draft with AI' writes the whole note from your subject, then you polish any field freely.",
  },
  {
    route: "/charters/nfa-new",
    event: "pmo:tour:set-charter-mode",
    eventDetail: "capex",
    anchor: "tour-capex-options",
    title: "…or a CapEx e-NFA",
    description:
      "Flip to CapEx for capital expenditure — the same capital-expenditure options: project type, economic evaluation, required approvals and the budget table.",
  },
  {
    // Open a real charter so the user sees a finished Charter + e-NFA document,
    // not just the blank form.
    openDemo: "charter",
    anchor: "tour-nfa-doc",
    side: "bottom",
    title: "A finished Charter + e-NFA",
    description:
      "Here's a real, completed one — the full Charter + e-NFA note with its scope, financials and sign-off chain, ready to route for approval or download as a Word doc via 'Charter+e-NFA (.docx)'.",
  },
  {
    route: "/rfx",
    anchor: "tour-rfx",
    title: "RFx — the RFP lands here",
    description:
      "The draft RFP auto-created from your Project Charter shows up in the RFx section — sourcing events (RFI / RFP / RFQ / e-auction) ready to invite vendors and grade bids.",
  },
  {
    // Open a real RFP so the user sees the actual sourcing document.
    openDemo: "rfx",
    anchor: "tour-rfp-doc",
    side: "bottom",
    title: "A live RFP",
    description:
      "And here's an actual RFP — its brief, evaluation gates and vendor questions, ready to publish and invite vendors. Download it as a Word doc any time.",
  },
  {
    route: "/charters",
    anchor: "tour-charters-approved",
    title: "It moves to Approved",
    description:
      "The charter routes through the approval chain. Once everyone signs off, it lands here — in the Approved column.",
  },
  {
    route: "/charters",
    title: "Create the project",
    description:
      "Open the approved charter and click Create Project — that button only appears once the charter is Approved. It auto-generates the milestones and tasks.",
  },
  {
    route: "/projects",
    anchor: "tour-projects",
    title: "Your projects",
    description:
      "Projects created from charters land here, each with auto-generated milestones and tasks. Next opens one to walk through its views.",
  },
  {
    openFirstProject: true,
    event: "pmo:tour:set-view",
    eventDetail: "table",
    // Anchor the always-present Table pill (like the sibling view steps below),
    // NOT the WBS content — that only renders once milestone data loads and is
    // absent for an empty project, which left this step hanging on a missing
    // anchor. The table itself renders behind the light overlay.
    anchor: "tour-view-table",
    side: "bottom",
    title: "Table (WBS)",
    description:
      "The work breakdown — every auto-generated milestone with its tasks nested beneath, each with owner, dates, status and progress.",
  },
  {
    event: "pmo:tour:set-view",
    eventDetail: "overview",
    anchor: "tour-view-overview",
    title: "Overview",
    description: "Project health, progress, budget and gate status at a glance.",
  },
  {
    event: "pmo:tour:set-view",
    eventDetail: "kanban",
    anchor: "tour-view-kanban",
    title: "Kanban",
    description:
      "Tasks as a board — group by status, owner, priority or milestone and drag to update.",
  },
  {
    event: "pmo:tour:set-view",
    eventDetail: "gantt",
    anchor: "tour-view-gantt",
    title: "Gantt",
    description:
      "The same milestones and tasks on a timeline — dependencies, durations and the critical path.",
  },
  {
    event: "pmo:tour:set-view",
    eventDetail: "calendar",
    anchor: "tour-view-calendar",
    title: "Calendar",
    description: "Every task laid out by its due date, month by month.",
  },
  {
    event: "pmo:tour:set-section",
    eventDetail: "team",
    anchor: "tour-section-team",
    title: "Team",
    description:
      "Each project has its team — internal members and external vendors — managed here, separate from the task views.",
  },
  {
    event: "pmo:tour:set-section",
    eventDetail: "tasks",
    title: "That's the flow",
    description:
      "Charter (projects + non-projects, CapEx & e-NFA) → RFP → Approved → Project → milestones & tasks across every view, plus the team. Replay any time from the Tour item in the sidebar or the compass up top.",
  },
];

const onRoute = (route: string) =>
  typeof window !== "undefined" && window.location.pathname.endsWith(route);

const selectorFor = (anchor: string) => `[data-tour="${anchor}"]`;

// The element a step highlights: an explicit raw selector wins, else the
// `data-tour` anchor, else nothing (centred narration card).
const elementSelector = (step: FlowStep): string | undefined =>
  step.selector ?? (step.anchor ? selectorFor(step.anchor) : undefined);

export default function PmoTourLive() {
  const [, setLocation] = useLocation();
  const driverRef = useRef<Driver | null>(null);

  const startTour = useCallback(() => {
    if (isMobileViewport()) return;
    driverRef.current?.destroy();

    // Run a step's side effects: navigate to its route and/or dispatch its
    // event (open the chooser, switch CapEx / form step, switch project view).
    const runAction = (i: number) => {
      const step = STEPS[i];
      if (!step) return;
      if (step.route && !onRoute(step.route)) setLocation(step.route);
      if (step.event) window.dispatchEvent(new CustomEvent(step.event, { detail: step.eventDetail }));
      step.events?.forEach((e) => window.dispatchEvent(new CustomEvent(e.name, { detail: e.detail })));
    };

    // Wait until a step's anchor is actually in the DOM (popups / form panels /
    // views mount a tick after the action) before running cb. Falls through
    // after ~4s so the tour never hangs if an anchor never appears.
    const waitForAnchor = (i: number, cb: () => void) => {
      const step = STEPS[i];
      const selector = step && elementSelector(step);
      if (!selector) { cb(); return; }
      let tries = 0;
      const tick = () => {
        if (document.querySelector(selector) || tries++ >= 45) { cb(); return; }
        window.setTimeout(tick, 90);
      };
      window.setTimeout(tick, 40);
    };

    // Move to step `target`: run its action, WAIT for its anchor, then drive —
    // so driver always anchors the popover to a present element (never a stray
    // centred card floating over the feature).
    // Open the first real project so the view-walkthrough steps land on a live
    // project-detail page. Best-effort: if it fails, the steps fall back to
    // centred cards rather than hanging.
    const openFirstProject = async () => {
      try {
        const r = await fetch("/api/projects", { credentials: "include" });
        if (!r.ok) return;
        const list = await r.json();
        if (!Array.isArray(list)) return;
        // Prefer a project with progress (so it actually has milestones/tasks to
        // show in the WBS), else fall back to the first project available.
        const withWork = list.find((p) => p && p.id != null && Number(p.progress ?? 0) > 0);
        const id = (withWork ?? list.find((p) => p && p.id != null))?.id ?? null;
        if (id != null) setLocation(`/projects/${id}`);
      } catch { /* stay on the board */ }
    };

    // Wait until the project-detail shell has mounted (its view switcher is up,
    // so the page's set-view listener is attached) before dispatching the step's
    // action — otherwise the event races the route change and is lost, and the
    // previous step's popover lingers over a now-gone anchor. Falls through after
    // ~4s so the tour never hangs.
    const waitForProjectDetail = (cb: () => void) => {
      let tries = 0;
      const tick = () => {
        if (document.querySelector('[data-tour="tour-view-table"]') || tries++ >= 45) { cb(); return; }
        window.setTimeout(tick, 90);
      };
      window.setTimeout(tick, 40);
    };

    // Open the first real charter / RFP so a demo step shows a finished document
    // rather than a blank form. Skips re-navigating if already on that detail
    // page (numeric id), so stepping back into it doesn't refetch needlessly.
    const openFirstDemo = async (kind: "charter" | "rfx") => {
      const { listUrl, basePath } = kind === "charter"
        ? { listUrl: "/api/charters", basePath: "/charters" }
        : { listUrl: "/api/rfx", basePath: "/rfx" };
      if (new RegExp(`${basePath}/\\d+$`).test(window.location.pathname)) return;
      try {
        const r = await fetch(listUrl, { credentials: "include" });
        if (!r.ok) return;
        const list = await r.json();
        const id = Array.isArray(list) ? list.find((x) => x && x.id != null)?.id : null;
        if (id != null) setLocation(`${basePath}/${id}`);
      } catch { /* stay where we are — the step falls back to a centred card */ }
    };

    const goTo = (target: number, mover: () => void) => {
      if (target < 0) return;
      if (target >= STEPS.length) { driverRef.current?.destroy(); return; }
      const proceed = () => { runAction(target); waitForAnchor(target, mover); };
      const onProjectDetail = /\/projects\/[^/]+$/.test(window.location.pathname);
      const demo = STEPS[target]?.openDemo;
      if (STEPS[target]?.openFirstProject && !onProjectDetail) {
        openFirstProject().finally(() => waitForProjectDetail(proceed));
      } else if (demo) {
        // Give the route change a beat to mount the detail page, then proceed —
        // waitForAnchor handles the rest (polls for the doc anchor).
        openFirstDemo(demo).finally(() => window.setTimeout(proceed, 120));
      } else {
        proceed();
      }
    };

    const steps: DriveStep[] = STEPS.map((s) => ({
      element: elementSelector(s),
      popover: { title: s.title, description: s.description, ...(s.side ? { side: s.side, align: "start" as const } : {}) },
    }));

    const d = driver({
      showProgress: true,
      progressText: "{{current}} of {{total}}",
      nextBtnText: "Next",
      prevBtnText: "Back",
      doneBtnText: "Done",
      popoverClass: "pmo-tour-popover",
      allowClose: true,
      // Light overlay so the feature each step opens (the chooser popup, the
      // charter form, each project view) stays clearly visible behind the
      // highlight instead of being hidden under a dark scrim.
      overlayOpacity: 0.2,
      stagePadding: 8,
      stageRadius: 10,
      steps,
      // Take over Next / Back: do the next step's action and wait for its anchor
      // BEFORE driver moves, so the popover anchors correctly every time.
      onNextClick: (_el, _step, opts) =>
        goTo((opts.state.activeIndex ?? 0) + 1, () => driverRef.current?.moveNext()),
      onPrevClick: (_el, _step, opts) =>
        goTo((opts.state.activeIndex ?? 0) - 1, () => driverRef.current?.movePrevious()),
      onDestroyed: () => {
        if (driverRef.current === d) driverRef.current = null;
      },
    });
    driverRef.current = d;

    // First step: do its action, wait for its anchor, then start.
    runAction(0);
    waitForAnchor(0, () => driverRef.current?.drive());
  }, [setLocation]);

  // First-run auto-open (once per browser).
  useEffect(() => {
    let seen = false;
    try {
      seen = localStorage.getItem(SEEN_KEY) === "1";
    } catch {
      seen = true; // storage blocked — don't nag
    }
    if (seen || isMobileViewport()) return;
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* ignore */
    }
    const id = window.setTimeout(startTour, 900);
    return () => window.clearTimeout(id);
  }, [startTour]);

  // Replay trigger (sidebar Tour item + header compass).
  useEffect(() => {
    const onStart = () => startTour();
    window.addEventListener(START_EVENT, onStart);
    return () => {
      window.removeEventListener(START_EVENT, onStart);
      driverRef.current?.destroy();
    };
  }, [startTour]);

  return null;
}
