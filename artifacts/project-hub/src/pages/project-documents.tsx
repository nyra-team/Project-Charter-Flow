import { useState } from "react";
import { useRoute } from "wouter";
import { useGetProject, useListTasks, useListMilestones } from "@workspace/api-client-react";
import { useGoBack } from "../lib/back";
import { DocumentsTab } from "../components/documents-tab";
import { AttachmentsTree } from "@/components/AttachmentsTreeModal";
import {
  ChevronLeft, ChevronRight, FolderOpen, FileDown, ListTree, Upload, Paperclip,
} from "lucide-react";

type TaskLite = { id: number; name: string; milestoneId?: number | null; parentTaskId?: number | null };
type MilestoneLite = { id: number; name: string };

// Top-level sub-section of the page (mirrors the old modal's toggle).
type Section = "documents" | "template";

/**
 * Project Documents — full-page document repository for one project.
 * Replaces the old floating Documents modal on the project detail page:
 * same content (documents by lifecycle stage, attachments tree, CIP template)
 * with room to breathe, a real URL, and browser back instead of a dismiss.
 * Route: /projects/:id/documents.
 */
export default function ProjectDocumentsPage() {
  const [, params] = useRoute("/projects/:id/documents");
  const projectId = Number(params?.id ?? 0);
  const goBack = useGoBack();

  const { data: project } = useGetProject(projectId);
  const { data: rawTasks } = useListTasks(projectId);
  const { data: rawMilestones } = useListMilestones(projectId);
  const p = (project ?? {}) as { name?: string };

  const [section, setSection] = useState<Section>("documents");
  const [uploadOpen, setUploadOpen] = useState(false);

  return (
    <div className="space-y-4">
      {/* Header — back to the project + page identity + upload */}
      <div className="relative flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
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
              <span className="text-primary">Documents</span>
            </div>
            <div className="flex items-center gap-2 min-w-0">
              <FolderOpen size={16} className="text-primary shrink-0" />
              <h1 className="text-base font-bold text-foreground tracking-tight truncate">Project Documents</h1>
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">
              Organised by lifecycle stage, with versioning and access controls
            </p>
          </div>
        </div>
        {section === "documents" && (
          <button
            type="button"
            onClick={() => setUploadOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm"
          >
            <Upload size={14} /> Upload Document
          </button>
        )}
      </div>

      {/* Section switcher — Project Documents · Project Template */}
      <div className="border-b border-border/60">
        <div className="flex items-center gap-1">
          {([
            { key: "documents", label: "Project Documents", icon: FolderOpen },
            { key: "template", label: "Project Template", icon: ListTree },
          ] as const).map((t) => {
            const active = section === t.key;
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setSection(t.key)}
                className={`relative flex items-center gap-2 px-4 py-2 text-sm font-semibold transition-colors border-b-2 -mb-px ${active ? "text-primary border-primary" : "text-muted-foreground border-transparent hover:text-foreground"}`}
              >
                <Icon size={14} className="flex-shrink-0" /> {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {section === "template" ? (
        /* Project Template — the standard CIP milestone/task skeleton (download). */
        <div className="rounded-xl border border-border/70 bg-card/60 p-4 flex items-center gap-4">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center bg-amber-accent/10 border border-amber-accent/30 shrink-0">
            <FileDown size={20} className="text-amber-accent" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground">CIP Project Plan Template</p>
          </div>
          <a href="/CIP_Project_Template.xlsx" download className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-primary-foreground bg-primary hover:bg-primary/90 transition-colors shrink-0">
            <FileDown size={13} /> Download
          </a>
        </div>
      ) : (
        /* Project Documents — uploaded documents + all attachments,
           segregated into milestone / task accordions. */
        <div className="space-y-4">
          <DocumentsTab
            projectId={projectId}
            uploadOpen={uploadOpen}
            onUploadOpenChange={setUploadOpen}
            showUploadButton={false}
          />
          <div className="border-t border-border/60 pt-4">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              <Paperclip size={12} className="text-primary" /> Attachments by milestone &amp; task
            </p>
            <AttachmentsTree
              projectId={projectId}
              tasks={(rawTasks ?? []) as TaskLite[]}
              milestones={(rawMilestones ?? []) as MilestoneLite[]}
            />
          </div>
        </div>
      )}
    </div>
  );
}
