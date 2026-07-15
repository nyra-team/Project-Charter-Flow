// Project-level comments — an exact replica of the task popup's Comments view
// (RichEditor composer + avatar-led thread), backed by the project-scoped
// pmo_messages rows (/api/projects/:id/messages). Rendered by the full-page
// project chat (/projects/:id/chat); the old small-modal wrapper is gone.
import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Paperclip } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { PersonAvatar } from "./person-avatar";
import { RichEditor } from "./task-detail-modal";

type Attachment = { fileName?: string; name?: string; fileUrl?: string; url?: string };
type Msg = {
  id: number;
  senderId: number;
  body: string;
  attachments?: Attachment[];
  createdAt: string;
};
const attName = (a: Attachment) => a.fileName ?? a.name ?? "file";

export function ProjectComments({
  projectId,
  senderId,
  people,
  resolveName,
}: {
  projectId: number;
  senderId: number;
  people: { id: number; name: string }[];
  resolveName: (id: number) => string;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const comments = useQuery({
    queryKey: ["project-messages", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/messages`);
      if (!r.ok) throw new Error("Failed to load messages");
      return (await r.json()) as Msg[];
    },
  });
  const msgs = useMemo(
    () => [...(comments.data ?? [])].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    [comments.data],
  );

  const addComment = useMutation({
    mutationFn: async (body: string) => {
      const r = await fetch(`/api/projects/${projectId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ senderId, body, attachments: [] }),
      });
      if (!r.ok) throw new Error("Failed to post comment");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["project-messages", projectId] }),
    onError: () => toast({ title: "Couldn't post comment", variant: "destructive" }),
  });

  return (
    <div className="flex flex-col">
      <div className="flex items-start gap-2 mb-4">
        <PersonAvatar id={senderId} name={resolveName(senderId)} size={28} />
        <div className="flex-1 min-w-0">
          <RichEditor
            people={people}
            placeholder="Add a comment…"
            saveLabel="Comment"
            clearOnSave
            saving={addComment.isPending}
            onSave={(html) => addComment.mutate(html)}
          />
        </div>
      </div>

      <div className="space-y-3">
        {msgs.length === 0 ? (
          <p className="text-[12px] text-[#626f86]">No comments yet. Start the conversation above.</p>
        ) : (
          msgs.map((c) => (
            <div key={c.id} className="flex items-start gap-2">
              <PersonAvatar id={c.senderId} name={resolveName(c.senderId)} size={24} />
              <div className="min-w-0 flex-1">
                <p className="text-[11px]"><span className="font-medium text-[#172b4d]">{resolveName(c.senderId)}</span> <span className="text-[#626f86]">· {new Date(c.createdAt).toLocaleString()}</span></p>
                {c.body && <div className="text-[12px] text-[#172b4d] whitespace-pre-wrap [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_a]:text-[#1868db] [&_a]:underline [&_img]:max-w-full [&_table]:border-collapse [&_td]:border [&_td]:border-[#c1c7d0] [&_td]:p-1.5" dangerouslySetInnerHTML={{ __html: c.body }} />}
                {(c.attachments ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {(c.attachments ?? []).map((a, i) => (
                      <span key={i} className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-[#f1f2f4] text-[#626f86]"><Paperclip size={9} />{attName(a)}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
