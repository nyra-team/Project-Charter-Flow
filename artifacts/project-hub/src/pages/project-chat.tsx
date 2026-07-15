import { useMemo } from "react";
import { useRoute } from "wouter";
import { useGetProject, useListUsers } from "@workspace/api-client-react";
import { useGoBack } from "../lib/back";
import { useUserStore } from "../lib/store";
import { ProjectComments } from "../components/project-comments-modal";
import { projectCode } from "./projects";
import { ChevronLeft, ChevronRight, MessageSquare } from "lucide-react";

/**
 * Project Chat — full-page communication thread for one project.
 * Replaces the old small ProjectCommentsModal pop-up on the project detail
 * page: same composer + thread (@-mentions, rich text), with room to read,
 * a real URL, and browser back instead of a dismiss.
 * Route: /projects/:id/chat.
 */
export default function ProjectChatPage() {
  const [, params] = useRoute("/projects/:id/chat");
  const projectId = Number(params?.id ?? 0);
  const goBack = useGoBack();

  const { data: project } = useGetProject(projectId);
  const { data: rawUsers = [] } = useListUsers();
  const currentUserId = useUserStore((s) => s.userId);
  const p = (project ?? {}) as { id?: number; name?: string; jiraKey?: string | null };

  const users = rawUsers as { id: number; name: string }[];
  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u.name])), [users]);

  return (
    <div className="space-y-4">
      {/* Header — back to the project + page identity */}
      <div className="relative flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={() => goBack(`/projects/${projectId}`)}
          title="Back to project"
          className="w-8 h-8 rounded-lg border border-border bg-card/70 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
        >
          <ChevronLeft size={16} />
        </button>
        <div className="min-w-0">
          <div className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
            <span className="truncate">{p.name ?? "Project"}</span>
            <ChevronRight size={9} className="flex-shrink-0" />
            <span className="text-primary">Chat</span>
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <MessageSquare size={16} className="text-primary shrink-0" />
            <h1 className="text-base font-bold text-foreground tracking-tight truncate">Project Chat</h1>
            {p.id != null && (
              <span className="font-mono text-[11px] font-semibold text-muted-foreground shrink-0">
                {projectCode(p as { id: number; jiraKey?: string | null })}
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            Discuss this project — @-mention people, share updates
          </p>
        </div>
      </div>

      {/* Thread — full width */}
      <div className="rounded-xl border border-border/70 bg-card p-4">
        {currentUserId != null && (
          <ProjectComments
            projectId={projectId}
            senderId={currentUserId}
            people={users}
            resolveName={(id) => usersById.get(id) ?? `User ${id}`}
          />
        )}
      </div>
    </div>
  );
}
