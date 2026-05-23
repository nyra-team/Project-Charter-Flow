import { useState } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useCreateCharter, useListUsers, useListScoringCriteria } from "@workspace/api-client-react";
import { useUserStore } from "../lib/store";
import { useToast } from "@/hooks/use-toast";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, ChevronLeft, ChevronRight, Check, Target, TrendingUp, Users, Hash, Star, Sparkles } from "lucide-react";
import { Link } from "wouter";
import { STRATEGIC_THEMES, FUNCTIONS_LIST } from "../lib/lifecycle-config";
import { api } from "../lib/extra-api";
import { useAiStatus } from "../components/ai-button";

const STEPS = [
  { id: "basics", label: "Project Case", icon: Hash },
  { id: "scope", label: "Scope & Deliverables", icon: Target },
  { id: "benefits", label: "Business Benefits", icon: TrendingUp },
  { id: "team", label: "Team & Budget", icon: Users },
  { id: "scoring", label: "Strategic Scoring", icon: Star },
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
    <div className="glass-surface lift-card ph-rise rounded-2xl p-6">
      <div className="mb-5">
        <h3 className="text-base font-semibold text-foreground tracking-tight">{title}</h3>
        {subtitle && <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>}
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

function AiImproveButton({ text, onResult }: { text: string; onResult: (v: string) => void }) {
  const status = useAiStatus();
  const [loading, setLoading] = useState(false);
  if (status && !status.configured) return null;
  return (
    <button
      type="button"
      disabled={loading || (text?.length ?? 0) < 20}
      title={(text?.length ?? 0) < 20 ? "Write at least 20 chars first, AI will polish it" : "Polish & expand using AI"}
      onClick={async () => {
        setLoading(true);
        try {
          const data = await api.post<{ rewritten?: string; improved?: string }>("/api/ai/improve-text", { text, instruction: "expand and add concrete business justification detail", audience: "Corporate steering committee" });
          const out = data?.rewritten ?? data?.improved;
          if (out) onResult(out);
        } catch (e) { console.warn(e); }
        finally { setLoading(false); }
      }}
      className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:text-primary/80 disabled:opacity-50"
    >
      {loading ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
      AI Improve
    </button>
  );
}

function CharCount({ value, min }: { value: string; min: number }) {
  const len = value?.length ?? 0;
  const ok = len >= min;
  return (
    <span className={`text-xs font-medium ${ok ? "text-success" : "text-muted-foreground"}`}>
      {len}/{min} chars{ok ? " ✓" : ""}
    </span>
  );
}

function BenefitCard({
  label, description, icon, accent, children,
}: {
  label: string; description: string; icon: React.ReactNode; accent: "success" | "primary" | "warn" | "accent"; children: React.ReactNode;
}) {
  const accentMap: Record<string, string> = {
    success: "bg-success/15 text-success border-success/30",
    primary: "bg-primary/15 text-primary border-primary/30",
    warn:    "bg-warn/15 text-warn border-warn/30",
    accent:  "bg-accent/40 text-accent-foreground border-accent",
  };
  return (
    <div className="glass-surface lift-card ph-rise rounded-2xl p-5">
      <div className="flex items-start gap-3 mb-3">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 border ${accentMap[accent]}`}>
          {icon}
        </div>
        <div>
          <div className="font-semibold text-foreground text-sm tracking-tight">{label}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{description}</div>
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
  const { data: scoringCriteria = [] } = useListScoringCriteria();
  const [previewScores, setPreviewScores] = useState<Record<number, number>>({});

  function onSubmit(values: FormValues) {
    const description = `${values.businessJustification}\n\n**Expected Outcomes:**\n${values.expectedOutcomes}`;
    const scope = `**Scope Summary:** ${values.scopeSummary}\n\n${values.scope}`;
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
      [],
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
          <button className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ChevronLeft size={15} />
            Back to Charters
          </button>
        </Link>
      </div>

      <div className="glass-surface lift-card ph-rise rounded-2xl p-5 mb-6 relative overflow-hidden">
        <span aria-hidden className="pointer-events-none absolute bottom-0 left-5 right-5 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-2xl font-bold text-foreground tracking-tight">New Project Case</h2>
            <p className="text-muted-foreground text-sm mt-1">Complete the project case to initiate the approval workflow.</p>
          </div>
          <div className="text-right">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold">Reference ID</p>
            <p className="text-sm font-bold text-primary font-mono">Pending assignment</p>
          </div>
        </div>
      </div>

      {/* Step indicator */}
      <div className="glass-surface lift-card ph-rise rounded-2xl p-4 mb-6">
        <div className="flex items-center gap-0">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const isActive = i === step;
            const isDone = i < step;
            const circleCls = isActive
              ? "bg-primary text-primary-foreground shadow-sm"
              : isDone
                ? "bg-success text-primary-foreground"
                : "bg-muted text-muted-foreground";
            const labelCls = isActive
              ? "text-primary"
              : isDone
                ? "text-success"
                : "text-muted-foreground";
            const connectorCls = i < step ? "bg-success" : "bg-border";
            return (
              <div key={s.id} className="flex items-center flex-1">
                <button onClick={() => isDone && setStep(i)} className="flex items-center gap-2" disabled={!isDone}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold transition-all ${circleCls}`}>
                    {isDone ? <Check size={13} /> : <Icon size={13} />}
                  </div>
                  <span className={`text-xs font-semibold hidden sm:block ${labelCls}`}>
                    {s.label}
                  </span>
                </button>
                {i < STEPS.length - 1 && (
                  <div className={`flex-1 h-0.5 mx-2 rounded ${connectorCls}`} />
                )}
              </div>
            );
          })}
        </div>
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
                      <FormLabel className="text-sm font-medium text-foreground">Project Title</FormLabel>
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
                        <FormLabel className="text-sm font-medium text-foreground">Business Justification</FormLabel>
                        <div className="flex items-center gap-3">
                          <AiImproveButton text={field.value ?? ""} onResult={(v) => field.onChange(v)} />
                          <CharCount value={watchedBizJust} min={100} />
                        </div>
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
                        <FormLabel className="text-sm font-medium text-foreground">Scope Summary</FormLabel>
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
                      <FormLabel className="text-sm font-medium text-foreground">Expected Outcomes</FormLabel>
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
                      <FormLabel className="text-sm font-medium text-foreground">Function / Department</FormLabel>
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
                      <FormLabel className="text-sm font-medium text-foreground">Strategic Themes</FormLabel>
                      <div className="flex flex-wrap gap-2 mt-1">
                        {STRATEGIC_THEMES.map(theme => {
                          const selected = watchedStrategicThemes.includes(theme);
                          const themeCls = selected
                            ? "bg-primary text-primary-foreground border-primary shadow-sm"
                            : "bg-muted text-muted-foreground border-border hover:bg-accent hover:text-accent-foreground";
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
                              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all border ${themeCls}`}
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
                      <FormLabel className="text-sm font-medium text-foreground">Detailed Scope Statement</FormLabel>
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
                      <FormLabel className="text-sm font-medium text-foreground">Key Deliverables</FormLabel>
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
                      <FormLabel className="text-sm font-medium text-foreground">Solution / Vendor Comparison</FormLabel>
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
              <div className="rounded-2xl p-4 mb-2 bg-primary/10 border border-primary/20">
                <h3 className="font-semibold text-primary text-sm tracking-tight">Business Benefits Assessment</h3>
                <p className="text-xs text-primary/80 mt-1">Quantify and describe the expected business value. All fields are optional but strengthen the approval case.</p>
              </div>

              <BenefitCard label="Topline Improvement" description="Revenue growth, new market opportunities, sales uplift" accent="success" icon={<TrendingUp size={16} />}>
                <FormField control={form.control} name="toplineImprovement" render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Textarea {...field} rows={3} placeholder="e.g. Expected 15% revenue increase through new digital channels..." />
                    </FormControl>
                  </FormItem>
                )} />
              </BenefitCard>

              <BenefitCard label="Bottom Line Optimization" description="Cost reduction, efficiency gains, operational savings" accent="primary" icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>}>
                <FormField control={form.control} name="bottomLineOptimization" render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Textarea {...field} rows={3} placeholder="e.g. Reduce operational costs by 20% through automation..." />
                    </FormControl>
                  </FormItem>
                )} />
              </BenefitCard>

              <BenefitCard label="Compliance Benefits" description="Regulatory adherence, risk reduction, audit readiness" accent="warn" icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>}>
                <FormField control={form.control} name="complianceBenefits" render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Textarea {...field} rows={3} placeholder="e.g. Achieve ISO 27001 certification, reduce regulatory penalty risk..." />
                    </FormControl>
                  </FormItem>
                )} />
              </BenefitCard>

              <BenefitCard label="Productivity Improvement" description="Time savings, faster processes, better employee experience" accent="accent" icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>}>
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
                      <FormLabel className="text-sm font-medium text-foreground">Total Tentative Budget (USD)</FormLabel>
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
                        <FormLabel className="text-sm font-medium text-foreground">CapEx Amount (USD)</FormLabel>
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
                        <FormLabel className="text-sm font-medium text-foreground">OpEx Amount (USD)</FormLabel>
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
                      <FormLabel className="text-sm font-medium text-foreground">Start Date</FormLabel>
                      <FormControl><Input {...field} type="date" className="h-10" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="endDate" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium text-foreground">End Date</FormLabel>
                      <FormControl><Input {...field} type="date" className="h-10" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </FieldRow>
                <FormField control={form.control} name="durationDays" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium text-foreground">Duration (Days)</FormLabel>
                    <FormControl><Input {...field} type="number" min={0} placeholder="90" className="h-10" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </SectionCard>

              <SectionCard title="Project Team" subtitle="Key stakeholders and leadership">
                <FieldRow>
                  <FormField control={form.control} name="projectSponsorId" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium text-foreground">Project Sponsor</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value?.toString() || ""}>
                        <FormControl>
                          <SelectTrigger className="h-10">
                            <SelectValue placeholder="Select sponsor" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {users?.map(u => (
                            <SelectItem key={u.id} value={u.id.toString()}>
                              {u.name} <span className="text-muted-foreground capitalize">· {u.role}</span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="projectOwnerId" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium text-foreground">Project Owner</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value?.toString() || ""}>
                        <FormControl>
                          <SelectTrigger className="h-10">
                            <SelectValue placeholder="Select owner" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {users?.map(u => (
                            <SelectItem key={u.id} value={u.id.toString()}>
                              {u.name} <span className="text-muted-foreground capitalize">· {u.role}</span>
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

          {/* Step 4: Strategic Scoring Preview */}
          {step === 4 && (() => {
            const criteria = scoringCriteria as Array<{ id: number; name: string; weightPct: number; description?: string | null }>;
            const weightedTotal = criteria.reduce((sum, c) => {
              const s = previewScores[c.id] ?? 0;
              return sum + (s * Number(c.weightPct)) / 100;
            }, 0);
            const maxPossible = criteria.reduce((sum, c) => sum + (5 * Number(c.weightPct)) / 100, 0);
            const pct = maxPossible > 0 ? Math.round((weightedTotal / maxPossible) * 100) : 0;
            const rank = pct >= 80 ? "High Priority" : pct >= 50 ? "Medium Priority" : pct > 0 ? "Low Priority" : "Not scored";
            const rankCls = pct >= 80 ? "text-success" : pct >= 50 ? "text-warn" : "text-muted-foreground";
            const barCls = pct >= 80 ? "bg-success" : pct >= 50 ? "bg-warn" : "bg-muted-foreground";
            return (
              <div className="space-y-4">
                <div className="rounded-2xl p-4 bg-primary/10 border border-primary/20">
                  <h3 className="font-semibold text-primary text-sm tracking-tight">Strategic Scoring Preview</h3>
                  <p className="text-xs text-primary/80 mt-1">
                    Rate this project against PMO criteria to see its preliminary strategic score. This helps prioritise intake before the formal approval process.
                  </p>
                </div>

                {criteria.length === 0 ? (
                  <SectionCard title="No Scoring Criteria Configured" subtitle="An admin will configure scoring criteria in the Admin panel.">
                    <div className="text-center py-4">
                      <Star size={28} className="text-muted-foreground/40 mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">Scoring criteria are managed by PMO admins. You can submit the charter without scoring.</p>
                    </div>
                  </SectionCard>
                ) : (
                  <>
                    {/* Score summary */}
                    <div className="grid grid-cols-3 gap-3">
                      <div className="glass-surface lift-card ph-rise rounded-2xl p-4 text-center">
                        <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-1">Weighted Score</p>
                        <p className="text-2xl font-bold text-primary">{weightedTotal.toFixed(1)}</p>
                        <p className="text-xs text-muted-foreground">of {maxPossible.toFixed(1)} max</p>
                      </div>
                      <div className="glass-surface lift-card ph-rise rounded-2xl p-4 text-center">
                        <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-1">Score %</p>
                        <p className="text-2xl font-bold text-foreground">{pct}%</p>
                        <div className="mt-1 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${barCls}`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                      <div className="glass-surface lift-card ph-rise rounded-2xl p-4 text-center">
                        <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-1">Rank</p>
                        <p className={`text-base font-bold ${rankCls}`}>{rank}</p>
                      </div>
                    </div>

                    {/* Per-criterion scoring */}
                    <SectionCard title="Criteria Scoring" subtitle="Rate 1–5 per criterion (optional — can be updated by PMO later)">
                      <div className="space-y-4">
                        {criteria.map(c => {
                          const currentScore = previewScores[c.id] ?? 0;
                          const contrib = (currentScore * Number(c.weightPct)) / 100;
                          return (
                            <div key={c.id} className="rounded-xl p-4 bg-muted/40 border border-border">
                              <div className="flex items-start justify-between mb-2">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <p className="text-sm font-semibold text-foreground">{c.name}</p>
                                    <span className="text-xs px-2 py-0.5 rounded-full font-bold bg-primary/10 text-primary border border-primary/20">
                                      {c.weightPct}%
                                    </span>
                                  </div>
                                  {c.description && <p className="text-xs text-muted-foreground mt-0.5">{c.description}</p>}
                                </div>
                                <div className="text-right ml-4 flex-shrink-0">
                                  <p className="text-xs text-muted-foreground">Contribution</p>
                                  <p className="text-sm font-bold text-foreground">{contrib.toFixed(2)}</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-muted-foreground w-12">Score:</span>
                                <div className="flex gap-1.5">
                                  {[1,2,3,4,5].map(v => {
                                    const active = currentScore === v;
                                    return (
                                      <button
                                        key={v}
                                        type="button"
                                        onClick={() => setPreviewScores(prev => ({ ...prev, [c.id]: v }))}
                                        className={`w-8 h-8 rounded-lg text-sm font-bold transition-all ${
                                          active
                                            ? "bg-primary text-primary-foreground shadow-sm"
                                            : "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                                        }`}
                                      >
                                        {v}
                                      </button>
                                    );
                                  })}
                                  {currentScore > 0 && (
                                    <button
                                      type="button"
                                      onClick={() => setPreviewScores(prev => { const n = { ...prev }; delete n[c.id]; return n; })}
                                      className="w-8 h-8 rounded-lg text-xs font-bold transition-all bg-destructive/10 text-destructive border border-destructive/20 hover:bg-destructive/20"
                                    >
                                      ✕
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </SectionCard>
                  </>
                )}
              </div>
            );
          })()}

          {/* Navigation */}
          <div className="flex items-center justify-between mt-6">
            <button
              type="button"
              onClick={() => setStep(s => Math.max(s - 1, 0))}
              disabled={step === 0}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-muted text-muted-foreground border border-border hover:bg-accent hover:text-accent-foreground"
            >
              <ChevronLeft size={15} />
              Previous
            </button>

            {step < STEPS.length - 1 ? (
              <button
                type="button"
                onClick={handleNext}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm"
              >
                Next Step
                <ChevronRight size={15} />
              </button>
            ) : (
              <button
                type="submit"
                disabled={createCharter.isPending}
                className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm disabled:opacity-60"
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
