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
import { Loader2, ChevronLeft, ChevronRight, Check, FileText, Target, TrendingUp, Users } from "lucide-react";
import { Link } from "wouter";

const STEPS = [
  { id: "basics", label: "Basics", icon: FileText },
  { id: "scope", label: "Scope & Deliverables", icon: Target },
  { id: "benefits", label: "Business Benefits", icon: TrendingUp },
  { id: "team", label: "Team & Budget", icon: Users },
];

const charterSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().min(1, "Description is required"),
  scope: z.string().min(1, "Scope is required"),
  deliverables: z.string().min(1, "Deliverables are required"),
  solutionComparison: z.string().optional(),
  tentativeBudget: z.coerce.number().min(0, "Must be positive"),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  durationDays: z.coerce.number().optional(),
  projectSponsorId: z.coerce.number().optional(),
  projectOwnerId: z.coerce.number().optional(),
  // Business benefits
  toplineImprovement: z.string().optional(),
  bottomLineOptimization: z.string().optional(),
  complianceBenefits: z.string().optional(),
  productivityImprovement: z.string().optional(),
});

type FormValues = z.infer<typeof charterSchema>;

function SectionCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div
      className="rounded-xl p-6"
      style={{ background: "white", border: "1px solid #E2E8F0", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}
    >
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

function BenefitCard({
  label,
  description,
  icon,
  color,
  children,
}: {
  label: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border p-5" style={{ borderColor: "#E2E8F0" }}>
      <div className="flex items-start gap-3 mb-3">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: color }}
        >
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
      description: "",
      scope: "",
      deliverables: "",
      solutionComparison: "",
      tentativeBudget: 0,
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
    createCharter.mutate(
      { data: { ...values, submittedById: userId } },
      {
        onSuccess: (charter) => {
          toast({ title: "Charter created successfully!" });
          setLocation(`/charters/${charter.id}`);
        },
        onError: () => {
          toast({ title: "Failed to create charter", variant: "destructive" });
        },
      }
    );
  }

  async function handleNext() {
    // Validate current step fields
    const stepFields: (keyof FormValues)[][] = [
      ["title", "description"],
      ["scope", "deliverables"],
      [], // benefits are optional
      ["tentativeBudget"],
    ];
    const valid = await form.trigger(stepFields[step] as (keyof FormValues)[]);
    if (valid) setStep(s => Math.min(s + 1, STEPS.length - 1));
  }

  return (
    <div className="max-w-3xl mx-auto">
      {/* Back */}
      <div className="mb-5">
        <Link href="/charters">
          <button className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors">
            <ChevronLeft size={15} />
            Back to Charters
          </button>
        </Link>
      </div>

      {/* Header */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">New Project Charter</h2>
        <p className="text-gray-500 text-sm mt-1">Fill in the details to initiate the approval workflow.</p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-0 mb-8">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          const isActive = i === step;
          const isDone = i < step;
          return (
            <div key={s.id} className="flex items-center flex-1">
              <button
                onClick={() => isDone && setStep(i)}
                className="flex items-center gap-2"
                disabled={!isDone}
              >
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
                <span
                  className={`text-xs font-medium hidden sm:block ${
                    isActive ? "text-indigo-600" : isDone ? "text-green-600" : "text-gray-400"
                  }`}
                >
                  {s.label}
                </span>
              </button>
              {i < STEPS.length - 1 && (
                <div
                  className="flex-1 h-0.5 mx-2"
                  style={{ background: i < step ? "#10B981" : "#E2E8F0" }}
                />
              )}
            </div>
          );
        })}
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          {/* Step 0: Basics */}
          {step === 0 && (
            <SectionCard title="Basic Information" subtitle="Project title, description and context">
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
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium text-gray-700">Description</FormLabel>
                    <FormControl>
                      <Textarea {...field} rows={4} placeholder="Provide a comprehensive overview of the project..." />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </SectionCard>
          )}

          {/* Step 1: Scope & Deliverables */}
          {step === 1 && (
            <div className="space-y-4">
              <SectionCard title="Project Scope" subtitle="Define what's included and excluded">
                <FormField
                  control={form.control}
                  name="scope"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium text-gray-700">Scope Statement</FormLabel>
                      <FormControl>
                        <Textarea {...field} rows={5} placeholder="Clearly define the boundaries and scope of this project..." />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </SectionCard>
              <SectionCard title="Deliverables" subtitle="What will be produced">
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
              <div
                className="rounded-xl p-4 mb-2"
                style={{ background: "linear-gradient(135deg, #EEF2FF, #F5F3FF)", border: "1px solid #C7D2FE" }}
              >
                <h3 className="font-semibold text-indigo-900 text-sm">Business Benefits Assessment</h3>
                <p className="text-xs text-indigo-600 mt-1">
                  Quantify and describe the expected business value across four dimensions. This helps justify investment during the approval process.
                </p>
              </div>

              <BenefitCard
                label="Topline Improvement"
                description="Revenue growth, new market opportunities, sales uplift"
                color="linear-gradient(135deg, #10B981, #059669)"
                icon={<TrendingUp size={16} className="text-white" />}
              >
                <FormField
                  control={form.control}
                  name="toplineImprovement"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Textarea
                          {...field}
                          rows={3}
                          placeholder="e.g. Expected 15% revenue increase through new digital channels, estimated $2M additional revenue in year 1..."
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </BenefitCard>

              <BenefitCard
                label="Bottom Line Optimization"
                description="Cost reduction, efficiency gains, operational savings"
                color="linear-gradient(135deg, #3B82F6, #1D4ED8)"
                icon={<svg className="text-white" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>}
              >
                <FormField
                  control={form.control}
                  name="bottomLineOptimization"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Textarea
                          {...field}
                          rows={3}
                          placeholder="e.g. Reduce operational costs by 20% through automation, saving $500K annually in manual processing..."
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </BenefitCard>

              <BenefitCard
                label="Compliance Benefits"
                description="Regulatory adherence, risk reduction, audit readiness"
                color="linear-gradient(135deg, #F59E0B, #D97706)"
                icon={<svg className="text-white" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>}
              >
                <FormField
                  control={form.control}
                  name="complianceBenefits"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Textarea
                          {...field}
                          rows={3}
                          placeholder="e.g. Achieve ISO 27001 certification, reduce regulatory penalty risk, improve audit scores..."
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </BenefitCard>

              <BenefitCard
                label="Productivity Improvement"
                description="Time savings, faster processes, better employee experience"
                color="linear-gradient(135deg, #8B5CF6, #7C3AED)"
                icon={<svg className="text-white" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>}
              >
                <FormField
                  control={form.control}
                  name="productivityImprovement"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Textarea
                          {...field}
                          rows={3}
                          placeholder="e.g. Reduce report generation time from 3 days to 2 hours, saving 50 man-hours per month across 8 departments..."
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </BenefitCard>
            </div>
          )}

          {/* Step 3: Team & Budget */}
          {step === 3 && (
            <div className="space-y-4">
              <SectionCard title="Budget & Timeline" subtitle="Financial and schedule parameters">
                <FormField
                  control={form.control}
                  name="tentativeBudget"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium text-gray-700">Tentative Budget (USD)</FormLabel>
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
                    name="startDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm font-medium text-gray-700">Start Date</FormLabel>
                        <FormControl>
                          <Input {...field} type="date" className="h-10" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="endDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm font-medium text-gray-700">End Date</FormLabel>
                        <FormControl>
                          <Input {...field} type="date" className="h-10" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </FieldRow>
                <FormField
                  control={form.control}
                  name="durationDays"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium text-gray-700">Duration (Days)</FormLabel>
                      <FormControl>
                        <Input {...field} type="number" min={0} placeholder="90" className="h-10" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </SectionCard>

              <SectionCard title="Project Team" subtitle="Key stakeholders and leadership">
                <FieldRow>
                  <FormField
                    control={form.control}
                    name="projectSponsorId"
                    render={({ field }) => (
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
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="projectOwnerId"
                    render={({ field }) => (
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
                    )}
                  />
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
                Create Charter
                <Check size={14} />
              </button>
            )}
          </div>
        </form>
      </Form>
    </div>
  );
}
