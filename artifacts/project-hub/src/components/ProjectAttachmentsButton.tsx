import { useState } from "react";
import { Paperclip } from "lucide-react";
import { AttachmentsTreeModal } from "./AttachmentsTreeModal";
import { useProjectAttachments } from "./AttachmentPopover";

type TaskLite = { id: number; name: string; milestoneId?: number | null; parentTaskId?: number | null };
type MilestoneLite = { id: number; name: string };

/**
 * The paperclip beside a project's name/code. Opens the whole project's
 * attachments organised as a tree — project-level bucket, then milestone →
 * task → subtask accordions (the shared <AttachmentsTree>). This replaces the
 * flat project-scoped <AttachmentPopover> here so the header affordance reads as
 * "every document in this project, arranged by where it lives" rather than a
 * single flat list. Per-row paperclips (task / milestone) keep using
 * AttachmentPopover for their scoped upload + view.
 */
export function ProjectAttachmentsButton({
  projectId, projectName, projectCode, tasks, milestones,
}: {
  projectId: number;
  projectName?: string;
  projectCode?: string;
  tasks: TaskLite[];
  milestones: MilestoneLite[];
}) {
  const [open, setOpen] = useState(false);
  const { data: all = [] } = useProjectAttachments(projectId);
  const badge = all.length;

  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        title={`Attachments${badge ? ` (${badge})` : ""}`}
        aria-label="Attachments"
        className="relative inline-flex items-center justify-center w-5 h-5 rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors shrink-0"
      >
        <Paperclip size={12} className={badge ? "text-primary" : ""} />
        {badge > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[13px] h-[13px] px-0.5 rounded-full bg-primary text-primary-foreground text-[8px] font-bold flex items-center justify-center num-tabular leading-none">
            {badge}
          </span>
        )}
      </button>
      <AttachmentsTreeModal
        open={open}
        onClose={() => setOpen(false)}
        projectId={projectId}
        projectName={projectName}
        projectCode={projectCode}
        tasks={tasks}
        milestones={milestones}
      />
    </>
  );
}
