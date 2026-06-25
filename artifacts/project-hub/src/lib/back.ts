// Universal "back to where you came from" for every back button in the app.
//
// Normal flow → real browser back, so it returns to the exact previous page at
// any depth (portfolio → detail goes back to portfolio; projects → detail goes
// back to projects). On a fresh deep-link (user landed straight on a detail URL
// with no in-app history yet) it routes to a sensible per-page fallback instead
// of leaving the app.
//
// `noteNav()` is called by the router on each real route change (see App.tsx),
// so `inAppNavs > 0` means there's an in-app history entry to go back to.
import { useLocation } from "wouter";

let inAppNavs = 0;
export function noteNav() { inAppNavs++; }

export function useGoBack() {
  const [, setLocation] = useLocation();
  return (fallback = "/portfolio") => {
    if (inAppNavs > 0) window.history.back();
    else setLocation(fallback);
  };
}
