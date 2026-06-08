import { useState, useEffect } from "react";
import {
  useListProjectStages,
  useUpdateProjectStage,
  useCreateDocument,
  useGetProject,
  useListDocuments,
} from "@workspace/api-client-react";
import { Download, FileText, Sparkles, Loader2 } from "lucide-react";
import { useUserStore } from "../../lib/store";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { buildRfpAnnexureDocx, type RfpAnnexureData } from "../../lib/rfp-annexure-docx";
import { VendorShortlist } from "./VendorShortlist";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

type AiAnnexure = Omit<RfpAnnexureData, "projectName">;

/**
 * RFP stage workflow. AI-authors the variable content of the Granules
 * "Annexure — Request for Proposal" and assembles a faithful, editable .docx
 * (matching document-templates/Plan/Annexure- Request for Proposal.docx),
 * which is downloaded and registered in the Documents tab as "RFP Document".
 */
export function RFPSection({ projectId }: { projectId: number }) {
  const createDocument = useCreateDocument();
  const updateStage = useUpdateProjectStage();
  const { userId } = useUserStore();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: stages = [] } = useListProjectStages(projectId);
  const { data: project } = useGetProject(projectId);
  const { data: docs = [] } = useListDocuments(projectId);

  const [busy, setBusy] = useState(false);
  const [localBlobUrl, setLocalBlobUrl] = useState<string | null>(null);
  const [localFileName, setLocalFileName] = useState<string | null>(null);

  useEffect(() => {
    return () => { if (localBlobUrl) URL.revokeObjectURL(localBlobUrl); };
  }, [localBlobUrl]);

  const rfpRecord = (stages as Array<{ id: number; stage: string; notes?: string | null }>).find((s) => s.stage === "rfp");
  const parsedRfpNotes: Record<string, unknown> = (() => {
    try { return JSON.parse(rfpRecord?.notes ?? "{}"); } catch { return {}; }
  })();
  const alreadyGenerated = !!parsedRfpNotes.__rfp_annexure_generated;

  const latestRfpDoc = (docs as Array<{ name: string; fileUrl: string; uploadedAt?: string }>)
    .filter((d) => d.name === "RFP Document")
    .sort((a, b) => (b.uploadedAt ?? "").localeCompare(a.uploadedAt ?? ""))[0];

  const projectTitle = (project as { name?: string } | undefined)?.name ?? "Project";

  async function generate() {
    setBusy(true);
    try {
      // 1. AI-draft the variable Annexure sections from project + URS context.
      const aiRes = await fetch("/api/ai/rfp/draft-annexure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      if (!aiRes.ok) {
        const err = (await aiRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || "AI drafting failed");
      }
      const ai = (await aiRes.json()) as AiAnnexure;

      // 2. Assemble the .docx in the Granules Annexure format.
      const blob = await buildRfpAnnexureDocx({ projectName: projectTitle, ...ai });
      const now = new Date().toISOString();
      const fileName = `RFP_${projectTitle.replace(/\s+/g, "_")}_${now.slice(0, 10)}.docx`;

      // 3. Always hand the user a working download immediately.
      if (localBlobUrl) URL.revokeObjectURL(localBlobUrl);
      const blobUrl = URL.createObjectURL(blob);
      setLocalBlobUrl(blobUrl);
      setLocalFileName(fileName);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();

      // 4. Mark the stage so the checklist clears (best-effort).
      if (rfpRecord?.id) {
        updateStage.mutate(
          { id: rfpRecord.id, data: { notes: JSON.stringify({ ...parsedRfpNotes, __rfp_annexure_generated: now }) } },
          { onError: () => { /* non-critical */ } },
        );
      }

      // 5. Upload to project storage + register in Documents tab.
      const urlRes = await fetch("/api/storage/uploads/request-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: fileName, size: blob.size, contentType: DOCX_MIME }),
      });
      if (!urlRes.ok) throw new Error("upload-url");
      const { uploadURL, objectPath } = (await urlRes.json()) as { uploadURL: string; objectPath: string };

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", uploadURL);
        xhr.setRequestHeader("Content-Type", DOCX_MIME);
        xhr.setRequestHeader("x-original-name", fileName);
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`${xhr.status}`)));
        xhr.onerror = () => reject(new Error("network"));
        xhr.send(blob);
      });

      createDocument.mutate(
        {
          id: projectId,
          data: {
            name: "RFP Document",
            stage: "rfp",
            fileUrl: `/api/storage${objectPath}`,
            fileType: DOCX_MIME,
            fileSize: blob.size,
            uploadedBy: userId ?? undefined,
            description: `AI-generated RFP (Annexure format) — ${projectTitle}`,
          },
        },
        {
          onSuccess: () => {
            toast({ title: "RFP generated — downloaded and added to Documents tab" });
            void queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "documents"] });
            void queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "stages"] });
          },
          onError: () => toast({ title: "RFP downloaded — but failed to register in Documents tab", variant: "destructive" }),
        },
      );
    } catch (e) {
      toast({ title: `Couldn't generate RFP: ${(e as Error).message}`, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl p-4 space-y-3 bg-card border border-border">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <FileText size={16} className="text-primary" />
            <p className="text-sm font-bold text-foreground">RFP Document Generator</p>
          </div>
          {(alreadyGenerated || localBlobUrl || latestRfpDoc) && (
            <span className="text-[10px] font-mono uppercase tracking-wider font-semibold px-2 py-0.5 rounded-sm border bg-success/10 text-success border-success/20">
              ✓ Generated
            </span>
          )}
        </div>
        <p className="text-xs text-primary">
          AI authors a complete <span className="font-semibold">Request for Proposal</span> in the Granules Annexure
          format — Background, Objective, Scope of Work, Deliverables, Success Criteria, Expected Timelines, Specific
          Terms and Proposal Instructions — pre-populated from this project&apos;s Requirements (URS). Downloads as an
          editable <span className="font-semibold">.docx</span> and is filed in the Documents tab for SCM distribution.
        </p>

        <button
          onClick={generate}
          disabled={busy}
          className="bg-primary hover:bg-primary/90 disabled:opacity-60 w-full py-2.5 rounded-xl text-sm font-semibold text-primary-foreground transition-all flex items-center justify-center gap-2"
        >
          {busy ? (
            <><Loader2 size={15} className="animate-spin" /> Generating RFP…</>
          ) : (
            <><Sparkles size={15} /> {alreadyGenerated || latestRfpDoc ? "Regenerate RFP with AI" : "Generate RFP with AI →"}</>
          )}
        </button>

        {localBlobUrl ? (
          <a
            href={localBlobUrl}
            download={localFileName ?? "RFP.docx"}
            className="w-full py-2 rounded-xl text-xs font-semibold bg-success text-success-foreground hover:bg-success/90 transition-all flex items-center justify-center gap-2"
          >
            <Download size={14} /> Download RFP (.docx)
          </a>
        ) : latestRfpDoc ? (
          <a
            href={latestRfpDoc.fileUrl}
            target="_blank"
            rel="noopener noreferrer"
            download
            className="w-full py-2 rounded-xl text-xs font-semibold bg-success text-success-foreground hover:bg-success/90 transition-all flex items-center justify-center gap-2"
          >
            <Download size={14} /> Download RFP (.docx)
          </a>
        ) : null}
      </div>

      <VendorShortlist projectId={projectId} />
    </div>
  );
}
