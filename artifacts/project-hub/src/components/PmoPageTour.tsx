import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { driver, type Driver } from "driver.js";
import "driver.js/dist/driver.css";
import "./PmoTourLive.css";

/**
 * PmoPageTour — per-section auto-tour.
 *
 * SEPARATE from the main charter→project journey (PmoTourLive). When a user
 * lands on a section that the main tour does NOT cover — by navigating there
 * themselves — this shows a short, one-time walkthrough of that page's features.
 *
 *   - Fires once per page per browser (localStorage), the first time you open it.
 *   - Never fires while the main journey is running (driver-active guard).
 *   - Only covers pages NOT in the main tour (so the two never overlap).
 *
 * Adding a new section = drop `data-tour` anchors on it + an entry in PAGE_TOURS.
 */

const SEEN_PREFIX = "pmo:pagetour:seen:v1:";
const MIN_WIDTH = 768;

interface PageStep { anchor: string; title: string; description: string; }

// Route → its feature walkthrough. ONLY uncovered sections live here.
const PAGE_TOURS: Record<string, PageStep[]> = {
  "/my-tasks": [
    { anchor: "mt-buckets", title: "Your task buckets", description: "Everything assigned to you across every project, bucketed by status — assigned, overdue, due soon, completed. Click a bucket to filter." },
    { anchor: "mt-list", title: "Your tasks", description: "The tasks in the selected bucket — open one to update status, dates or progress." },
  ],
  "/my-team-actions": [
    { anchor: "mta-title", title: "My Team Actions", description: "Your reporting line and team — what your people owe across projects. Click anyone to drill into their team." },
  ],
  "/approvals": [
    { anchor: "appr-pending", title: "Awaiting your review", description: "How many items are pending your approval right now. Below, each request — approve it or send it back with a comment." },
  ],
  "/issues": [
    { anchor: "issues-title", title: "Risks / Issues", description: "The risk and blocker register — what's threatening delivery, who raised it, who owns the fix, and how old it is." },
  ],
  "/resources": [
    { anchor: "res-title", title: "Project Owners", description: "Who owns what — every project grouped by its accountable owner." },
    { anchor: "res-stats", title: "Capacity at a glance", description: "Owners, projects, average load and unassigned work across the whole portfolio." },
  ],
  "/documents": [
    { anchor: "doc-title", title: "Central Document Repository", description: "Universal templates plus every project's documents, organised by lifecycle stage — versioned, lockable and access-controlled." },
    { anchor: "doc-tabs", title: "Templates vs project docs", description: "Switch between the universal template library and a specific project's documents." },
  ],
  "/vendors": [
    { anchor: "ven-title", title: "Vendor Master", description: "Your vendor directory — register new vendors and manage the ones you work with." },
    { anchor: "ven-filters", title: "Find a vendor", description: "Search and filter by segment and risk to find the vendor you need." },
  ],
  "/automations": [
    { anchor: "auto-banner", title: "Safe by design", description: "Automations never bypass governance — they only nudge, notify and pre-fill within the rules." },
    { anchor: "auto-recipes", title: "Recipe gallery", description: "Pre-built automation recipes — pick one to set up reminders, escalations and routing in a click." },
  ],
  "/lessons-learned": [
    { anchor: "les-title", title: "Lessons Learned Repository", description: "Cross-project knowledge — what worked and what didn't, searchable by keyword, tag or AI semantic search." },
    { anchor: "les-capture", title: "Capture a lesson", description: "Record a new lesson so the next project benefits from it." },
  ],
  "/nudges": [
    { anchor: "nud-title", title: "Your Nudges", description: "Smart prompts about what needs your attention — overdue items, missing info and approvals waiting, all in one feed." },
  ],
};

export default function PmoPageTour() {
  const [location] = useLocation();
  const driverRef = useRef<Driver | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || window.innerWidth < MIN_WIDTH) return;
    const steps = PAGE_TOURS[location];
    if (!steps) return;

    const key = SEEN_PREFIX + location;
    let seen = true;
    try { seen = localStorage.getItem(key) === "1"; } catch { /* storage blocked → don't nag */ }
    if (seen) return;

    let cancelled = false;
    let tries = 0;
    // Wait for the page's anchors to mount (data loads after the route change),
    // then drive once. Skip entirely if the main journey is running.
    const tryStart = () => {
      if (cancelled || document.body.classList.contains("driver-active")) return;
      const present = steps.filter((s) => document.querySelector(`[data-tour="${s.anchor}"]`));
      if (!present.length) {
        if (tries++ < 30) { window.setTimeout(tryStart, 150); return; }
        return; // no anchors showed up — give up quietly
      }
      try { localStorage.setItem(key, "1"); } catch { /* ignore */ }
      const d = driver({
        showProgress: present.length > 1,
        progressText: "{{current}} of {{total}}",
        nextBtnText: "Next",
        prevBtnText: "Back",
        doneBtnText: "Got it",
        popoverClass: "pmo-tour-popover",
        overlayOpacity: 0.2,
        stagePadding: 8,
        stageRadius: 10,
        steps: present.map((s) => ({ element: `[data-tour="${s.anchor}"]`, popover: { title: s.title, description: s.description } })),
        onDestroyed: () => { if (driverRef.current === d) driverRef.current = null; },
      });
      driverRef.current = d;
      d.drive();
    };
    const t = window.setTimeout(tryStart, 700); // let the page settle first
    return () => { cancelled = true; window.clearTimeout(t); driverRef.current?.destroy(); };
  }, [location]);

  return null;
}
