// RoleSimulator — a small ADMIN-ONLY "View as" control for the dashboard.
//
// The role simulator used to live in the sidebar and drove server-side
// authorization. That's retired — authorization is now identity-based off the
// master employee DB (requireAuth → derivePmoRole). This control is a pure
// FRONTEND preview: it changes the UI role in the store so an admin can see
// what each role's dashboard / role-gated UI looks like. It does NOT grant any
// extra permission and does not change the data the API returns (the backend
// still enforces the admin's real identity). Visible only to platform admins
// (is_super_admin or pmo_role === 'admin'); renders nothing for anyone else.

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Eye } from "lucide-react";
import { useUserStore } from "../lib/store";
import { useAuth } from "../auth/context";

const SIM_ROLES = [
  { value: "chairman", label: "Chairman" },
  { value: "executive_director", label: "Exec. Director" },
  { value: "cfo", label: "CFO" },
  { value: "pmo", label: "PMO" },
  { value: "pm", label: "Project Manager" },
  { value: "hod", label: "Head of Dept" },
  { value: "scm", label: "SCM" },
  { value: "finance", label: "Finance" },
  { value: "team_member", label: "Team Member" },
  { value: "initiator", label: "Project Initiator" },
] as const;

export function RoleSimulator() {
  const { profile } = useAuth();
  const { role, setRole } = useUserStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const isAdmin = !!(profile?.is_super_admin || profile?.pmo_role === "admin");

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  if (!isAdmin) return null;

  const current = SIM_ROLES.find((r) => r.value === role);

  return (
    <div className="flex justify-end" ref={ref}>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          title="Admin only — preview the app as another role (UI only)"
          aria-haspopup="menu"
          aria-expanded={open}
          className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border border-border bg-card/70 backdrop-blur-sm text-[11px] font-medium text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
        >
          <Eye size={12} />
          <span>
            View as: <span className="text-foreground font-semibold">{current?.label ?? role}</span>
          </span>
          <ChevronDown size={12} className={`transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        {open && (
          <div
            role="menu"
            className="absolute right-0 mt-1 z-50 w-48 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg py-1 max-h-72 overflow-y-auto scrollbar-thin"
          >
            <p className="px-3 py-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/70">Preview as role</p>
            {SIM_ROLES.map((r) => (
              <button
                key={r.value}
                type="button"
                role="menuitemradio"
                aria-checked={r.value === role}
                onClick={() => {
                  setRole(r.value);
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                  r.value === role ? "bg-accent text-primary font-semibold" : "text-foreground hover:bg-accent/60"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
