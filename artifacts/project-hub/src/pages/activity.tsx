// Activity — a Monday.com-style global activity stream over the existing
// pmo_activity log (every mutation already calls logActivity). Read-only;
// groups events by day with a type-coloured rail. Automation/escalation events
// flow through the same log, so this doubles as the "what did the system do"
// feed referenced by the Automations page.
import { useMemo } from "react";
import { useGetRecentActivity } from "@workspace/api-client-react";
import { format, isToday, isYesterday, parseISO } from "date-fns";
import { PageHeader } from "@/components/ui-kit";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Activity as ActivityIcon, CheckSquare, Flag, FolderKanban, Stamp, Bell, GitBranch, FileText,
} from "lucide-react";

type ActivityRow = {
  id: number | string;
  type?: string | null;
  message: string;
  entityType?: string | null;
  createdAt: string;
  userName?: string | null;
};

// Map an activity `type` (or entityType) to an icon + tone.
function iconFor(type?: string | null): { Icon: typeof CheckSquare; color: string } {
  const t = (type ?? "").toLowerCase();
  if (t.includes("task")) return { Icon: CheckSquare, color: "#6366F1" };
  if (t.includes("milestone")) return { Icon: Flag, color: "#0EA5E9" };
  if (t.includes("project")) return { Icon: FolderKanban, color: "#10B981" };
  if (t.includes("approval") || t.includes("gate")) return { Icon: Stamp, color: "#F59E0B" };
  if (t.includes("escalat") || t.includes("notif")) return { Icon: Bell, color: "#EF4444" };
  if (t.includes("document") || t.includes("doc")) return { Icon: FileText, color: "#8B5CF6" };
  if (t.includes("change") || t.includes("depend")) return { Icon: GitBranch, color: "#64748B" };
  return { Icon: ActivityIcon, color: "#94A3B8" };
}

function dayLabel(iso: string): string {
  const d = iso.length <= 10 ? parseISO(iso) : new Date(iso);
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  return format(d, "EEEE, d MMM");
}

export default function ActivityPage() {
  const { data, isLoading } = useGetRecentActivity();
  const rows = (data ?? []) as ActivityRow[];

  // Group by calendar day, preserving the recency order from the API.
  const groups = useMemo(() => {
    const map = new Map<string, ActivityRow[]>();
    for (const r of rows) {
      const key = dayLabel(r.createdAt);
      const arr = map.get(key) ?? [];
      arr.push(r);
      map.set(key, arr);
    }
    return [...map.entries()];
  }, [rows]);

  return (
    <div className="space-y-6">
      <PageHeader title="Activity" subtitle="Everything happening across the portfolio" icon={ActivityIcon} />

      {isLoading ? (
        <div className="space-y-2">{[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/50 p-10 text-center text-sm text-muted-foreground">
          No activity recorded yet.
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map(([day, items]) => (
            <div key={day}>
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">{day}</h3>
              <div className="rounded-xl border border-card-border bg-card glass-surface overflow-hidden">
                {items.map((a, idx) => {
                  const { Icon, color } = iconFor(a.type ?? a.entityType);
                  return (
                    <div key={a.id} className={`flex items-start gap-3 px-4 py-2.5 ${idx > 0 ? "border-t border-border/40" : ""}`}>
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: `${color}1A` }}>
                        <Icon size={14} style={{ color }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-foreground leading-snug">{a.message}</p>
                        <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-muted-foreground">
                          <span>{format(a.createdAt.length <= 10 ? parseISO(a.createdAt) : new Date(a.createdAt), "h:mm a")}</span>
                          {a.userName && <><span className="opacity-50">·</span><span>{a.userName}</span></>}
                          {a.entityType && <><span className="opacity-50">·</span><span className="capitalize">{a.entityType}</span></>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
