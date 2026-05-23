import { useState } from "react";
import { useListMessages, useCreateMessage, useListUsers } from "@workspace/api-client-react";
import { useUserStore } from "../lib/store";
import { useToast } from "@/hooks/use-toast";
import { MessageSquare, Send, AtSign } from "lucide-react";

type Message = {
  id: number; projectId: number; senderId: number; body: string;
  taggedUserIds?: number[] | null; threadParentId?: number | null;
  createdAt: string;
};

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

function parseTaggedUsers(body: string, users: Array<{ id: number; name: string }>): number[] {
  const tagged: number[] = [];
  const matches = body.matchAll(/@(\w+)/g);
  for (const m of matches) {
    const name = m[1].toLowerCase();
    const user = users.find(u => u.name.toLowerCase().startsWith(name) || u.name.toLowerCase().replace(/\s/g, "").startsWith(name));
    if (user && !tagged.includes(user.id)) tagged.push(user.id);
  }
  return tagged;
}

export function MessagesTab({ projectId }: { projectId: number }) {
  const { toast } = useToast();
  const { userId } = useUserStore();
  const { data: messages = [], refetch } = useListMessages(projectId);
  const { data: users = [] } = useListUsers();
  const createMsg = useCreateMessage();

  const [body, setBody] = useState("");
  const msgs = (messages as Message[]) ?? [];
  const usersArr = users as Array<{ id: number; name: string }>;
  const userName = (id: number) => usersArr.find(u => u.id === id)?.name ?? `User #${id}`;
  const initials = (name: string) => name.split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase();

  function handleSend() {
    if (!body.trim()) return;
    const taggedUserIds = parseTaggedUsers(body, usersArr);
    createMsg.mutate({
      id: projectId,
      data: { senderId: userId, body: body.trim(), taggedUserIds, attachments: [] },
    }, {
      onSuccess: () => { setBody(""); refetch(); toast({ title: "Message sent" }); },
      onError: () => toast({ title: "Failed to send message", variant: "destructive" }),
    });
  }

  function renderBody(text: string) {
    return text.split(/(@\w+)/g).map((part, i) =>
      part.startsWith("@")
        ? <span key={i} className="font-semibold text-primary">{part}</span>
        : <span key={i}>{part}</span>
    );
  }

  return (
    <div className="space-y-4">
      <div className="glass-surface lift-card ph-rise rounded-2xl p-5">
        <h3 className="font-semibold text-foreground flex items-center gap-2">
          <MessageSquare size={16} className="text-primary" /> Project Discussion
        </h3>
        <p className="text-xs text-muted-foreground mt-0.5">Use @name to mention a team member · {msgs.length} message{msgs.length !== 1 ? "s" : ""}</p>
      </div>

      {/* Composer */}
      <div className="glass-surface lift-card ph-rise rounded-2xl p-4 space-y-2">
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") handleSend(); }}
          placeholder="Type a message… use @name to mention. Cmd+Enter to send."
          rows={3}
          className="w-full text-sm border border-border rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground flex items-center gap-1"><AtSign size={11} /> Tagged: {parseTaggedUsers(body, usersArr).map(userName).join(", ") || "none"}</span>
          <button
            onClick={handleSend}
            disabled={!body.trim() || createMsg.isPending}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 shadow-sm transition-colors"
          >
            <Send size={13} /> {createMsg.isPending ? "Sending..." : "Send"}
          </button>
        </div>
      </div>

      {/* Message list */}
      {msgs.length === 0 ? (
        <div className="glass-surface lift-card ph-rise rounded-2xl p-10 text-center text-sm text-muted-foreground">
          No messages yet. Start the conversation!
        </div>
      ) : (
        <div className="space-y-2">
          {msgs.map(m => {
            const name = userName(m.senderId);
            return (
              <div key={m.id} className="glass-surface lift-card ph-rise rounded-2xl p-4 flex gap-3">
                <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold bg-primary text-primary-foreground flex-shrink-0">
                  {initials(name)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-foreground">{name}</p>
                    <p className="text-xs text-muted-foreground">{timeAgo(m.createdAt)}</p>
                  </div>
                  <p className="text-sm text-foreground mt-0.5 whitespace-pre-wrap">{renderBody(m.body)}</p>
                  {m.taggedUserIds && m.taggedUserIds.length > 0 && (
                    <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                      {m.taggedUserIds.map(uid => (
                        <span key={uid} className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">@{userName(uid)}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
