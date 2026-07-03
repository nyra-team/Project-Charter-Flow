import { useState, useEffect } from "react";
import { useRoute, useLocation, Link } from "wouter";
import { useGoBack } from "../lib/back";
import {
  useGetCharter, useListCharterVendors, useListCharterRisks, useListCharterSquad,
  useListApprovals, useSubmitCharter, useListUsers, useScmNegotiate,
  useEnterFinanceOrder, useCreateProject, useUpdateCharter,
} from "@workspace/api-client-react";
import { formatCurrency, formatDate } from "../lib/format";
import { StatusBadge } from "../components/status-badge";
import { DocxView } from "../components/DocxView";
import { PdfView } from "../components/PdfView";
import { EmployeeCombobox } from "../components/employee-combobox";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { api, openApiFile } from "@/lib/extra-api";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ChevronLeft, Edit2, Send, FolderOpen,
  CheckCircle2, XCircle, Clock, IndianRupee,
  Users, AlertTriangle, Building2, Target, TrendingUp, Save, X, FileDown, Loader2, FileText, Download,
} from "lucide-react";

const editSchema = z.object({
  title: z.string().min(1, "Required"),
  description: z.string().min(1, "Required"),
  scope: z.string().min(1, "Required"),
  deliverables: z.string().min(1, "Required"),
  location: z.string().optional(),
  solutionComparison: z.string().optional(),
  tentativeBudget: z.coerce.number().min(0),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  durationDays: z.coerce.number().optional(),
  toplineImprovement: z.string().optional(),
  bottomLineOptimization: z.string().optional(),
  complianceBenefits: z.string().optional(),
  productivityImprovement: z.string().optional(),
});

type EditValues = z.infer<typeof editSchema>;

function SectionBox({ title, children, icon }: { title: string; children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="rounded-2xl p-4" style={{ background: "white", border: "1px solid #EAECF0", boxShadow: "0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.06)" }}>
      <div className="flex items-center gap-2 mb-3 pb-3 border-b border-gray-100">
        {icon && <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-indigo-50 text-indigo-500">{icon}</div>}
        <h3 className="font-semibold text-gray-900 text-[15px] tracking-tight">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-start py-2.5 border-b border-gray-50 last:border-0 gap-4">
      <span className="text-sm text-gray-400 flex-shrink-0">{label}</span>
      <span className="text-sm font-medium text-gray-800 text-right">{value ?? "—"}</span>
    </div>
  );
}

function BenefitTag({ label, value, color }: { label: string; value?: string | null; color: string }) {
  if (!value) return null;
  return (
    <div className="rounded-xl p-4" style={{ background: color }}>
      <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">{label}</p>
      <p className="text-sm text-gray-700 leading-relaxed">{value}</p>
    </div>
  );
}

export default function CharterDetail() {
  const [, params] = useRoute("/charters/:id");
  const goBack = useGoBack();
  const charterId = parseInt(params?.id || "0");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [scmBudget, setScmBudget] = useState("");
  const [financeOrder, setFinanceOrder] = useState("");
  const [showScmForm, setShowScmForm] = useState(false);
  const [showFinanceForm, setShowFinanceForm] = useState(false);
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [projectEndDate, setProjectEndDate] = useState("");
  const [activeTab, setActiveTab] = useState<"details" | "benefits" | "vendors" | "risks" | "squad" | "approvals" | "editlog" | "doa">("details");

  const { data: charter, isLoading } = useGetCharter(charterId);
  const { data: vendors } = useListCharterVendors(charterId);
  const { data: editLog } = useQuery({
    queryKey: ["/api/charters", charterId, "activity"],
    queryFn: () => api.get<{ id: number; type: string; message: string; createdAt: string }[]>(`/api/charters/${charterId}/activity`),
    enabled: charterId > 0,
  });
  const { data: doa } = useQuery({
    queryKey: ["/api/charters", charterId, "doa"],
    queryFn: () => api.get<{ source: "stored" | "preview"; location: string; amountInr: number; label: string | null; signatories: { role: string; name: string; status?: string }[] }>(`/api/charters/${charterId}/doa`),
    enabled: charterId > 0,
  });
  const { data: risks } = useListCharterRisks(charterId);
  const { data: squad } = useListCharterSquad(charterId);
  const { data: approvals } = useListApprovals({ charterId });
  const { data: users } = useListUsers();

  const [esignSending, setEsignSending] = useState(false);
  const esign = ((charter as unknown as Record<string, unknown> | undefined)?.esign ?? null) as { documentId?: number; sentAt?: string; signedObjectPath?: string; completedAt?: string; versions?: Array<{ v: number; path: string; signedBy?: string; at?: string }> } | null;
  const sendForEsign = async () => {
    setEsignSending(true);
    try {
      await api.post(`/api/charters/${charterId}/esign`);
      toast({ title: "Sent for e-signature", description: "Each approver will get a Documenso signing email, in DOA order." });
      queryClient.invalidateQueries({ queryKey: ["/api/charters"] });
    } catch (e) {
      toast({ title: "e-sign failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setEsignSending(false);
    }
  };

  const submitMutation = useSubmitCharter();
  const createProjectMutation = useCreateProject();
  const scmMutation = useScmNegotiate();
  const financeMutation = useEnterFinanceOrder();
  const updateMutation = useUpdateCharter();

  const editForm = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    values: charter ? {
      title: charter.title,
      description: charter.description,
      scope: charter.scope,
      deliverables: charter.deliverables,
      location: ((charter as unknown as Record<string, unknown>).location as string) ?? "",
      solutionComparison: charter.solutionComparison ?? "",
      tentativeBudget: Number(charter.tentativeBudget),
      startDate: charter.startDate ?? "",
      endDate: charter.endDate ?? "",
      durationDays: charter.durationDays ?? 0,
      toplineImprovement: ((charter as unknown as Record<string, unknown>).toplineImprovement as string) ?? "",
      bottomLineOptimization: ((charter as unknown as Record<string, unknown>).bottomLineOptimization as string) ?? "",
      complianceBenefits: ((charter as unknown as Record<string, unknown>).complianceBenefits as string) ?? "",
      productivityImprovement: ((charter as unknown as Record<string, unknown>).productivityImprovement as string) ?? "",
    } : undefined,
  });

  // Deep-link from the charters board "Edit" action → the full-fields wizard (drafts only).
  useEffect(() => {
    if (charter?.status === "draft" && new URLSearchParams(window.location.search).get("edit") === "1") {
      setLocation(`/charters/new?edit=${charterId}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [charter?.status]);

  // Approval signatory chain — kept outside the zod form (array of rows, same
  // editor as the create wizard). Loaded from the charter each time edit opens.
  type EditSig = { role: string; name: string; email?: string; empCode?: string; designation?: string; status?: string };
  const [editSigs, setEditSigs] = useState<EditSig[]>([]);
  useEffect(() => {
    if (isEditing) setEditSigs((((charter as unknown as Record<string, unknown>)?.signatories as EditSig[]) ?? []).map((s) => ({ ...s })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/charters", charterId] });
    queryClient.invalidateQueries({ queryKey: ["/api/charters", charterId, "activity"] });
    queryClient.invalidateQueries({ queryKey: ["/api/charters", charterId, "doa"] });
    queryClient.invalidateQueries({ queryKey: ["/api/charters"] });
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }
  if (!charter) return (
    <div className="text-center py-16 text-gray-400">Charter not found</div>
  );

  // PMO has no functional roles anymore — every PMO user can take any charter
  // workflow action. Gates are now purely the charter's workflow state.
  const canEdit = charter.status === "draft";
  const canSubmit = charter.status === "draft";
  const canCreateProject = charter.status === "approved";
  const canScmNegotiate = charter.status === "scm_review";
  const canFinanceOrder = charter.status === "finance_review";

  const onSaveEdit = (values: EditValues) => {
    const signatories = editSigs.filter((s) => s.role.trim() || s.name.trim() || s.email?.trim());
    updateMutation.mutate(
      { id: charterId, data: { ...values, tentativeBudget: values.tentativeBudget, signatories } as never },
      {
        onSuccess: () => {
          toast({ title: "Charter updated successfully" });
          setIsEditing(false);
          invalidate();
        },
        onError: () => toast({ title: "Failed to save changes", variant: "destructive" }),
      }
    );
  };

  const TABS = [
    { id: "details" as const, label: "Details" },
    { id: "vendors" as const, label: `Vendors${vendors?.length ? ` (${vendors.length})` : ""}` },
    { id: "doa" as const, label: `DOA Matrix${doa?.signatories?.length ? ` (${doa.signatories.length})` : ""}` },
    { id: "editlog" as const, label: `Edit Log${editLog?.length ? ` (${editLog.length})` : ""}` },
  ];

  const statusStep = [
    "draft", "submitted", "parallel_review", "scm_review",
    "chairman_review", "finance_review", "pmo_review", "approved", "active",
  ].indexOf(charter.status);

  return (
    <div className="space-y-2.5">
      {/* Header card — back + title + status + actions on one compact row */}
      <div
        data-tour="tour-nfa-doc"
        className="rounded-xl px-3 py-2.5"
        style={{ background: "white", border: "1px solid #EAECF0", boxShadow: "0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.06)" }}
      >
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <button onClick={() => goBack("/charters")} className="flex items-center justify-center w-8 h-8 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors flex-shrink-0 -ml-1" title="Back to charters">
              <ChevronLeft size={18} />
            </button>
            <div className="flex items-center justify-center w-9 h-9 rounded-lg flex-shrink-0" style={{ background: "linear-gradient(135deg,#6366F1,#8B5CF6)" }}>
              <FileText size={17} className="text-white" />
            </div>
            {isEditing ? (
              <input
                {...editForm.register("title")}
                className="text-lg font-bold text-gray-900 border-b-2 border-indigo-400 pb-0.5 outline-none bg-transparent"
              />
            ) : (
              <h1 className="text-lg font-bold text-gray-900 truncate tracking-tight">{charter.title}</h1>
            )}
            <StatusBadge status={charter.status} />
            <span className="text-xs text-gray-400 flex-shrink-0 hidden md:inline">
              Created {formatDate(charter.createdAt)}
            </span>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
            {!isEditing && (
              <a
                href={`/api/charters/${charterId}/docx`}
                target="_blank"
                rel="noopener"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold shadow-sm transition-all hover:brightness-[0.97] active:scale-[0.97]"
                style={{ background: "#CCE7E9", color: "#0E7C86", border: "1px solid #99CFD3" }}
              >
                <FileDown size={12} />
                Charter+e-NFA (.docx)
              </a>
            )}
            {canEdit && !isEditing && (
              /* Full wizard with EVERY charter field, prefilled — saves via PATCH. */
              <Link href={`/charters/new?edit=${charterId}`}>
                <button
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold shadow-sm transition-all hover:brightness-[0.97] active:scale-[0.97]"
                  style={{ background: "#F1F5F9", color: "#475569", border: "1px solid #E2E8F0" }}
                >
                  <Edit2 size={12} />
                  Edit
                </button>
              </Link>
            )}
            {isEditing && (
              <>
                <button
                  onClick={() => { setIsEditing(false); editForm.reset(); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold shadow-sm transition-all hover:brightness-[0.97] active:scale-[0.97]"
                  style={{ background: "#F1F5F9", color: "#475569", border: "1px solid #E2E8F0" }}
                >
                  <X size={12} />
                  Cancel
                </button>
                <button
                  onClick={editForm.handleSubmit(onSaveEdit)}
                  disabled={updateMutation.isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white shadow-sm transition-all hover:brightness-105 active:scale-[0.97]"
                  style={{ background: "linear-gradient(135deg,#6366F1,#8B5CF6)" }}
                >
                  <Save size={12} />
                  Save
                </button>
              </>
            )}
            {canSubmit && !isEditing && (
              <button
                onClick={() => submitMutation.mutate({ id: charterId }, {
                  onSuccess: (res) => {
                    // The submit route resolves the DOA band → approver chain; show it
                    // so the raiser sees the note routed per the Delegation of Authority.
                    const r = res as { doaBand?: { label?: string; approverRoles?: string[] }; esign?: { documentId?: number } | null; esignError?: string | null };
                    const band = r?.doaBand;
                    const doaLine = band?.label
                      ? `DOA: ${band.label} → ${band.approverRoles?.join(", ") || "no approvers configured"}`
                      : "";
                    toast({
                      title: r?.esign?.documentId ? "Submitted — sent for e-signature" : "Submitted for approval",
                      description: [doaLine, r?.esign?.documentId ? "Each approver gets a Documenso signing email, in DOA order." : ""].filter(Boolean).join(" · ") || undefined,
                    });
                    // Documenso down ≠ submit failed: surface it and point at the
                    // manual "Send for e-Signature" button as the retry path.
                    if (r?.esignError) {
                      toast({ title: "e-signature not sent", description: `${r.esignError} — use "Send for e-Signature" to retry.`, variant: "destructive" });
                    }
                    invalidate();
                  },
                  onError: (e) => {
                    // Most common failure: no active DOA band covers this note's
                    // entity / category / amount. Surface the server message instead
                    // of silently doing nothing.
                    const msg = (e as { message?: string })?.message || "Could not submit for approval.";
                    toast({ title: "Approval routing failed", description: msg, variant: "destructive" });
                  },
                })}
                disabled={submitMutation.isPending}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white shadow-sm transition-all hover:brightness-105 active:scale-[0.97]"
                style={{ background: "linear-gradient(135deg,#10B981,#059669)" }}
              >
                <Send size={12} />
                Submit for Approval
              </button>
            )}
            {canCreateProject && !showProjectForm && (
              <button
                onClick={() => { setProjectEndDate(charter.endDate ?? ""); setShowProjectForm(true); }}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white shadow-sm cursor-pointer transition-all hover:brightness-105 active:scale-[0.97]"
                style={{ background: "linear-gradient(135deg,#6366F1,#8B5CF6)" }}
              >
                <FolderOpen size={12} />
                Create Project
              </button>
            )}
            {canScmNegotiate && !showScmForm && (
              <button
                onClick={() => setShowScmForm(true)}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white shadow-sm transition-all hover:brightness-105 active:scale-[0.97]"
                style={{ background: "linear-gradient(135deg,#F59E0B,#D97706)" }}
              >
                <IndianRupee size={12} />
                Enter Negotiated Price
              </button>
            )}
            {canFinanceOrder && !showFinanceForm && (
              <button
                onClick={() => setShowFinanceForm(true)}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white shadow-sm transition-all hover:brightness-105 active:scale-[0.97]"
                style={{ background: "linear-gradient(135deg,#3B82F6,#1D4ED8)" }}
              >
                <Building2 size={12} />
                Enter SAP Order
              </button>
            )}
          </div>
        </div>

        {/* Create Project — capture the expected end date before activating */}
        {showProjectForm && (
          <div className="mt-4 p-4 rounded-xl bg-indigo-50 border border-indigo-200">
            <p className="text-sm font-semibold text-indigo-800 mb-2">Expected project end date</p>
            <div className="flex flex-wrap gap-2 items-center">
              <input
                type="date"
                value={projectEndDate}
                onChange={e => setProjectEndDate(e.target.value)}
                className="rounded-lg px-3 py-2 text-sm border border-indigo-300 bg-white outline-none focus:ring-2 focus:ring-indigo-400"
              />
              <button
                disabled={createProjectMutation.isPending}
                onClick={() => createProjectMutation.mutate(
                  { data: { charterId, name: charter.title, description: charter.description, projectManagerId: charter.projectManagerId ?? undefined, startDate: charter.startDate ?? undefined, endDate: projectEndDate || undefined } },
                  {
                    onSuccess: (proj: { id?: number } | undefined) => {
                      setShowProjectForm(false);
                      invalidate();
                      toast({ title: "Project created", description: "Opening it in the Projects section…" });
                      setLocation(proj?.id ? `/projects/${proj.id}` : "/projects");
                    },
                    onError: () => toast({
                      title: "End date doesn't align with the charter timeline",
                      variant: "destructive",
                    }),
                  }
                )}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-indigo-500 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {createProjectMutation.isPending
                  ? <><Loader2 size={14} className="animate-spin" />Creating…</>
                  : <><FolderOpen size={14} />Create Project</>}
              </button>
              <button onClick={() => setShowProjectForm(false)} className="px-3 py-2 rounded-lg text-sm text-indigo-700 bg-white border border-indigo-300 cursor-pointer">Cancel</button>
            </div>
            <p className="mt-2 text-xs text-indigo-600/80">Leave blank to create without an end date. You can change it later in the project.</p>
          </div>
        )}

        {/* SCM Form */}
        {showScmForm && (
          <div className="mt-4 p-4 rounded-xl bg-amber-50 border border-amber-200">
            <p className="text-sm font-semibold text-amber-800 mb-2">Final Negotiated Budget (USD)</p>
            <div className="flex gap-2">
              <input
                type="number"
                value={scmBudget}
                onChange={e => setScmBudget(e.target.value)}
                placeholder="Enter negotiated amount"
                className="flex-1 rounded-lg px-3 py-2 text-sm border border-amber-300 bg-white outline-none focus:ring-2 focus:ring-amber-400"
              />
              <button
                onClick={() => scmMutation.mutate({ id: charterId, data: { finalNegotiatedBudget: Number(scmBudget) } }, { onSuccess: () => { toast({ title: "Budget confirmed" }); setShowScmForm(false); invalidate(); } })}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-amber-500"
              >Confirm</button>
              <button onClick={() => setShowScmForm(false)} className="px-3 py-2 rounded-lg text-sm text-amber-700 bg-white border border-amber-300">Cancel</button>
            </div>
          </div>
        )}

        {/* Finance Form */}
        {showFinanceForm && (
          <div className="mt-4 p-4 rounded-xl bg-blue-50 border border-blue-200">
            <p className="text-sm font-semibold text-blue-800 mb-2">SAP Internal Order Number</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={financeOrder}
                onChange={e => setFinanceOrder(e.target.value)}
                placeholder="e.g. SAP-2026-001234"
                className="flex-1 rounded-lg px-3 py-2 text-sm border border-blue-300 bg-white outline-none focus:ring-2 focus:ring-blue-400"
              />
              <button
                onClick={() => financeMutation.mutate({ id: charterId, data: { internalOrderNumber: financeOrder } }, { onSuccess: () => { toast({ title: "SAP order entered" }); setShowFinanceForm(false); invalidate(); } })}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-blue-500"
              >Confirm</button>
              <button onClick={() => setShowFinanceForm(false)} className="px-3 py-2 rounded-lg text-sm text-blue-700 bg-white border border-blue-300">Cancel</button>
            </div>
          </div>
        )}

      </div>

      {/* Two column layout */}
      <div className="grid grid-cols-1 gap-2.5">
        {/* Main content */}
        <div className="space-y-2.5">
          {/* Tabs */}
          <div className="flex gap-1 p-1 rounded-xl border border-gray-100" style={{ background: "#F8FAFC", boxShadow: "inset 0 1px 2px rgba(16,24,40,0.03)" }}>
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="flex-1 px-2 py-1.5 rounded-lg text-xs font-semibold transition-all hover:text-gray-700"
                style={{
                  background: activeTab === tab.id ? "white" : "transparent",
                  color: activeTab === tab.id ? "#4338CA" : "#64748B",
                  boxShadow: activeTab === tab.id ? "0 1px 2px rgba(16,24,40,0.06), 0 1px 3px rgba(16,24,40,0.10)" : "none",
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Details tab */}
          {activeTab === "details" && (
            <Form {...editForm}>
              <div className="space-y-4">
                {isEditing ? (
                  <SectionBox title="Edit Charter Details" icon={<Edit2 size={16} />}>
                    <div className="space-y-4">
                      <FormField control={editForm.control} name="title" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Title</FormLabel>
                          <FormControl><Input {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={editForm.control} name="description" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Description</FormLabel>
                          <FormControl><Textarea {...field} rows={3} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={editForm.control} name="scope" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Scope</FormLabel>
                          <FormControl><Textarea {...field} rows={3} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={editForm.control} name="deliverables" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Deliverables</FormLabel>
                          <FormControl><Textarea {...field} rows={3} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={editForm.control} name="location" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Location / Unit</FormLabel>
                          <FormControl><Input {...field} placeholder="e.g. Gagillapur-PFI (1300)" /></FormControl>
                          <FormMessage />
                          <p className="text-[11px] text-gray-400 mt-1">Drives the DOA matrix — sets the approver chain for this e-NFA.</p>
                        </FormItem>
                      )} />
                      <FormField control={editForm.control} name="solutionComparison" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Solution Comparison</FormLabel>
                          <FormControl><Textarea {...field} rows={2} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <FormField control={editForm.control} name="tentativeBudget" render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Tentative Budget (₹)</FormLabel>
                            <FormControl><Input type="number" {...field} /></FormControl>
                            <FormMessage />
                            <p className="text-[11px] text-gray-400 mt-1">With Location, drives the DOA approver chain.</p>
                          </FormItem>
                        )} />
                        <FormField control={editForm.control} name="startDate" render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Start Date</FormLabel>
                            <FormControl><Input type="date" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={editForm.control} name="endDate" render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs font-semibold text-gray-500 uppercase tracking-wider">End Date</FormLabel>
                            <FormControl><Input type="date" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                      </div>
                      {/* Approval signatory chain — same editor as the create wizard.
                          A non-empty chain overrides the DOA matrix on submit. */}
                      <div>
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Approval signatory chain</p>
                        <p className="text-[11px] text-gray-400 mb-2">Sequential approval order. Leave empty to auto-route via the DOA matrix (Location + Budget).</p>
                        <div className="space-y-2">
                          {editSigs.map((s, i) => (
                            <div key={i} className="flex items-center gap-2">
                              <Input value={s.role} onChange={(e) => setEditSigs((a) => a.map((x, j) => j === i ? { ...x, role: e.target.value } : x))} placeholder="Role" className="h-8 w-40" />
                              <EmployeeCombobox
                                value={s.name}
                                placeholder="Select approver…"
                                onSelect={(hit) => setEditSigs((a) => a.map((x, j) => j === i ? { ...x, name: hit.name, email: hit.email ?? undefined, empCode: hit.code ?? undefined, designation: hit.designation ?? undefined } : x))}
                              />
                              <Input value={s.designation ?? ""} onChange={(e) => setEditSigs((a) => a.map((x, j) => j === i ? { ...x, designation: e.target.value } : x))} placeholder="Designation" className="h-8 w-48" />
                              <button type="button" onClick={() => setEditSigs((a) => a.filter((_, j) => j !== i))} className="w-8 h-8 rounded-md flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors flex-shrink-0"><X size={14} /></button>
                            </div>
                          ))}
                          <button type="button" onClick={() => setEditSigs((a) => [...a, { role: "", name: "" }])} className="text-xs font-semibold text-indigo-500 hover:text-indigo-700">+ Add signatory</button>
                        </div>
                      </div>
                    </div>
                  </SectionBox>
                ) : (
                  <>
                    {/* Document — the generated Charter + e-NFA rendered inline, same docx view as the create preview. */}
                    <SectionBox title="Charter + e-NFA Document" icon={<FileDown size={16} />}>
                      {/* Signed versions — one snapshot per e-signature, stored by the Documenso webhook. */}
                      {(esign?.versions?.length ?? 0) > 0 && (
                        <div className="mb-3 flex flex-wrap items-center gap-2">
                          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Signed versions</span>
                          {esign!.versions!.map((v) => (
                            <button
                              key={v.v}
                              onClick={() => void openApiFile(v.path)}
                              title={`Signed by ${v.signedBy || "?"}${v.at ? ` · ${formatDate(v.at)}` : ""}`}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors"
                            >
                              <CheckCircle2 size={12} /> v{v.v} — {v.signedBy?.split("@")[0] || "signed"}
                            </button>
                          ))}
                          {esign?.signedObjectPath && (
                            <button onClick={() => void openApiFile(esign.signedObjectPath!)} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold text-white" style={{ background: "linear-gradient(135deg,#10B981,#059669)" }}>
                              <Download size={12} /> Final signed PDF
                            </button>
                          )}
                        </div>
                      )}
                      {/* Once signatures exist, show the signed PDF (latest Documenso
                          snapshot, or the sealed final) — the DOCX render below is a
                          live regeneration and never carries signature stamps. */}
                      {(() => {
                        const signedPath = esign?.signedObjectPath ?? esign?.versions?.[esign.versions.length - 1]?.path;
                        return signedPath
                          ? <PdfView url={signedPath} height="calc(100vh - 190px)" />
                          : <DocxView docxUrl={`/api/charters/${charterId}/docx`} fileName={`${(charter.title || "Charter").replace(/[^\w\s.-]/g, "").trim() || "Charter"} — NFA.docx`} height="calc(100vh - 190px)" />;
                      })()}
                    </SectionBox>
                  </>
                )}
              </div>
            </Form>
          )}

          {/* Benefits tab */}
          {activeTab === "benefits" && (
            <div className="space-y-4">
              <div
                className="rounded-2xl p-4"
                style={{ background: "linear-gradient(135deg,#EEF2FF,#F5F3FF)", border: "1px solid #C7D2FE" }}
              >
                <div className="flex items-center gap-2">
                  <TrendingUp size={16} className="text-indigo-600" />
                  <h3 className="font-semibold text-indigo-900">Business Benefits</h3>
                </div>
                <p className="text-xs text-indigo-600 mt-1">Expected business value across four dimensions</p>
              </div>

              {isEditing ? (
                <Form {...editForm}>
                  <div className="space-y-4">
                    {[
                      { name: "toplineImprovement" as const, label: "Topline Improvement", color: "#ECFDF5" },
                      { name: "bottomLineOptimization" as const, label: "Bottom Line Optimization", color: "#EFF6FF" },
                      { name: "complianceBenefits" as const, label: "Compliance Benefits", color: "#FFFBEB" },
                      { name: "productivityImprovement" as const, label: "Productivity Improvement", color: "#F5F3FF" },
                    ].map(field => (
                      <div key={field.name} className="rounded-xl p-4" style={{ background: field.color }}>
                        <FormField control={editForm.control} name={field.name} render={({ field: f }) => (
                          <FormItem>
                            <FormLabel className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{field.label}</FormLabel>
                            <FormControl><Textarea {...f} rows={2} /></FormControl>
                          </FormItem>
                        )} />
                      </div>
                    ))}
                  </div>
                </Form>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <BenefitTag
                    label="Topline Improvement"
                    value={(charter as unknown as Record<string, unknown>).toplineImprovement as string}
                    color="#ECFDF5"
                  />
                  <BenefitTag
                    label="Bottom Line Optimization"
                    value={(charter as unknown as Record<string, unknown>).bottomLineOptimization as string}
                    color="#EFF6FF"
                  />
                  <BenefitTag
                    label="Compliance Benefits"
                    value={(charter as unknown as Record<string, unknown>).complianceBenefits as string}
                    color="#FFFBEB"
                  />
                  <BenefitTag
                    label="Productivity Improvement"
                    value={(charter as unknown as Record<string, unknown>).productivityImprovement as string}
                    color="#F5F3FF"
                  />
                  {!["toplineImprovement", "bottomLineOptimization", "complianceBenefits", "productivityImprovement"].some(
                    k => !!(charter as unknown as Record<string, unknown>)[k]
                  ) && (
                    <div className="col-span-2 text-center py-8 text-gray-400 text-sm">
                      No business benefits defined yet.
                      {canEdit && <> <button onClick={() => { setActiveTab("details"); setIsEditing(true); }} className="text-indigo-500 ml-1">Add them</button></>}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Vendors tab */}
          {activeTab === "vendors" && (
            <SectionBox title="Vendor Comparison" icon={<Building2 size={16} />}>
              {vendors?.length ? (
                <div className="overflow-x-auto rounded-xl border border-gray-100">
                  <table className="w-full text-sm min-w-[560px]">
                    <thead style={{ background: "#F8FAFC" }}>
                      <tr>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Vendor</th>
                        <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Proposed Price</th>
                        <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Selected</th>
                      </tr>
                    </thead>
                    <tbody>
                      {vendors.map(v => (
                        <tr key={v.id} className="border-t border-gray-50 hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-3 font-medium text-gray-800">{v.vendorName}</td>
                          <td className="px-4 py-3 text-right font-mono text-gray-700">{formatCurrency(v.proposedPrice)}</td>
                          <td className="px-4 py-3 text-center">
                            {v.isSelected
                              ? <CheckCircle2 size={16} className="text-emerald-500 mx-auto" />
                              : <XCircle size={16} className="text-gray-300 mx-auto" />}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="text-sm text-gray-400">No vendors added yet.</p>}
            </SectionBox>
          )}

          {/* DOA Matrix tab — the approver chain resolved from the DOA matrix.
              Live preview (location + amount) in draft; stored signatories with
              decision status after submit. Same chain the standalone e-NFA shows. */}
          {activeTab === "doa" && (
            <SectionBox title="Delegation of Authority (DOA)" icon={<Users size={16} />}>
              {doa?.signatories?.length ? (
                <>
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <p className="text-xs text-gray-500">
                      {doa.source === "stored"
                        ? "Approver chain resolved via the DOA matrix at submission."
                        : `Preview — resolves on submit from Location “${doa.location || "—"}” at ${formatCurrency(doa.amountInr)}${doa.label ? ` · band: ${doa.label}` : ""}.`}
                    </p>
                    {esign?.signedObjectPath && (
                      <button
                        onClick={() => void openApiFile(esign.signedObjectPath!)}
                        className="flex-shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold text-white px-3 py-1.5 rounded-lg"
                        style={{ background: "linear-gradient(135deg,#10B981,#059669)" }}
                      >
                        <Download size={13} /> Signed PDF
                      </button>
                    )}
                    {charter?.status === "parallel_review" && (
                      esign?.documentId ? (
                        <span className="text-xs font-medium text-indigo-500 flex-shrink-0 flex items-center gap-1">
                          <CheckCircle2 size={13} /> Sent for e-signature{esign.sentAt ? ` · ${formatDate(esign.sentAt)}` : ""}
                        </span>
                      ) : (
                        <button
                          onClick={sendForEsign}
                          disabled={esignSending}
                          className="flex-shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold text-white px-3 py-1.5 rounded-lg disabled:opacity-60"
                          style={{ background: "linear-gradient(135deg,#6366F1,#8B5CF6)" }}
                        >
                          {esignSending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                          Send for e-Signature
                        </button>
                      )
                    )}
                  </div>
                  <div className="overflow-x-auto rounded-xl border border-gray-100">
                    <table className="w-full text-sm min-w-[480px]">
                      <thead style={{ background: "#F8FAFC" }}>
                        <tr>
                          <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">#</th>
                          <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Role / Designation</th>
                          <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Approver</th>
                          <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {doa.signatories.map((s, i) => {
                          const st = (s.status ?? "pending").toLowerCase();
                          const color = st === "approved" ? "#16a34a" : st === "rejected" ? "#FF0000" : "#64748B";
                          return (
                            <tr key={i} className="border-t border-gray-50">
                              <td className="px-4 py-3 text-gray-400 tabular-nums">{i + 1}</td>
                              <td className="px-4 py-3 font-medium text-gray-800">{s.role || "—"}</td>
                              <td className="px-4 py-3 text-gray-700">{s.name || "—"}</td>
                              <td className="px-4 py-3 text-center font-semibold" style={{ color }}>{st.charAt(0).toUpperCase() + st.slice(1)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <p className="text-sm text-gray-400">
                  No DOA band matched{doa ? ` for Location “${doa.location || "—"}” at ${formatCurrency(doa.amountInr)}` : ""}. Set the Location/Unit &amp; budget, or configure a band at the DOA matrix admin.
                </p>
              )}
            </SectionBox>
          )}

          {/* Edit Log tab — audit trail of e-NFA edits */}
          {activeTab === "editlog" && (
            <SectionBox title="Edit Log" icon={<Clock size={16} />}>
              {editLog?.length ? (
                <ol className="relative border-l border-gray-200 ml-2 space-y-4">
                  {editLog.map(e => (
                    <li key={e.id} className="ml-4">
                      <span className="absolute -left-[5px] mt-1.5 w-2.5 h-2.5 rounded-full bg-indigo-400 border-2 border-white" />
                      <p className="text-sm text-gray-800">{e.message}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{formatDate(e.createdAt)}</p>
                    </li>
                  ))}
                </ol>
              ) : <p className="text-sm text-gray-400">No edits logged yet. Changes made while the e-NFA is a draft will appear here.</p>}
            </SectionBox>
          )}

          {/* Risks tab */}
          {activeTab === "risks" && (
            <SectionBox title="Risk Register" icon={<AlertTriangle size={16} />}>
              {risks?.length ? (
                <div className="space-y-3">
                  {risks.map(r => {
                    const impactColor = r.impact === "high" ? "#FEF2F2" : r.impact === "medium" ? "#FFFBEB" : "#ECFDF5";
                    const impactTextColor = r.impact === "high" ? "#991B1B" : r.impact === "medium" ? "#92400E" : "#065F46";
                    return (
                      <div key={r.id} className="rounded-xl p-4" style={{ background: impactColor, border: `1px solid ${impactColor}` }}>
                        <div className="flex items-start justify-between gap-3 mb-1">
                          <h4 className="font-semibold text-gray-800 text-sm">{r.title}</h4>
                          <div className="flex gap-2 flex-shrink-0">
                            <span className="text-xs px-2 py-0.5 rounded-full font-semibold capitalize" style={{ background: impactColor, color: impactTextColor, border: `1px solid ${impactTextColor}30` }}>
                              {r.impact} impact
                            </span>
                          </div>
                        </div>
                        <p className="text-sm text-gray-500">{r.description}</p>
                        {r.mitigation && <p className="text-xs text-gray-400 mt-2 italic">Mitigation: {r.mitigation}</p>}
                      </div>
                    );
                  })}
                </div>
              ) : <p className="text-sm text-gray-400">No risks identified.</p>}
            </SectionBox>
          )}

          {/* Squad tab */}
          {activeTab === "squad" && (
            <SectionBox title="Project Squad" icon={<Users size={16} />}>
              {squad?.length ? (
                <div className="space-y-2">
                  {squad.map(s => {
                    const user = users?.find(u => u.id === s.userId);
                    return (
                      <div key={s.id} className="flex items-center gap-3 p-3 rounded-xl" style={{ background: "#F8FAFC" }}>
                        <div
                          className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                          style={{ background: "linear-gradient(135deg,#6366F1,#8B5CF6)" }}
                        >
                          {(user?.name || "?").charAt(0)}
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-semibold text-gray-800">{user?.name || `User ${s.userId}`}</p>
                          <p className="text-xs text-gray-400 capitalize">{s.role}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : <p className="text-sm text-gray-400">No squad members assigned.</p>}
            </SectionBox>
          )}

          {/* Approvals tab */}
          {activeTab === "approvals" && (
            <SectionBox title="Approval Timeline" icon={<CheckCircle2 size={16} />}>
              {approvals?.length ? (
                <div className="relative">
                  <div className="absolute left-4 top-2 bottom-2 w-0.5 bg-gray-100" />
                  <div className="space-y-4">
                    {approvals.map(app => {
                      const isApproved = app.status === "approved";
                      const isRejected = app.status === "rejected";
                      const isPending = app.status === "pending";
                      return (
                        <div key={app.id} className="flex items-start gap-4 pl-2">
                          <div
                            className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 z-10"
                            style={{
                              background: isApproved ? "#ECFDF5" : isRejected ? "#FEF2F2" : "#FFFBEB",
                              border: `2px solid ${isApproved ? "#10B981" : isRejected ? "#EF4444" : "#F59E0B"}`,
                            }}
                          >
                            {isApproved
                              ? <CheckCircle2 size={12} className="text-emerald-500" />
                              : isRejected
                                ? <XCircle size={12} className="text-red-500" />
                                : <Clock size={12} className="text-amber-500" />}
                          </div>
                          <div className="flex-1 pb-4 border-b border-gray-50 last:border-0">
                            <div className="flex items-center justify-between">
                              <p className="text-sm font-semibold text-gray-800 capitalize">
                                {app.approverRole.replace(/_/g, " ")}
                              </p>
                              <span
                                className="text-xs px-2 py-0.5 rounded-full font-medium capitalize"
                                style={{
                                  background: isApproved ? "#ECFDF5" : isRejected ? "#FEF2F2" : "#FFFBEB",
                                  color: isApproved ? "#065F46" : isRejected ? "#991B1B" : "#92400E",
                                }}
                              >
                                {app.status}
                              </span>
                            </div>
                            {app.comments && (
                              <p className="text-xs text-gray-500 mt-1 p-2 rounded-lg bg-gray-50">{app.comments}</p>
                            )}
                            {app.decidedAt && (
                              <p className="text-xs text-gray-400 mt-1">
                                <Clock size={10} className="inline mr-1" />
                                {formatDate(app.decidedAt)}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : <p className="text-sm text-gray-400">No approval records yet.</p>}
            </SectionBox>
          )}
        </div>

      </div>
    </div>
  );
}
