import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListNotifications, useMarkNotificationRead, useMarkAllNotificationsRead,
} from "@workspace/api-client-react";
import { useUserStore } from "../lib/store";
import { Bell, CheckCheck } from "lucide-react";

type Notif = {
  id: number; userId: number; type: string; title: string; body?: string | null;
  link?: string | null; isRead: boolean; createdAt: string;
  relatedEntityType?: string | null; relatedEntityId?: number | null;
};

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function NotificationBell() {
  const { userId } = useUserStore();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();

  const { data: notifications = [], refetch } = useListNotifications(
    { userId },
    { query: { refetchInterval: 30000 } }
  );
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  const all = (notifications as Notif[]) ?? [];
  const unread = all.filter(n => !n.isRead);

  useEffect(() => {
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);

  function handleClick(n: Notif) {
    if (!n.isRead) markRead.mutate({ id: n.id }, { onSuccess: () => refetch() });
    if (n.link) {
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const target = n.link.startsWith(base) ? n.link.slice(base.length) : n.link;
      navigate(target || "/");
    }
    setOpen(false);
  }

  function handleMarkAll() {
    markAll.mutate({ data: { userId } }, {
      onSuccess: () => {
        refetch();
        qc.invalidateQueries({ queryKey: ["/api/notifications"] });
      },
    });
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="relative p-2 rounded-lg hover:bg-gray-100 transition-colors"
        title="Notifications"
        aria-label="Notifications"
      >
        <Bell size={18} className="text-gray-600" />
        {unread.length > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
            style={{ background: "linear-gradient(135deg,#F43F5E,#DC2626)" }}
          >
            {unread.length > 99 ? "99+" : unread.length}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-96 max-h-[480px] rounded-2xl overflow-hidden z-50 flex flex-col"
          style={{ background: "white", border: "1px solid #E2E8F0", boxShadow: "0 12px 40px rgba(0,0,0,0.15)" }}
        >
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <div>
              <h4 className="text-sm font-bold text-gray-900">Notifications</h4>
              <p className="text-xs text-gray-400">{unread.length} unread · {all.length} total</p>
            </div>
            {unread.length > 0 && (
              <button onClick={handleMarkAll} className="flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-700">
                <CheckCheck size={12} /> Mark all read
              </button>
            )}
          </div>

          <div className="overflow-y-auto flex-1">
            {all.length === 0 ? (
              <div className="p-8 text-center text-sm text-gray-400">No notifications yet.</div>
            ) : (
              all.slice(0, 50).map(n => (
                <button
                  key={n.id}
                  onClick={() => handleClick(n)}
                  className="w-full text-left px-4 py-3 border-b border-gray-50 hover:bg-indigo-50/40 transition-colors block"
                  style={{ background: n.isRead ? "transparent" : "#F5F3FF" }}
                >
                  <div className="flex items-start gap-2">
                    {!n.isRead && <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 mt-1.5 flex-shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm ${n.isRead ? "text-gray-600" : "font-semibold text-gray-900"}`}>{n.title}</p>
                      {n.body && <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{n.body}</p>}
                      <p className="text-[10px] text-gray-400 mt-1">{timeAgo(n.createdAt)} · {n.type.replace(/_/g, " ")}</p>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
