import { useState } from "react";
import { jsPDF } from "jspdf";
import {
 useListProjectStages,
 useUpdateProjectStage,
 useCreateDocument,
 useGetProject,
 useListDocuments,
} from "@workspace/api-client-react";
import { Download } from "lucide-react";
import { useUserStore } from "../../lib/store";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { AiButton } from "../ai-button";

type AiSections = { introduction?: string; scopeOfWork?: string; proposalRequirements?: string; evaluationCriteria?: string; termsAndConditions?: string };

export function RFPTemplateSection({ projectId }: { projectId: number }) {
 const createDocument = useCreateDocument();
 const updateStage = useUpdateProjectStage();
 const { userId } = useUserStore();
 const { toast } = useToast();
 const queryClient = useQueryClient();
 const { data: stages = [] } = useListProjectStages(projectId);
 const { data: project } = useGetProject(projectId);
 const { data: docs = [] } = useListDocuments(projectId);
 const latestRfpDoc = (docs as Array<{ name: string; fileUrl: string; uploadedAt?: string }>)
   .filter((d) => d.name === "RFP Document")
   .sort((a, b) => (b.uploadedAt ?? "").localeCompare(a.uploadedAt ?? ""))[0];
 const [generated, setGenerated] = useState(false);
 const [aiSections, setAiSections] = useState<AiSections | null>(null);

 const rfpRecord = (
 stages as Array<{ id: number; stage: string; notes?: string | null }>
 ).find((s) => s.stage === "rfp");
 const ursRecord = (
 stages as Array<{ id: number; stage: string; notes?: string | null }>
 ).find((s) => s.stage === "urs");

 const parsedRfpNotes: Record<string, unknown> = (() => {
 try { return JSON.parse(rfpRecord?.notes ?? "{}"); }
 catch { return {}; }
 })();
 const parsedUrsNotes: Record<string, unknown> = (() => {
 try { return JSON.parse(ursRecord?.notes ?? "{}"); }
 catch { return {}; }
 })();

 const alreadyGenerated = !!(parsedRfpNotes.__rfp_template_generated);
 const projectTitle = (project as { name?: string } | undefined)?.name ?? "Project";
 const ursScope =
 (parsedUrsNotes.__urs_scope as string | undefined) ??
 (project as { scope?: string } | undefined)?.scope ?? "";
 const ursRequirements = (parsedUrsNotes.__urs_requirements as string | undefined) ?? "";
 const ursBizApprover = (parsedUrsNotes.__urs_biz_approver as string | undefined) ?? "";
 const ursItApprover = (parsedUrsNotes.__urs_it_approver as string | undefined) ?? "";
 const ursApprovalLine =
 [ursBizApprover, ursItApprover].filter(Boolean).join(" and ") || "Business Owner and IT Team";

 function generateRFPTemplate() {
 const now = new Date().toISOString();
 const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
 const pageW = doc.internal.pageSize.getWidth();
 const marginX = 20;
 const contentW = pageW - marginX * 2;

 doc.setFillColor(59, 130, 246);
 doc.rect(0, 0, pageW, 18, "F");
 doc.setTextColor(255, 255, 255);
 doc.setFontSize(13);
 doc.setFont("helvetica", "bold");
 doc.text("REQUEST FOR PROPOSAL (RFP)", marginX, 12);
 doc.setFontSize(8);
 doc.setFont("helvetica", "normal");
 doc.text(
 `Generated: ${new Date(now).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`,
 pageW - marginX,
 12,
 { align: "right" },
 );

 doc.setTextColor(30, 64, 175);
 doc.setFontSize(9);
 doc.setFont("helvetica", "bold");
 doc.text(`Project: ${projectTitle}`, marginX, 23);
 doc.setFont("helvetica", "normal");
 doc.text(`URS Approved by: ${ursApprovalLine}`, marginX + contentW / 2, 23);

 let y = 32;
 const addSection = (title: string, body: string) => {
 doc.setFont("helvetica", "bold");
 doc.setFontSize(11);
 doc.setTextColor(30, 64, 175);
 doc.text(title, marginX, y);
 y += 2;
 doc.setDrawColor(59, 130, 246);
 doc.setLineWidth(0.4);
 doc.line(marginX, y, marginX + contentW, y);
 y += 5;
 doc.setFont("helvetica", "normal");
 doc.setFontSize(10);
 doc.setTextColor(75, 85, 99);
 const lines = doc.splitTextToSize(body, contentW);
 lines.forEach((line: string) => {
 if (y > 270) { doc.addPage(); y = 20; }
 doc.text(line, marginX, y);
 y += 5.5;
 });
 y += 6;
 };

 addSection(
 "1. Introduction & Background",
 aiSections?.introduction ?? `This Request for Proposal is issued for the project "${projectTitle}". Vendors are invited to submit proposals for the provision of goods and services as detailed herein. This RFP has been derived from the approved User Requirements Specification (URS), signed off by ${ursApprovalLine}.`,
 );
 addSection(
 "2. Scope of Work",
 aiSections?.scopeOfWork ?? (ursScope
 ? `The following scope is derived from the approved URS:\n\n${ursScope}`
 : `Vendor must address all functional and technical requirements documented in the attached URS. The scope covers end-to-end delivery including design, implementation, testing, training and go-live support.`),
 );
 addSection(
 "3. Functional Requirements (from URS)",
 ursRequirements
 ? ursRequirements
 : "As detailed in the attached URS document. Vendors must provide a compliance matrix marking each requirement as Fully Compliant, Partially Compliant, or Not Compliant with notes.",
 );
 addSection(
 "4. Proposal Requirements",
 aiSections?.proposalRequirements ?? "Proposals must include: (a) Executive Summary, (b) Technical Approach and Solution Architecture, (c) Implementation Timeline with milestones, (d) Itemised Pricing — CapEx and OpEx breakdown, (e) Support, Maintenance and Warranty terms, (f) References from at least two comparable projects.",
 );
 addSection(
 "5. Evaluation Criteria",
 aiSections?.evaluationCriteria ?? "Proposals will be scored on: Functional fit to URS (40%), Technical architecture (20%), Commercial competitiveness (25%), Vendor track record and references (15%). Minimum qualifying score: 60%.",
 );
 addSection(
 "6. Submission Deadline",
 "Proposals must be submitted electronically to the Supply Chain Management (SCM) department by the deadline communicated separately. Late submissions will not be evaluated.",
 );
 addSection(
 "7. Terms & Conditions",
 aiSections?.termsAndConditions ?? "This RFP does not constitute a commitment to award a contract. The issuing organisation reserves the right to accept or reject any proposal in whole or in part. All proposal materials become property of the issuer upon submission.",
 );

 doc.setFontSize(8);
 doc.setTextColor(156, 163, 175);
 doc.text("Confidential — Generated by Project Hub", marginX, 287);
 doc.text("Page 1", pageW - marginX, 287, { align: "right" });

 const pdfBlob = doc.output("blob");
 const fileName = `rfp_${projectTitle.replace(/\s+/g, "_").toLowerCase()}_${now.slice(0, 10)}.pdf`;

 if (rfpRecord?.id) {
 updateStage.mutate(
 { id: rfpRecord.id, data: { notes: JSON.stringify({ ...parsedRfpNotes, __rfp_template_generated: now }) } },
 { onError: () => { /* non-critical */ } },
 );
 }

 fetch("/api/storage/uploads/request-url", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ name: fileName, size: pdfBlob.size, contentType: "application/pdf" }),
 })
 .then(async (r) => { if (!r.ok) throw new Error("Upload URL failed"); return r.json() as Promise<{ uploadURL: string; objectPath: string }>; })
 .then(
 ({ uploadURL, objectPath }) =>
 new Promise<string>((resolve, reject) => {
 const xhr = new XMLHttpRequest();
 xhr.open("PUT", uploadURL);
 xhr.setRequestHeader("Content-Type", "application/pdf");
 xhr.onload = () => {
 if (xhr.status >= 200 && xhr.status < 300) resolve(objectPath);
 else reject(new Error(`${xhr.status}`));
 };
 xhr.onerror = () => reject(new Error("Network error"));
 xhr.send(pdfBlob);
 }),
 )
 .then((objectPath) => {
 createDocument.mutate(
 {
 id: projectId,
 data: {
 name: "RFP Document",
 stage: "rfp",
 fileUrl: `/api/storage${objectPath}`,
 fileType: "application/pdf",
 fileSize: pdfBlob.size,
 uploadedBy: userId ?? undefined,
 description: `Auto-generated RFP pre-populated from approved URS — ${projectTitle}`,
 },
 },
 {
 onSuccess: () => {
 setGenerated(true);
 toast({ title: "RFP document generated from URS and added to Documents tab" });
 void queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "documents"] });
 },
 onError: () => toast({ title: "Failed to register RFP document", variant: "destructive" }),
 },
 );
 })
 .catch(() => toast({ title: "RFP template upload failed", variant: "destructive" }));
 }

 return (
 <div
 className="rounded-2xl p-4 space-y-3"
 >
 <div className="flex items-center justify-between">
 <p className="text-sm font-bold text-foreground">RFP Template Generator</p>
 <AiButton
 label={aiSections ? "Refine with AI" : "AI Draft Sections"}
 endpoint="/api/ai/rfp/draft-sections"
 payload={{ projectId }}
 size="sm"
 variant="subtle"
 onResult={(d) => {
 setAiSections(d as AiSections);
 toast({ title: "AI sections drafted — next generate will use them" });
 }}
 />
 </div>
 <p className="text-xs text-primary">
 Auto-generates a structured RFP PDF pre-populated from the approved URS — including project
 title, scope, requirements, approvers, and evaluation criteria. Appears in the Documents tab
 for SCM distribution.
 </p>
 {aiSections && (
 <div className="rounded-lg p-2.5 text-xs bg-success/10 border border-success/30 text-success">
 ✓ AI-drafted RFP sections ready — they will be used when you generate the PDF.
 </div>
 )}

 {alreadyGenerated || generated ? (
 <div className="space-y-2">
 <div className="rounded-xl p-3 text-center">
 <p className="text-sm font-bold text-success">✓ RFP Document generated from URS and on file</p>
 </div>
 {latestRfpDoc && (
 <a
 href={latestRfpDoc.fileUrl}
 target="_blank"
 rel="noopener noreferrer"
 download
 className="w-full py-2 rounded-xl text-xs font-semibold bg-success text-success-foreground hover:bg-success/90 transition-all flex items-center justify-center gap-2"
 >
 <Download size={14} />
 Download RFP PDF
 </a>
 )}
 <button
 onClick={generateRFPTemplate}
 className="w-full py-1.5 rounded-xl text-xs font-semibold text-primary border border-border transition-all hover:bg-card"
 >
 Regenerate RFP (pulls latest URS data)
 </button>
 </div>
 ) : (
 <button
 onClick={generateRFPTemplate}
 className="bg-primary hover:bg-primary/90 w-full py-2 rounded-xl text-sm font-semibold text-primary-foreground transition-all"
 >
 Generate RFP from URS →
 </button>
 )}

 {(ursScope || ursRequirements) && (
 <div className="rounded-lg p-2.5 text-xs text-primary bg-card border border-border">
 <p className="font-semibold mb-1">URS data detected — template will include:</p>
 {ursScope && <p>• Scope: {ursScope.slice(0, 80)}{ursScope.length > 80 ? "…" : ""}</p>}
 {ursRequirements && <p>• Requirements section from URS notes</p>}
 {(ursBizApprover || ursItApprover) && <p>• Approvers: {ursApprovalLine}</p>}
 </div>
 )}
 </div>
 );
}
