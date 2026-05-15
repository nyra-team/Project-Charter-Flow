import { useState } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useCreateCharter, useListUsers } from "@workspace/api-client-react";
import { useUserStore } from "../lib/store";
import { useToast } from "@/hooks/use-toast";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, ChevronLeft, ChevronRight, Check, FileText, Target, TrendingUp, Users, Hash } from "lucide-react";
import { Link } from "wouter";
import { STRATEGIC_THEMES, FUNCTIONS_LIST } from "../lib/lifecycle-config";

const STEPS = [
  { id: "basics", label: "Project Case", icon: Hash },
  { id: "scope", label: "Scope & Deliverables", icon: Target },
  { id: "benefits", label: "Business Benefits", icon: TrendingUp },
  { id: "team", label: "Team & Budget", icon: Users },
];

const charterSchema = z.object({
  title: z.string().min(1, "Project title is required"),
  businessJustification: z.string().min(100, "Business justification must be at least 100 characters"),
  scopeSummary: z.string().min(50, "Scope summary must be at least 50 characters"),
  expectedOutcomes: z.string().min(20, "Expected outcomes are required"),
  function: z.string().min(1, "Function / Department is required"),
  strategicThemes: z.array(z.string()).min(1, "Select at least one strategic theme"),
  scope: z.string().min(1, "Detailed scope is required"),
  deliverables: z.string().min(1, "Deliverables are required"),
  solutionComparison: z.string().optional(),
  tentativeBudget: z.coerce.number().min(0, "Must be positive"),
  capexAmount: z.coerce.number().min(0).optional(),
  opexAmount: z.coerce.number().min(0).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  durationDays: z.coerce.number().optional(),
  projectSponsorId: z.coerce.number().optional(),
  projectOwnerId: z.coerce.number().optional(),
  toplineImprovement: z.string().optional(),
  bottomLineOptimization: z.string().optional(),
  complianceBenefits: z.string().optional(),
  productivityImprovement: z.string().optional(),
});

type FormValues = z.infer<typeof charterSchema>;


function SectionCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl p-6" style={{ background: "white", border: "1px solid #E2E8F0", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
      <div className="mb-5">
        <h3 className="text-base font-semibold text-gray-900">{title}</h3>
        {subtitle && <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function FieldRow({ children, cols = 2 }: { children: React.ReactNode; cols?: number }) {
  return (
    <div className={`grid gap-4 ${cols === 2 ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1"}`}>
      {children}
    </div>
  );
}

function CharCount({ value, min }: { value: string; min: number }) {
  const len = value?.length ?? 0;
  const ok = len >= min;
  return (
    <span className={`text-xs font-medium ${ok ? "text-emerald-600" : "text-gray-400"}`}>
      {len}/{min} chars{ok ? " ✓" : ""}
    </span>
  );
}

function BenefitCard({
  label, description, icon, color, children,
}: {
  label: string; description: string; icon: React.ReactNode; color: string; children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border p-5" style={{ borderColor: "#E2E8F0" }}>
      <div className="flex items-start gap-3 mb-3">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: color }}>
          {icon}
        </div>
        <div>
          <div className="font-semibold text-gray-900 text-sm">{label}</div>
          <div className="text-xs text-gray-400 mt-0.5">{description}</div>
        </div>
      </div>
      {children}
    </div>
  );
}

export default function NewCharter() {
  const [step, setStep] = useState(0);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { userId } = useUserStore();
  const { data: users } = useListUsers();
  const form = useForm<FormValues>({
    resolver: zodResolver(charterSchema),
    defaultValues: {
      title: "",
      businessJustification: "",
      scopeSummary: "",
      expectedOutcomes: "",
      function: "",
      strategicThemes: [],
      scope: "",
      deliverables: "",
      solutionComparison: "",
      tentativeBudget: 0,
      capexAmount: 0,
      opexAmount: 0,
      startDate: "",
      endDate: "",
      durationDays: 0,
      toplineImprovement: "",
      bottomLineOptimization: "",
      complianceBenefits: "",
      productivityImprovement: "",
    },
  });

  const createCharter = useCreateCharter();

  function onSubmit(values: FormValues) {
    // Persist all fields into available columns:
    // - description = business justification + expected outcomes
    // - scope = scope summary header + detailed scope body
    // - strategicAlignmentTags = [PC_ID, FUNCTION:<dept>, ...themes]
    // - scoringWeights = { capexAmount, opexAmount } (JSONB)
    const description = `${values.businessJustification}\n\n**Expected Outcomes:**\n${values.expectedOutcomes}`;
    const scope = `**Scope Summary:** ${values.scopeSummary}\n\n${values.scope}`;
    // Do NOT include a PC_ID: tag here — the server generates the canonical
    // PC-YYYY-XXXXX reference from the DB primary key and stores it authoritatively.
    const strategicAlignmentTags = [
      `FUNCTION:${values.function}`,
      ...values.strategicThemes,
    ];
    createCharter.mutate(
      {
        data: {
          title: values.title,
          description,
          scope,
          deliverables: values.deliverables,
          solutionComparison: values.solutionComparison,
          tentativeBudget: values.tentativeBudget,
          startDate: values.startDate,
          endDate: values.endDate,
          durationDays: values.durationDays,
          projectSponsorId: values.projectSponsorId,
          projectOwnerId: values.projectOwnerId,
          toplineImprovement: values.toplineImprovement,
          bottomLineOptimization: values.bottomLineOptimization,
          complianceBenefits: values.complianceBenefits,
          productivityImprovement: values.productivityImprovement,
          strategicAlignmentTags,
          submittedById: userId,
        },
      },
      {
        onSuccess: (charter) => {
          // Use server-generated canonical PC ID if returned; fall back to charter id
          const serverPcId = (charter as unknown as { pcId?: string }).pcId
            ?? `PC-${new Date().getFullYear()}-${String(charter.id).padStart(5, "0")}`;
          toast({ title: `Charter created! Reference: ${serverPcId}` });
          setLocation(`/charters/${charter.id}`);
        },
        onError: () => {
          toast({ title: "Failed to create charter", variant: "destructive" });
        },
      }
    );
  }

  async function handleNext() {
    const stepFields: (keyof FormValues)[][] = [
      ["title", "businessJustification", "scopeSummary", "expectedOutcomes", "function", "strategicThemes"],
      ["scope", "deliverables"],
      [],
      ["tentativeBudget"],
    ];
    const valid = await form.trigger(stepFields[step] as (keyof FormValues)[]);
    if (valid) setStep(s => Math.min(s + 1, STEPS.length - 1));
  }

  const watchedBizJust = form.watch("businessJustification");
  const watchedScopeSummary = form.watch("scopeSummary");
  const watchedStrategicThemes = form.watch("strategicThemes") ?? [];

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-5">
        <Link href="/charters">
          <button className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors">
            <ChevronLeft size={15} />
            Back to Charters
          </button>
        </Link>
      </div>

      <div className="mb-6">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">New Project Case</h2>
            <p className="text-gray-500 text-sm mt-1">Complete the project case to initiate the approval workflow.</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-400 font-medium">Reference ID</p>
            <p className="text-sm font-bold text-indigo-600 font-mono">Pending assignment</p>
          </div>
        </div>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-0 mb-8">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          const isActive = i === step;
          const isDone = i < step;
          return (
            <div key={s.id} className="flex items-center flex-1">
              <button onClick={() => isDone && setStep(i)} className="flex items-center gap-2" disabled={!isDone}>
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold transition-all"
                  style={{
                    background: isActive
                      ? "linear-gradient(135deg, #6366F1, #8B5CF6)"
                      : isDone
                        ? "linear-gradient(135deg, #10B981, #059669)"
                        : "#E2E8F0",
                    color: isActive || isDone ? "white" : "#94A3B8",
                  }}
                >
                  {isDone ? <Check size={13} /> : <Icon size={13} />}
                </div>
                <span className={`text-xs font-medium hidden sm:block ${isActive ? "text-indigo-600" : isDone ? "text-green-600" : "text-gray-400"}`}>
                  {s.label}
                </span>
              </button>
              {i < STEPS.length - 1 && (
                <div className="flex-1 h-0.5 mx-2" style={{ background: i < step ? "#10B981" : "#E2E8F0" }} />
              )}
            </div>
          );
        })}
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          {/* Step 0: Project Case */}
          {step === 0 && (
            <div className="space-y-4">
              <SectionCard title="Project Case Information" subtitle="Core identification and strategic alignment">
                <FormField
                  control={form.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium text-gray-700">Project Title</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="e.g. ERP System Upgrade 2026" className="h-10" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="businessJustification"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center justify-between">
                        <FormLabel className="text-sm font-medium text-gray-700">Business Justification</FormLabel>
                        <CharCount value={watchedBizJust} min={100} />
                      </div>
                      <FormControl>
                        <Textarea {...field} rows={4} placeholder="Provide a comprehensive business justification for this project. Explain why this initiative is necessary, what problem it solves, and why now..." />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="scopeSummary"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center justify-between">
                        <FormLabel className="text-sm font-medium text-gray-700">Scope Summary</FormLabel>
                        <CharCount value={watchedScopeSummary} min={50} />
                      </div>
                      <FormControl>
                        <Textarea {...field} rows={2} placeholder="Briefly summarize what is in scope and what is explicitly excluded..." />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="expectedOutcomes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium text-gray-700">Expected Outcomes</FormLabel>
                      <FormControl>
                        <Textarea {...field} rows={2} placeholder="What measurable outcomes will be achieved upon project completion?" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </SectionCard>

              <SectionCard title="Strategic Alignment" subtitle="Function, department, and strategic themes">
                <FormField
                  control={form.control}
                  name="function"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium text-gray-700">Function / Department</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger className="h-10">
                            <SelectValue placeholder="Select function/department" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {FUNCTIONS_LIST.map(f => (
                            <SelectItem key={f} value={f}>{f}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="strategicThemes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium text-gray-700">Strategic Themes</FormLabel>
                      <div className="flex flex-wrap gap-2 mt-1">
                        {STRATEGIC_THEMES.map(theme => {
                          const selected = watchedStrategicThemes.includes(theme);
                          return (
                            <button
                              key={theme}
                              type="button"
                              onClick={() => {
                                const current = field.value ?? [];
                                if (selected) {
                                  field.onChange(current.filter((t: string) => t !== theme));
                                } else {
                                  field.onChange([...current, theme]);
                                }
                              }}
                              className="px-3 py-1.5 rounded-full text-xs font-semibold transition-all"
                              style={{
                                background: selected ? "linear-gradient(135deg,#6366F1,#8B5CF6)" : "#F1F5F9",
                                color: selected ? "white" : "#64748B",
                                border: selected ? "none" : "1px solid #E2E8F0",
                              }}
                            >
                              {theme}
                            </button>
                          );
                        })}
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </SectionCard>
            </div>
          )}

          {/* Step 1: Scope & Deliverables */}
          {step === 1 && (
            <div className="space-y-4">
              <SectionCard title="Detailed Project Scope" subtitle="Full scope including inclusions and exclusions">
                <FormField
                  control={form.control}
                  name="scope"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium text-gray-700">Detailed Scope Statement</FormLabel>
                      <FormControl>
                        <Textarea {...field} rows={5} placeholder="Clearly define the full boundaries and detailed scope of this project, including what is in scope and what is explicitly excluded..." />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </SectionCard>
              <SectionCard title="Deliverables" subtitle="Tangible outputs this project will produce">
                <FormField
                  control={form.control}
                  name="deliverables"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium text-gray-700">Key Deliverables</FormLabel>
                      <FormControl>
                        <Textarea {...field} rows={4} placeholder="List the tangible outcomes, reports, systems or products..." />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="solutionComparison"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium text-gray-700">Solution / Vendor Comparison</FormLabel>
                      <FormControl>
                        <Textarea {...field} rows={3} placeholder="Compare alternative approaches or vendor solutions considered..." />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </SectionCard>
            </div>
          )}

          {/* Step 2: Business Benefits */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="rounded-xl p-4 mb-2" style={{ background: "linear-gradient(135deg, #EEF2FF, #F5F3FF)", border: "1px solid #C7D2FE" }}>
                <h3 className="font-semibold text-indigo-900 text-sm">Business Benefits Assessment</h3>
                <p className="text-xs text-indigo-600 mt-1">Quantify and describe the expected business value. All fields are optional but strengthen the approval case.</p>
              </div>

              <BenefitCard label="Topline Improvement" description="Revenue growth, new market opportunities, sales uplift" color="linear-gradient(135deg, #10B981, #059669)" icon={<TrendingUp size={16} className="text-white" />}>
                <FormField control={form.control} name="toplineImprovement" render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Textarea {...field} rows={3} placeholder="e.g. Expected 15% revenue increase through new digital channels..." />
                    </FormControl>
                  </FormItem>
                )} />
              </BenefitCard>

              <BenefitCard label="Bottom Line Optimization" description="Cost reduction, efficiency gains, operational savings" color="linear-gradient(135deg, #3B82F6, #1D4ED8)" icon={<svg className="text-white" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>}>
                <FormField control={form.control} name="bottomLineOptimization" render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Textarea {...field} rows={3} placeholder="e.g. Reduce operational costs by 20% through automation..." />
                    </FormControl>
                  </FormItem>
                )} />
              </BenefitCard>

              <BenefitCard label="Compliance Benefits" description="Regulatory adherence, risk reduction, audit readiness" color="linear-gradient(135deg, #F59E0B, #D97706)" icon={<svg className="text-white" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>}>
                <FormField control={form.control} name="complianceBenefits" render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Textarea {...field} rows={3} placeholder="e.g. Achieve ISO 27001 certification, reduce regulatory penalty risk..." />
                    </FormControl>
                  </FormItem>
                )} />
              </BenefitCard>

              <BenefitCard label="Productivity Improvement" description="Time savings, faster processes, better employee experience" color="linear-gradient(135deg, #8B5CF6, #7C3AED)" icon={<svg className="text-white" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>}>
                <FormField control={form.control} name="productivityImprovement" render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Textarea {...field} rows={3} placeholder="e.g. Reduce report generation time from 3 days to 2 hours..." />
                    </FormControl>
                  </FormItem>
                )} />
              </BenefitCard>
            </div>
          )}

          {/* Step 3: Team & Budget */}
          {step === 3 && (
            <div className="space-y-4">
              <SectionCard title="Budget & Timeline" subtitle="Financial parameters with CapEx/OpEx split">
                <FormField
                  control={form.control}
                  name="tentativeBudget"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium text-gray-700">Total Tentative Budget (USD)</FormLabel>
                      <FormControl>
                        <Input {...field} type="number" min={0} placeholder="1000000" className="h-10" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FieldRow>
                  <FormField
                    control={form.control}
                    name="capexAmount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm font-medium text-gray-700">CapEx Amount (USD)</FormLabel>
                        <FormControl>
                          <Input {...field} type="number" min={0} placeholder="600000" className="h-10" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="opexAmount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm font-medium text-gray-700">OpEx Amount (USD)</FormLabel>
                        <FormControl>
                          <Input {...field} type="number" min={0} placeholder="400000" className="h-10" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </FieldRow>
                <FieldRow>
                  <FormField control={form.control} name="startDate" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium text-gray-700">Start Date</FormLabel>
                      <FormControl><Input {...field} type="date" className="h-10" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="endDate" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium text-gray-700">End Date</FormLabel>
                      <FormControl><Input {...field} type="date" className="h-10" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </FieldRow>
                <FormField control={form.control} name="durationDays" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium text-gray-700">Duration (Days)</FormLabel>
                    <FormControl><Input {...field} type="number" min={0} placeholder="90" className="h-10" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </SectionCard>

              <SectionCard title="Project Team" subtitle="Key stakeholders and leadership">
                <FieldRow>
                  <FormField control={form.control} name="projectSponsorId" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium text-gray-700">Project Sponsor</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value?.toString() || ""}>
                        <FormControl>
                          <SelectTrigger className="h-10">
                            <SelectValue placeholder="Select sponsor" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {users?.map(u => (
                            <SelectItem key={u.id} value={u.id.toString()}>
                              {u.name} <span className="text-gray-400 capitalize">· {u.role}</span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="projectOwnerId" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium text-gray-700">Project Owner</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value?.toString() || ""}>
                        <FormControl>
                          <SelectTrigger className="h-10">
                            <SelectValue placeholder="Select owner" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {users?.map(u => (
                            <SelectItem key={u.id} value={u.id.toString()}>
                              {u.name} <span className="text-gray-400 capitalize">· {u.role}</span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                </FieldRow>
              </SectionCard>
            </div>
          )}

          {/* Navigation */}
          <div className="flex items-center justify-between mt-6">
            <button
              type="button"
              onClick={() => setStep(s => Math.max(s - 1, 0))}
              disabled={step === 0}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: "#F1F5F9", color: "#475569", border: "1px solid #E2E8F0" }}
            >
              <ChevronLeft size={15} />
              Previous
            </button>

            {step < STEPS.length - 1 ? (
              <button
                type="button"
                onClick={handleNext}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90"
                style={{ background: "linear-gradient(135deg, #6366F1, #8B5CF6)" }}
              >
                Next Step
                <ChevronRight size={15} />
              </button>
            ) : (
              <button
                type="submit"
                disabled={createCharter.isPending}
                className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90 disabled:opacity-60"
                style={{ background: "linear-gradient(135deg, #6366F1, #8B5CF6)" }}
              >
                {createCharter.isPending && <Loader2 size={14} className="animate-spin" />}
                Submit Project Case
                <Check size={14} />
              </button>
            )}
          </div>
        </form>
      </Form>
    </div>
  );
}
