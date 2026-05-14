import { useState } from "react";
import { useRoute, Link } from "wouter";
import {
  useGetCharter, useListCharterVendors, useListCharterRisks, useListCharterSquad,
  useListApprovals, useSubmitCharter, useListUsers, useScmNegotiate,
  useEnterFinanceOrder, useCreateProject, useUpdateCharter,
} from "@workspace/api-client-react";
import { formatCurrency, formatDate } from "../lib/format";
import { StatusBadge } from "../components/status-badge";
import { useUserStore } from "../lib/store";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ChevronLeft, Edit2, Send, FolderOpen,
  CheckCircle2, XCircle, Clock, DollarSign,
  Users, AlertTriangle, Building2, Target, TrendingUp, Save, X,
} from "lucide-react";

const editSchema = z.object({
  title: z.string().min(1, "Required"),
  description: z.string().min(1, "Required"),
  scope: z.string().min(1, "Required"),
  deliverables: z.string().min(1, "Required"),
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

const APPROVAL_STAGE_LABELS: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
  parallel_review: "HOD / ED / CFO Review",
  scm_review: "SCM Negotiation",
  chairman_review: "Chairman Approval",
  finance_review: "Finance (SAP Order)",
  pmo_review: "PMO Team Selection",
  approved: "Approved",
  active: "Project Active",
  rejected: "Rejected",
};

function SectionBox({ title, children, icon }: { title: string; children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="rounded-2xl p-5" style={{ background: "white", border: "1px solid #E2E8F0" }}>
      <div className="flex items-center gap-2 mb-4">
        {icon && <div className="text-indigo-500">{icon}</div>}
        <h3 className="font-semibold text-gray-900">{title}</h3>
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
  const charterId = parseInt(params?.id || "0");
  const { role, userId } = useUserStore();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [scmBudget, setScmBudget] = useState("");
  const [financeOrder, setFinanceOrder] = useState("");
  const [showScmForm, setShowScmForm] = useState(false);
  const [showFinanceForm, setShowFinanceForm] = useState(false);
  const [activeTab, setActiveTab] = useState<"details" | "benefits" | "vendors" | "risks" | "squad" | "approvals">("details");

  const { data: charter, isLoading } = useGetCharter(charterId);
  const { data: vendors } = useListCharterVendors(charterId);
  const { data: risks } = useListCharterRisks(charterId);
  const { data: squad } = useListCharterSquad(charterId);
  const { data: approvals } = useListApprovals({ charterId });
  const { data: users } = useListUsers();

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

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/charters", charterId] });
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

  const canEdit = charter.status === "draft" && role === "initiator";
  const canSubmit = charter.status === "draft" && role === "initiator";
  const canCreateProject = charter.status === "approved" && role === "pmo";
  const canScmNegotiate = charter.status === "scm_review" && role === "scm";
  const canFinanceOrder = charter.status === "finance_review" && role === "finance";

  const onSaveEdit = (values: EditValues) => {
    updateMutation.mutate(
      { id: charterId, data: { ...values, tentativeBudget: values.tentativeBudget } },
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
    { id: "benefits" as const, label: "Benefits" },
    { id: "vendors" as const, label: `Vendors${vendors?.length ? ` (${vendors.length})` : ""}` },
    { id: "risks" as const, label: `Risks${risks?.length ? ` (${risks.length})` : ""}` },
    { id: "squad" as const, label: `Squad${squad?.length ? ` (${squad.length})` : ""}` },
    { id: "approvals" as const, label: `Approvals${approvals?.length ? ` (${approvals.length})` : ""}` },
  ];

  const statusStep = [
    "draft", "submitted", "parallel_review", "scm_review",
    "chairman_review", "finance_review", "pmo_review", "approved", "active",
  ].indexOf(charter.status);

  return (
    <div className="space-y-5">
      {/* Back */}
      <Link href="/charters">
        <button className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors">
          <ChevronLeft size={15} />
          Back to Charters
        </button>
      </Link>

      {/* Header card */}
      <div
        className="rounded-2xl p-6"
        style={{ background: "white", border: "1px solid #E2E8F0" }}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            {isEditing ? (
              <input
                {...editForm.register("title")}
                className="text-2xl font-bold text-gray-900 w-full border-b-2 border-indigo-400 pb-1 outline-none bg-transparent"
              />
            ) : (
              <h1 className="text-2xl font-bold text-gray-900">{charter.title}</h1>
            )}
            <div className="flex items-center gap-3 mt-2">
              <StatusBadge status={charter.status} />
              <span className="text-xs text-gray-400">
                Created {formatDate(charter.createdAt)}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {canEdit && !isEditing && (
              <button
                onClick={() => setIsEditing(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-all"
                style={{ background: "#F1F5F9", color: "#475569", border: "1px solid #E2E8F0" }}
              >
                <Edit2 size={14} />
                Edit
              </button>
            )}
            {isEditing && (
              <>
                <button
                  onClick={() => { setIsEditing(false); editForm.reset(); }}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium"
                  style={{ background: "#F1F5F9", color: "#475569", border: "1px solid #E2E8F0" }}
                >
                  <X size={14} />
                  Cancel
                </button>
                <button
                  onClick={editForm.handleSubmit(onSaveEdit)}
                  disabled={updateMutation.isPending}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold text-white"
                  style={{ background: "linear-gradient(135deg,#6366F1,#8B5CF6)" }}
                >
                  <Save size={14} />
                  Save
                </button>
              </>
            )}
            {canSubmit && !isEditing && (
              <button
                onClick={() => submitMutation.mutate({ id: charterId }, { onSuccess: () => { toast({ title: "Submitted for approval" }); invalidate(); } })}
                disabled={submitMutation.isPending}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white"
                style={{ background: "linear-gradient(135deg,#10B981,#059669)" }}
              >
                <Send size={14} />
                Submit for Approval
              </button>
            )}
            {canCreateProject && (
              <button
                onClick={() => createProjectMutation.mutate(
                  { data: { charterId, name: charter.title, description: charter.description, projectManagerId: charter.projectManagerId ?? undefined, startDate: charter.startDate ?? undefined, endDate: charter.endDate ?? undefined } },
                  { onSuccess: () => { toast({ title: "Project activated" }); invalidate(); } }
                )}
                disabled={createProjectMutation.isPending}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white"
                style={{ background: "linear-gradient(135deg,#6366F1,#8B5CF6)" }}
              >
                <FolderOpen size={14} />
                Create Project
              </button>
            )}
            {canScmNegotiate && !showScmForm && (
              <button
                onClick={() => setShowScmForm(true)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white"
                style={{ background: "linear-gradient(135deg,#F59E0B,#D97706)" }}
              >
                <DollarSign size={14} />
                Enter Negotiated Price
              </button>
            )}
            {canFinanceOrder && !showFinanceForm && (
              <button
                onClick={() => setShowFinanceForm(true)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white"
                style={{ background: "linear-gradient(135deg,#3B82F6,#1D4ED8)" }}
              >
                <Building2 size={14} />
                Enter SAP Order
              </button>
            )}
          </div>
        </div>

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

        {/* Approval Progress Bar */}
        {charter.status !== "rejected" && (
          <div className="mt-5 pt-4 border-t border-gray-100">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Workflow Progress</span>
              <span className="text-xs font-semibold text-indigo-600 capitalize">{APPROVAL_STAGE_LABELS[charter.status] ?? charter.status}</span>
            </div>
            <div className="flex gap-1">
              {["draft", "parallel_review", "scm_review", "chairman_review", "finance_review", "pmo_review", "approved"].map((stage, i) => {
                const stageIdx = ["draft", "parallel_review", "scm_review", "chairman_review", "finance_review", "pmo_review", "approved"].indexOf(charter.status);
                const isDone = i <= stageIdx;
                return (
                  <div
                    key={stage}
                    className="flex-1 h-1.5 rounded-full transition-all"
                    style={{ background: isDone ? "linear-gradient(90deg,#6366F1,#8B5CF6)" : "#E2E8F0" }}
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Two column layout */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        {/* Main content */}
        <div className="xl:col-span-2 space-y-5">
          {/* Tabs */}
          <div className="flex gap-1 p-1 rounded-xl" style={{ background: "#F1F5F9" }}>
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="flex-1 px-2 py-1.5 rounded-lg text-xs font-semibold transition-all"
                style={{
                  background: activeTab === tab.id ? "white" : "transparent",
                  color: activeTab === tab.id ? "#4338CA" : "#64748B",
                  boxShadow: activeTab === tab.id ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
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
                      <FormField control={editForm.control} name="solutionComparison" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Solution Comparison</FormLabel>
                          <FormControl><Textarea {...field} rows={2} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>
                  </SectionBox>
                ) : (
                  <>
                    <SectionBox title="Description" icon={<Target size={16} />}>
                      <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">{charter.description}</p>
                    </SectionBox>
                    <SectionBox title="Scope" icon={<Target size={16} />}>
                      <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">{charter.scope}</p>
                    </SectionBox>
                    <SectionBox title="Deliverables">
                      <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">{charter.deliverables}</p>
                    </SectionBox>
                    {charter.solutionComparison && (
                      <SectionBox title="Solution Comparison">
                        <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">{charter.solutionComparison}</p>
                      </SectionBox>
                    )}
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
                <div className="overflow-hidden rounded-xl border border-gray-100">
                  <table className="w-full text-sm">
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

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Budget & Timeline */}
          <SectionBox title="Budget & Timeline">
            {isEditing ? (
              <Form {...editForm}>
                <div className="space-y-3">
                  <FormField control={editForm.control} name="tentativeBudget" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-gray-500">Budget (USD)</FormLabel>
                      <FormControl><Input {...field} type="number" className="h-9" /></FormControl>
                    </FormItem>
                  )} />
                  <FormField control={editForm.control} name="startDate" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-gray-500">Start Date</FormLabel>
                      <FormControl><Input {...field} type="date" className="h-9" /></FormControl>
                    </FormItem>
                  )} />
                  <FormField control={editForm.control} name="endDate" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-gray-500">End Date</FormLabel>
                      <FormControl><Input {...field} type="date" className="h-9" /></FormControl>
                    </FormItem>
                  )} />
                  <FormField control={editForm.control} name="durationDays" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-gray-500">Duration (days)</FormLabel>
                      <FormControl><Input {...field} type="number" className="h-9" /></FormControl>
                    </FormItem>
                  )} />
                </div>
              </Form>
            ) : (
              <div>
                <InfoRow label="Tentative Budget" value={formatCurrency(charter.tentativeBudget)} />
                {charter.finalNegotiatedBudget && (
                  <InfoRow label="Negotiated Budget" value={
                    <span className="text-emerald-600 font-bold">{formatCurrency(charter.finalNegotiatedBudget)}</span>
                  } />
                )}
                <InfoRow label="Start Date" value={formatDate(charter.startDate)} />
                <InfoRow label="End Date" value={formatDate(charter.endDate)} />
                <InfoRow label="Duration" value={charter.durationDays ? `${charter.durationDays} days` : null} />
                {charter.internalOrderNumber && (
                  <InfoRow label="SAP Order" value={<span className="font-mono text-blue-600">{charter.internalOrderNumber}</span>} />
                )}
              </div>
            )}
          </SectionBox>

          {/* People */}
          <SectionBox title="Stakeholders">
            <InfoRow
              label="Sponsor"
              value={users?.find(u => u.id === charter.projectSponsorId)?.name ?? null}
            />
            <InfoRow
              label="Owner"
              value={users?.find(u => u.id === charter.projectOwnerId)?.name ?? null}
            />
            <InfoRow
              label="Manager"
              value={users?.find(u => u.id === charter.projectManagerId)?.name ?? null}
            />
            <InfoRow
              label="Submitted by"
              value={users?.find(u => u.id === charter.submittedById)?.name ?? `User ${charter.submittedById}`}
            />
          </SectionBox>
        </div>
      </div>
    </div>
  );
}
