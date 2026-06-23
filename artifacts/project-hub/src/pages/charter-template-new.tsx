import { useState, useRef, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useUserStore } from "../lib/store";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useListUsers } from "@workspace/api-client-react";
import { FUNCTIONS_LIST } from "../lib/lifecycle-config";
import { useAiStatus } from "../components/ai-button";
import { RephraseField } from "@/components/ui-kit";
import { ReferenceDocUpload } from "../components/ReferenceDocUpload";
import { CustomFieldsEditor, type CustomField } from "../components/CustomFieldsEditor";
import { useFormDraft, clearFormDraft } from "../lib/useFormDraft";
import { ExpandingTextarea } from "../components/ExpandingTextarea";
import {
  ChevronLeft, Loader2, Plus, Trash2, FileText, Users, Target, TrendingUp,
  ShieldAlert, Coins, Table as TableIcon, ClipboardList, Sparkles, ListPlus,
  Download, X, ExternalLink, GripVertical,
} from "lucide-react";
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy,
  useSortable, arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// ── Single-page Project Charter + e-NFA form ───────────────────────────────
// Mirrors the corporate Project Charter template one-to-one. Persists to the
// merged pmo_charters table: core fields via POST /api/charters, the remaining
// template fields via PATCH /api/charters/:id (the api-server ExtendedCharterPatch
// schema accepts them). This is the single Charter+e-NFA entry surface (the
// legacy 9-step guided wizard was removed June 2026).

const SPONSORS = ["CMD", "ED", "CEO", "CFO", "COO", "CHRO"] as const;
const CATEGORIES = ["Compliance", "ROI", "Compliance + ROI"] as const;
const PM_TYPES = ["IT PM", "Business PM"] as const;

type Milestone = { milestone: string; responsible: string; targetDate: string };
type Kpi = { kpi: string; baseline: string; goal: string };
type Member = { name: string };
type VendorMatrix = { columns: string[]; rows: string[][] };

function Section({ title, subtitle, required, dense, children }: {
  title: string; subtitle?: string; icon?: React.ReactNode; required?: boolean; dense?: boolean; children: React.ReactNode;
}) {
  return (
    <div className={dense ? "py-1.5" : "py-2"}>
      <div className={`flex items-start gap-2 ${dense ? "mb-1.5" : "mb-2 gap-2.5"}`}>
        <div>
          <h3 className="text-sm font-semibold text-foreground tracking-tight leading-tight">
            {title}{required && <span className="text-destructive ml-0.5">*</span>}
            {dense && subtitle && <span className="text-muted-foreground font-normal ml-2 text-[11px]">{subtitle}</span>}
          </h3>
          {!dense && subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
      </div>
      <div className={dense ? "space-y-1.5" : "space-y-2"}>{children}</div>
    </div>
  );
}

function Field({ label, required, hint, children }: {
  label: string; required?: boolean; hint?: string; children: React.ReactNode;
}) {
  return (
    <div className="space-y-0.5">
      <label className="text-xs font-medium text-foreground">
        {label}{required && <span className="text-destructive ml-0.5">*</span>}
        {hint && <span className="text-muted-foreground font-normal ml-2 text-[11px]">{hint}</span>}
      </label>
      {children}
    </div>
  );
}

function Grid({ children, cols = 2 }: { children: React.ReactNode; cols?: number }) {
  const colClass = cols === 6 ? "sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6"
    : cols === 3 ? "md:grid-cols-3" : "md:grid-cols-2";
  return <div className={`grid gap-2 grid-cols-1 ${colClass}`}>{children}</div>;
}

// Canonical order of the reorderable step-2 narrative sections.
const DEFAULT_SECTION_ORDER = [
  "executiveSummary", "scope", "businessOutcome", "constraints",
  "deliverables", "benefits", "risks", "vendorMatrix", "additionalFields",
];

// Wraps a step-2 <Section> with a drag handle so the whole section can be reordered.
function SortableSection({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 20 : undefined,
    opacity: isDragging ? 0.85 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group flex items-start gap-1.5 rounded-lg ${isDragging ? "bg-card shadow-lg ring-1 ring-primary/40" : ""}`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        title="Drag to reorder section"
        aria-label="Drag to reorder section"
        className="mt-2.5 shrink-0 cursor-grab touch-none rounded p-1 text-muted-foreground/50 transition-colors hover:bg-accent hover:text-primary active:cursor-grabbing"
      >
        <GripVertical size={16} />
      </button>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

// Charter + e-NFA preview shown right after "Create Project Charter". Renders the
// generated .docx in-browser (docx-preview) and lets the user download it.
function CharterNfaPreview({ charterId, title, onClose, onOpenCharter }: {
  charterId: number;
  title: string;
  onClose: () => void;
  onOpenCharter: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [err, setErr] = useState("");
  const fileName = `${(title || "Project Charter").replace(/[^\w\s.-]/g, "").trim() || "Project Charter"} — NFA.docx`;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/charters/${charterId}/docx`);
        if (!res.ok) throw new Error(`Failed to generate (HTTP ${res.status})`);
        const blob = await res.blob();
        if (cancelled) return;
        const container = ref.current;
        if (!container) throw new Error("Preview container unavailable");
        container.innerHTML = "";
        const { renderAsync } = await import("docx-preview");
        if (cancelled) return;
        await renderAsync(blob, container, undefined, {
          className: "docx-preview", inWrapper: true, ignoreWidth: false, ignoreHeight: false, breakPages: true, useBase64URL: true,
        });
        if (!cancelled) setStatus("ready");
      } catch (e) {
        if (!cancelled) { setStatus("error"); setErr(e instanceof Error ? e.message : "Failed to render preview"); }
      }
    }
    const t = setTimeout(load, 0);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [charterId]);

  async function download() {
    try {
      const res = await fetch(`/api/charters/${charterId}/docx`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch { /* ignore — preview still visible */ }
  }

  return (
    <div className="fixed inset-0 z-[200] flex bg-black/50 backdrop-blur-sm p-4">
      <div className="m-auto w-[min(920px,94vw)] h-[90vh] bg-card rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-3 border-b border-border flex-shrink-0">
          <FileText size={16} className="text-primary" />
          <span className="text-sm font-semibold text-foreground truncate">Project Charter &amp; Note for Approval (NFA)</span>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={download} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm">
              <Download size={14} /> Download .docx
            </button>
            <button onClick={onOpenCharter} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold border border-border text-foreground hover:bg-accent transition-colors">
              <ExternalLink size={14} /> Open Charter
            </button>
            <button onClick={onClose} className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors" title="Close">
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-auto scrollbar-thin bg-muted/40">
          {status === "loading" && (
            <div className="h-full flex items-center justify-center gap-2 text-muted-foreground">
              <Loader2 size={18} className="animate-spin" /> <span className="text-sm">Generating preview…</span>
            </div>
          )}
          {status === "error" && (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-6">
              <FileText size={32} className="text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground max-w-md">{err}</p>
              <button onClick={download} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
                <Download size={14} /> Download .docx
              </button>
            </div>
          )}
          <div ref={ref} className={status === "ready" ? "flex justify-center py-4" : "hidden"} />
        </div>
      </div>
    </div>
  );
}

export default function NewCharterTemplate() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { userId } = useUserStore();
  const aiStatus = useAiStatus();
  const aiEnabled = !aiStatus || aiStatus.configured;
  const [saving, setSaving] = useState(false);
  const [drafting, setDrafting] = useState(false);
  // True once the AI draft has been generated — going back to step 1 and
  // continuing again must NOT re-draft (it would re-call the AI and refill
  // sections). The existing draft is preserved as-is.
  const [drafted, setDrafted] = useState(false);
  // Two-step flow: 1 = mandatory basics, 2 = AI-drafted narrative (editable +
  // per-field "Rephrase with AI"). Continue from step 1 auto-drafts step 2.
  const [step, setStep] = useState<1 | 2>(1);
  // Created charter id — opens the Charter+e-NFA preview overlay after submit.
  const [previewId, setPreviewId] = useState<number | null>(null);

  // Identification
  const [title, setTitle] = useState("");
  const [projectSponsor, setProjectSponsor] = useState("");
  const [department, setDepartment] = useState("");
  const [category, setCategory] = useState("");
  const [pmType, setPmType] = useState("");
  const [pmName, setPmName] = useState("");
  const [projectApprovalDate, setProjectApprovalDate] = useState("");
  const [lastRevisionDate, setLastRevisionDate] = useState("");
  const [members, setMembers] = useState<Member[]>([{ name: "" }]);
  const { data: usersData = [] } = useListUsers();
  // Member dropdown options = employee directory ∪ any names already chosen / AI-drafted
  // (so a loaded name not in the directory still shows as selected).
  const memberOptions = (() => {
    const names = (usersData as Array<{ name?: string }>).map(u => u.name).filter((n): n is string => !!n && n.trim().length > 0);
    return Array.from(new Set([...names, ...members.map(m => m.name).filter(n => n.trim().length > 0)]));
  })();

  // Mandatory project description (Basics step) — also seeds the charter
  // `description` payload. Has its own AI "Draft" + "Rephrase" actions.
  const [projectDescription, setProjectDescription] = useState("");
  const [descDrafting, setDescDrafting] = useState(false);

  // Optional reference document text — extracted from an uploaded source doc and
  // fed to the AI draft as `sourceText` so it can ground the narrative in real content.
  const [refText, setRefText] = useState("");

  // Narrative
  const [executiveSummary, setExecutiveSummary] = useState("");
  const [background, setBackground] = useState("");
  const [inScope, setInScope] = useState("");
  const [outOfScope, setOutOfScope] = useState("");
  const [businessOutcome, setBusinessOutcome] = useState("");

  // Constraints & budget
  const [constraints, setConstraints] = useState("");
  const [approvedBudget, setApprovedBudget] = useState("");
  const [leBudget, setLeBudget] = useState("");
  const [scopeLimitations, setScopeLimitations] = useState("");

  // Deliverables
  const [milestones, setMilestones] = useState<Milestone[]>([{ milestone: "", responsible: "", targetDate: "" }]);

  // Benefits
  const [kpis, setKpis] = useState<Kpi[]>([{ kpi: "", baseline: "", goal: "" }]);
  const [roiPerAnnum, setRoiPerAnnum] = useState("");

  // Risk / assumptions / additional budget
  const [risks, setRisks] = useState("");
  const [assumptions, setAssumptions] = useState("");
  const [potentialAdditionalBudget, setPotentialAdditionalBudget] = useState("");

  // User-defined extra fields (step 2) — add anywhere, drag to reorder.
  const [customFields, setCustomFields] = useState<CustomField[]>([]);

  // Author-arranged order of the step-2 narrative sections (drag to reorder).
  const [sectionOrder, setSectionOrder] = useState<string[]>([...DEFAULT_SECTION_ORDER]);

  // Vendor comparison matrix — fully flexible table
  const [vendor, setVendor] = useState<VendorMatrix>({
    columns: ["Criteria", "Vendor A", "Vendor B"],
    rows: [["", "", ""], ["", "", ""]],
  });

  // ── autosave the whole form to this device (survives reload / nav away) ───
  useFormDraft("pmo:charter-draft", {
    title, projectSponsor, department, category, pmType, pmName, projectApprovalDate,
    lastRevisionDate, members, projectDescription, refText, executiveSummary, background,
    inScope, outOfScope, businessOutcome, constraints, approvedBudget, leBudget,
    scopeLimitations, milestones, kpis, roiPerAnnum, risks, assumptions,
    potentialAdditionalBudget, customFields, vendor, sectionOrder,
    drafted,
  }, (s) => {
    if (s.title != null) setTitle(s.title);
    if (s.projectSponsor != null) setProjectSponsor(s.projectSponsor);
    if (s.department != null) setDepartment(s.department);
    if (s.category != null) setCategory(s.category);
    if (s.pmType != null) setPmType(s.pmType);
    if (s.pmName != null) setPmName(s.pmName);
    if (s.projectApprovalDate != null) setProjectApprovalDate(s.projectApprovalDate);
    if (s.lastRevisionDate != null) setLastRevisionDate(s.lastRevisionDate);
    if (s.members != null) setMembers(s.members);
    if (s.projectDescription != null) setProjectDescription(s.projectDescription);
    if (s.refText != null) setRefText(s.refText);
    if (s.executiveSummary != null) setExecutiveSummary(s.executiveSummary);
    if (s.background != null) setBackground(s.background);
    if (s.inScope != null) setInScope(s.inScope);
    if (s.outOfScope != null) setOutOfScope(s.outOfScope);
    if (s.businessOutcome != null) setBusinessOutcome(s.businessOutcome);
    if (s.constraints != null) setConstraints(s.constraints);
    if (s.approvedBudget != null) setApprovedBudget(s.approvedBudget);
    if (s.leBudget != null) setLeBudget(s.leBudget);
    if (s.scopeLimitations != null) setScopeLimitations(s.scopeLimitations);
    if (s.milestones != null) setMilestones(s.milestones);
    if (s.kpis != null) setKpis(s.kpis);
    if (s.roiPerAnnum != null) setRoiPerAnnum(s.roiPerAnnum);
    if (s.risks != null) setRisks(s.risks);
    if (s.assumptions != null) setAssumptions(s.assumptions);
    if (s.potentialAdditionalBudget != null) setPotentialAdditionalBudget(s.potentialAdditionalBudget);
    if (s.customFields != null) setCustomFields(s.customFields);
    if (s.vendor != null) setVendor(s.vendor);
    // Once an AI draft was done for these basics, don't regenerate it again.
    if (s.drafted != null) setDrafted(s.drafted);
    // Merge a saved order with the canonical list so new sections still appear.
    if (Array.isArray(s.sectionOrder)) {
      const saved = s.sectionOrder.filter((id: string) => DEFAULT_SECTION_ORDER.includes(id));
      setSectionOrder([...saved, ...DEFAULT_SECTION_ORDER.filter(id => !saved.includes(id))]);
    }
    // Once created (previewId set), stop autosaving so the cleared draft can't be
    // re-persisted from live state — reopening "Charter + e-NFA" starts blank.
  }, previewId === null);

  // ── dynamic-row helpers ──────────────────────────────────────────────────
  const addMilestone = () => setMilestones(m => [...m, { milestone: "", responsible: "", targetDate: "" }]);
  const addKpi = () => setKpis(k => [...k, { kpi: "", baseline: "", goal: "" }]);
  const addMember = () => setMembers(m => [...m, { name: "" }]);

  const addVendorColumn = () => setVendor(v => ({ columns: [...v.columns, `Vendor ${String.fromCharCode(65 + v.columns.length - 1)}`], rows: v.rows.map(r => [...r, ""]) }));
  const addVendorRow = () => setVendor(v => ({ ...v, rows: [...v.rows, v.columns.map(() => "")] }));
  const removeVendorColumn = (ci: number) => setVendor(v => v.columns.length <= 1 ? v : ({ columns: v.columns.filter((_, i) => i !== ci), rows: v.rows.map(r => r.filter((_, i) => i !== ci)) }));
  const removeVendorRow = (ri: number) => setVendor(v => ({ ...v, rows: v.rows.filter((_, i) => i !== ri) }));

  // ── section drag-to-reorder ──────────────────────────────────────────────
  const sectionSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onSectionDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (over && active.id !== over.id) {
      setSectionOrder(order => arrayMove(order, order.indexOf(String(active.id)), order.indexOf(String(over.id))));
    }
  };

  function pad(s: string, min: number, marker: string) {
    return s.trim().length >= min ? s : (s + " " + marker).padEnd(min, " ");
  }

  // ── Auto-fill the basics straight from an uploaded document / email ───────
  // Runs the moment a reference doc is attached: pulls whatever fields the
  // source actually states (incl. mandatory ones) and fills only the EMPTY
  // fields, so the user never retypes data the document already provides.
  async function autofillFromDoc(text: string) {
    if (!text || !text.trim()) return;
    try {
      const res = await fetch("/api/ai/charters/extract-fields", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceText: text }),
      });
      if (!res.ok) return;
      const d = (await res.json()) as Record<string, unknown>;
      let n = 0;
      const str = (v: unknown, cur: string, set: (s: string) => void) => {
        if (typeof v === "string" && v.trim() && !cur.trim()) { set(v.trim()); n++; }
      };
      const enumStr = (v: unknown, cur: string, allowed: readonly string[], set: (s: string) => void) => {
        if (typeof v === "string" && !cur.trim() && allowed.includes(v)) { set(v); n++; }
      };
      str(d.title, title, setTitle);
      enumStr(d.sponsor, projectSponsor, SPONSORS, setProjectSponsor);
      enumStr(d.function, department, FUNCTIONS_LIST, setDepartment);
      enumStr(d.category, category, CATEGORIES, setCategory);
      enumStr(d.pmType, pmType, PM_TYPES, setPmType);
      str(d.pmName, pmName, setPmName);
      str(d.approvedBudget, approvedBudget, setApprovedBudget);
      str(d.leBudget, leBudget, setLeBudget);
      str(d.projectDescription, projectDescription, setProjectDescription);
      if (Array.isArray(d.members) && d.members.length && members.every(m => !m.name.trim())) {
        const names = (d.members as unknown[]).filter((x): x is string => typeof x === "string" && x.trim().length > 0);
        if (names.length) { setMembers(names.map(x => ({ name: x.trim() }))); n++; }
      }
      if (n) toast({ title: `Auto-filled ${n} field${n > 1 ? "s" : ""} from your document`, description: "Review and adjust before continuing." });
    } catch { /* extraction is best-effort — the user can still type / draft */ }
  }

  // ── Draft just the Project Description with AI (Basics step) ──────────────
  async function draftDescription() {
    if (!title.trim()) { toast({ title: "Enter a Project Name first", description: "AI uses the name (plus sponsor/function/category if set) to draft the description.", variant: "destructive" }); return; }
    setDescDrafting(true);
    try {
      const res = await fetch("/api/ai/charters/draft-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          sponsor: projectSponsor || undefined,
          function: department || undefined,
          category: category || undefined,
          approvedBudget: Number(approvedBudget) || undefined,
          sourceText: refText || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.message || err?.error || `AI draft failed (${res.status})`);
      }
      const d = await res.json() as Record<string, unknown>;
      const text = [d.executiveSummary, d.background].filter((s) => typeof s === "string" && (s as string).trim()).join("\n\n").trim();
      if (!text) throw new Error("AI returned no description");
      setProjectDescription(text);
      toast({ title: "AI drafted the description", description: "Review and edit before continuing." });
    } catch (e) {
      toast({ title: (e as Error)?.message || "AI draft failed", variant: "destructive" });
    } finally {
      setDescDrafting(false);
    }
  }

  // ── Draft with AI — fills EMPTY fields only, never overwrites your input ───
  async function draftWithAi() {
    if (!title.trim()) { toast({ title: "Enter a Project Name first", description: "AI uses the name (plus sponsor/function/category if set) to draft the charter.", variant: "destructive" }); return; }
    setDrafting(true);
    try {
      const res = await fetch("/api/ai/charters/draft-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          sponsor: projectSponsor || undefined,
          function: department || undefined,
          category: category || undefined,
          approvedBudget: Number(approvedBudget) || undefined,
          sourceText: refText || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.message || err?.error || `AI draft failed (${res.status})`);
      }
      const d = await res.json() as Record<string, unknown>;
      const setIfEmpty = (cur: string, set: (v: string) => void, v?: unknown) => {
        if (!cur.trim() && typeof v === "string" && v.trim()) set(v);
      };
      setIfEmpty(executiveSummary, setExecutiveSummary, d.executiveSummary);
      setIfEmpty(background, setBackground, d.background);
      setIfEmpty(inScope, setInScope, d.inScope);
      setIfEmpty(outOfScope, setOutOfScope, d.outOfScope);
      setIfEmpty(businessOutcome, setBusinessOutcome, d.businessOutcome);
      setIfEmpty(constraints, setConstraints, d.constraints);
      setIfEmpty(scopeLimitations, setScopeLimitations, d.scopeLimitations);
      setIfEmpty(assumptions, setAssumptions, d.assumptions);
      setIfEmpty(risks, setRisks, d.risks);
      setIfEmpty(potentialAdditionalBudget, setPotentialAdditionalBudget, d.potentialAdditionalBudget);

      // Structured tables — only replace if the user hasn't started one (single blank row).
      const draftMs = Array.isArray(d.milestones) ? (d.milestones as Milestone[]) : [];
      if (draftMs.length && milestones.every(m => !m.milestone.trim())) {
        setMilestones(draftMs.map(m => ({ milestone: m.milestone ?? "", responsible: m.responsible ?? "", targetDate: m.targetDate ?? "" })));
      }
      const draftKpis = Array.isArray(d.kpis) ? (d.kpis as Kpi[]) : [];
      if (draftKpis.length && kpis.every(k => !k.kpi.trim())) {
        setKpis(draftKpis.map(k => ({ kpi: k.kpi ?? "", baseline: k.baseline ?? "", goal: k.goal ?? "" })));
      }
      setDrafted(true);
      toast({ title: "AI drafted the charter", description: "Empty fields were filled. Review and edit each section before submitting." });
    } catch (e) {
      toast({ title: (e as Error)?.message || "AI draft failed", variant: "destructive" });
    } finally {
      setDrafting(false);
    }
  }

  // Validate the step-1 mandatory basics, then (if AI is configured) auto-draft
  // the narrative sections before advancing to step 2.
  async function continueToDraft() {
    if (!title.trim()) { toast({ title: "Project Name is required", variant: "destructive" }); return; }
    if (!projectSponsor) { toast({ title: "Project Sponsor is required", variant: "destructive" }); return; }
    if (!category) { toast({ title: "Project Category is required", variant: "destructive" }); return; }
    if (!projectDescription.trim()) { toast({ title: "Project Description is required", description: "Write it, or use “Draft with AI”.", variant: "destructive" }); return; }
    if (!projectApprovalDate) { toast({ title: "Date of Project Approval is required", variant: "destructive" }); return; }
    if (aiEnabled && !drafted) { await draftWithAi(); }
    setStep(2);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function backToBasics() {
    setStep(1);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleSubmit() {
    if (!title.trim()) { toast({ title: "Project Name is required", variant: "destructive" }); return; }
    if (!projectSponsor) { toast({ title: "Project Sponsor is required", variant: "destructive" }); return; }
    if (!category) { toast({ title: "Project Category is required", variant: "destructive" }); return; }
    if (!projectDescription.trim()) { toast({ title: "Project Description is required", description: "Write it, or use “Draft with AI”.", variant: "destructive" }); return; }
    if (!projectApprovalDate) { toast({ title: "Date of Project Approval is required", variant: "destructive" }); return; }

    setSaving(true);
    try {
      // Compose the server-validated core long fields (description ≥100, scope ≥50).
      const descriptionRaw = [projectDescription, executiveSummary, background, businessOutcome].filter(Boolean).join("\n\n");
      const description = pad(descriptionRaw || `${title} — Project Charter.`, 100, "[charter summary]");
      const scope = pad(inScope || "In scope to be detailed.", 50, "[in-scope]");
      const deliverables = milestones.filter(m => m.milestone.trim())
        .map(m => `• ${m.milestone}${m.responsible ? ` — ${m.responsible}` : ""}${m.targetDate ? ` (${m.targetDate})` : ""}`)
        .join("\n") || "To be defined.";

      const createRes = await fetch("/api/charters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description,
          scope,
          deliverables,
          tentativeBudget: Number(approvedBudget) || 0,
          submittedById: userId,
          strategicAlignmentTags: [`FUNCTION:${department || "General"}`],
        }),
      });
      if (!createRes.ok) {
        const err = await createRes.json().catch(() => ({}));
        throw new Error(err?.error || `Create failed (${createRes.status})`);
      }
      const charter = await createRes.json();
      const id = charter.id;

      // PATCH the remaining template fields.
      const extended: Record<string, unknown> = {
        executiveSummary,
        background,
        outOfScope,
        constraints,
        assumptions,
        potentialAdditionalBudget,
        category,
        department,
        leAmount: Number(leBudget) || undefined,
        roiPerAnnum: Number(roiPerAnnum) || undefined,
        milestones: milestones.filter(m => m.milestone.trim()).map(m => ({ milestone: m.milestone, responsible: m.responsible, targetDate: m.targetDate, status: "pending" })),
        kpis: kpis.filter(k => k.kpi.trim()),
        keyProjectMembers: members.filter(m => m.name.trim()).map(m => ({ role: "Member", name: m.name })),
        // new template columns
        projectSponsor,
        pmType,
        pmName,
        projectApprovalDate,
        lastRevisionDate,
        businessOutcome,
        scopeLimitations,
        risks,
        vendorMatrix: vendor,
        customFields: customFields.filter(f => f.label.trim() || f.value.trim()),
        sectionOrder,
      };
      for (const k of Object.keys(extended)) {
        const v = extended[k];
        if (v == null || v === "" || (Array.isArray(v) && v.length === 0)) delete extended[k];
      }
      if (Object.keys(extended).length > 0) {
        await fetch(`/api/charters/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(extended),
        }).catch(() => {
          toast({ title: "Saved core fields — some template fields may not have persisted.", variant: "destructive" });
        });
      }

      // Float a draft RFP for vendor selection — generated from this charter's
      // own data, mapped into the RFP's native format (title · one-line summary ·
      // structured brief). Vendors' later submissions fill the Comparison Matrix.
      try {
        const rfpBrief = [
          background.trim() && `Background\n${background.trim()}`,
          inScope.trim() && `Scope of Work\n${inScope.trim()}`,
          outOfScope.trim() && `Out of Scope\n${outOfScope.trim()}`,
          deliverables && deliverables !== "To be defined." && `Key Deliverables\n${deliverables}`,
          constraints.trim() && `Constraints\n${constraints.trim()}`,
        ].filter(Boolean).join("\n\n");
        const rfpSummary = (executiveSummary.trim().split("\n")[0] || businessOutcome.trim().split("\n")[0] || `Vendor selection for ${title.trim()}`).slice(0, 240);
        const rfpRes = await fetch("/api/rfx", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            // Same fields a manually-created RFP carries (rfx-new form parity)
            // so it's a complete, floatable RFP.
            type: "rfp",
            title: title.trim(),
            summary: rfpSummary,
            brief: rfpBrief || undefined,
            currency: "INR",
            closesAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            blindGrading: true,
            surrogateBiddingAllowed: true,
            alternativeBidsAllowed: false,
            charterId: id,
          }),
        });
        if (rfpRes.ok) toast({ title: "RFP generated", description: "A draft RFP was placed in the RFP section." });
      } catch { /* charter is saved regardless — RFP is best-effort */ }

      const pcId = charter.pcId ?? `PC-${new Date().getFullYear()}-${String(id).padStart(5, "0")}`;
      clearFormDraft("pmo:charter-draft");
      toast({ title: `Project Charter created — ${pcId}` });
      // Show the Charter+e-NFA preview overlay (download from there); the user
      // can then open the full charter page.
      setPreviewId(id);
    } catch (e) {
      toast({ title: (e as Error)?.message || "Failed to create Project Charter", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="w-full pb-4 [&_input]:shadow-none [&_input]:rounded-md [&_input]:border [&_input]:border-slate-200 [&_input]:bg-white [&_textarea]:shadow-none [&_textarea]:rounded-md [&_textarea]:border [&_textarea]:border-slate-200 [&_textarea]:bg-white [&_[role=combobox]]:rounded-md [&_[role=combobox]]:bg-white [&_[role=combobox]]:border [&_[role=combobox]]:border-slate-200 [&_[role=combobox]]:font-normal [&_[role=combobox]]:shadow-none [&_[role=combobox]:focus]:ring-0 [&_input:focus]:border-blue-300 [&_input:focus-visible]:border-blue-300 [&_input:focus-visible]:ring-blue-200 [&_textarea:focus]:border-blue-300 [&_textarea:focus]:outline-none [&_textarea:focus]:ring-1 [&_textarea:focus]:ring-blue-200 [&_[role=combobox]:focus]:border-blue-300">
      <div className="mb-1">
        <Link href="/">
          <button className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ChevronLeft size={15} /> Back to Dashboard
          </button>
        </Link>
      </div>

      {/* Title + step indicator on one row */}
      <div className="flex items-start justify-between gap-4 mb-1.5">
        <div>
          <h2 className="text-lg font-bold text-foreground tracking-tight">Project Charter · e-NFA <span className="text-sm font-normal text-muted-foreground">— complete the charter to initiate the approval workflow</span></h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">Your progress autosaves on this device — you can safely leave and come back.</p>
        </div>
        <div className="flex items-center gap-2 text-xs font-semibold flex-shrink-0">
        <span className={`inline-flex items-center gap-1.5 px-3 h-7 rounded-full ${step === 1 ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary"}`}>
          <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-white/25 text-[10px]">1</span> Basics
        </span>
        <span className="h-px w-6 bg-border" />
        <span className={`inline-flex items-center gap-1.5 px-3 h-7 rounded-full ${step === 2 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
          <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-white/25 text-[10px]">2</span> AI Charter Narrative
        </span>
        </div>
      </div>

      <div className="relative rounded-lg border border-slate-200 bg-slate-200 p-4 sm:p-5">
      <div className="absolute top-3 right-3 z-10">
        <ReferenceDocUpload onText={(t) => { setRefText(t); autofillFromDoc(t); }} />
      </div>
      {step === 1 ? (
        <div className="space-y-2.5">
          {/* ── Identification ─────────────────────────────────────────────── */}
          <Section title="Project Identification" icon={<ClipboardList size={18} />}>
            <Field label="Project Name" required>
              <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. ERP System Upgrade 2026" className="h-8" />
            </Field>
            <div className="grid gap-2 grid-cols-2 sm:grid-cols-4 lg:grid-cols-7">
              <Field label="Project Sponsor" required>
                <Select value={projectSponsor} onValueChange={setProjectSponsor}>
                  <SelectTrigger className="h-8"><SelectValue placeholder="Sponsor" /></SelectTrigger>
                  <SelectContent>{SPONSORS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Function / Dept">
                <Select value={department} onValueChange={setDepartment}>
                  <SelectTrigger className="h-8"><SelectValue placeholder="Function" /></SelectTrigger>
                  <SelectContent>{FUNCTIONS_LIST.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Category" required>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger className="h-8"><SelectValue placeholder="Category" /></SelectTrigger>
                  <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Type">
                <Select value={pmType} onValueChange={setPmType}>
                  <SelectTrigger className="h-8"><SelectValue placeholder="Type" /></SelectTrigger>
                  <SelectContent>{PM_TYPES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Project Manager">
                <Input value={pmName} onChange={e => setPmName(e.target.value)} placeholder="Name" className="h-8" />
              </Field>
              <Field label="Approval Date" required>
                <Input type="date" value={projectApprovalDate} onChange={e => setProjectApprovalDate(e.target.value)} className="h-8 px-2" />
              </Field>
              <Field label="Last Revision">
                <Input type="date" value={lastRevisionDate} onChange={e => setLastRevisionDate(e.target.value)} className="h-8 px-2" />
              </Field>
            </div>
            <RephraseField
              label="Project Description"
              required
              value={projectDescription}
              onChange={setProjectDescription}
              rows={1}
              expandOnFocus
              textareaClassName=""
              aiEnabled={aiEnabled}
              onDraft={draftDescription}
              drafting={descDrafting}
              context="the 'Project Description' of a Project Charter"
              placeholder="What the project is, the problem it solves, and the value it delivers… or use “Draft with AI”."
            />
          </Section>

          {/* ── Key Project Members + Budget (side by side) ───────────────── */}
          <div className="grid gap-2.5 grid-cols-2 items-start">
            <Section dense title="Key Project Members" subtitle="Core project team" icon={<Users size={16} />}>
              <label className="text-xs font-medium text-foreground">Member name</label>
              <div className="space-y-1.5">
                {members.map((m, i) => (
                  <div key={i} className="flex gap-2">
                    <Select value={m.name || undefined} onValueChange={val => setMembers(arr => arr.map((x, j) => j === i ? { name: val } : x))}>
                      <SelectTrigger className="h-9 flex-1"><SelectValue placeholder="Select member…" /></SelectTrigger>
                      <SelectContent>
                        {memberOptions.map(name => <SelectItem key={name} value={name}>{name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {members.length > 1 && (
                      <button type="button" onClick={() => setMembers(arr => arr.filter((_, j) => j !== i))} className="w-9 h-9 rounded-md flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"><Trash2 size={14} /></button>
                    )}
                  </div>
                ))}
              </div>
              <button type="button" onClick={addMember} className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary/80"><Plus size={13} /> Add member</button>
            </Section>

            {/* ── Budget envelope (drives the AI draft + DOA routing) ───────── */}
            <Section dense title="Budget" icon={<Coins size={16} />}>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Approved Budget" hint="₹">
                  <ExpandingTextarea value={approvedBudget} onChange={setApprovedBudget} placeholder="e.g. ₹50,00,000 — capex + opex, phased over FY26" className="text-sm px-3 py-1 leading-tight placeholder:text-xs" minPx={36} />
                </Field>
                <Field label="LE Budget" hint="Latest Estimate, ₹">
                  <ExpandingTextarea value={leBudget} onChange={setLeBudget} placeholder="e.g. ₹48,00,000 — latest estimate at completion" className="text-sm px-3 py-1 leading-tight placeholder:text-xs" minPx={36} />
                </Field>
              </div>
            </Section>
          </div>

          {/* ── Step 1 footer ─────────────────────────────────────────────── */}
          <div className="flex items-center justify-between gap-3 pt-2">
            <Link href="/"><button type="button" className="px-4 h-8 rounded-md text-sm font-semibold text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">Cancel</button></Link>
            <button type="button" disabled={drafting} onClick={continueToDraft} className="flex items-center gap-2 px-5 h-8 rounded-md text-sm font-semibold bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed">
              {drafting ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
              {drafting ? "Generating AI draft…" : (aiEnabled && !drafted) ? "Continue — Generate AI Draft" : "Continue"}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {aiEnabled && (
            <div className="rounded-2xl border border-primary/30 bg-primary/5 px-4 py-3 flex items-start gap-2.5">
              <Sparkles size={16} className="text-primary flex-shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground">
                AI has drafted the narrative sections from your basics. Edit any field freely, then use
                <span className="font-semibold text-primary"> Rephrase with AI</span> to polish it. Numbers, dates and facts you enter are preserved.
              </p>
            </div>
          )}
          {/* ── Reorderable narrative sections — drag the grip to reorder. ── */}
          <p className="text-[11px] text-muted-foreground -mb-1 pl-5">Drag the <GripVertical size={11} className="inline -mt-0.5" /> handle to reorder sections — the order is saved and used in the generated document.</p>
          {(() => {
            const sectionNodes: Record<string, React.ReactNode> = {
              executiveSummary: (
                <Section title="Executive Summary" icon={<FileText size={18} />}>
                  <RephraseField label="Executive Summary" value={executiveSummary} onChange={setExecutiveSummary} rows={4} aiEnabled={aiEnabled} context="the 'Executive Summary' of a Project Charter" placeholder="A concise summary of the initiative — what it is, why now, and the headline value..." />
                  <RephraseField label="Background" value={background} onChange={setBackground} rows={4} aiEnabled={aiEnabled} context="the 'Background' section of a Project Charter" placeholder="The history and context that led to this initiative..." />
                </Section>
              ),
              scope: (
                <Section title="Scope" icon={<Target size={18} />}>
                  <RephraseField label="In Scope" value={inScope} onChange={setInScope} rows={3} aiEnabled={aiEnabled} context="the 'In Scope' section of a Project Charter" placeholder="What this project will deliver / cover..." />
                  <RephraseField label="Out of Scope" value={outOfScope} onChange={setOutOfScope} rows={3} aiEnabled={aiEnabled} context="the 'Out of Scope' section of a Project Charter" placeholder="What is explicitly excluded..." />
                </Section>
              ),
              businessOutcome: (
                <Section title="Business Outcome" icon={<TrendingUp size={18} />}>
                  <RephraseField label="Business Outcome" value={businessOutcome} onChange={setBusinessOutcome} rows={3} aiEnabled={aiEnabled} context="the 'Business Outcome' section of a Project Charter" placeholder="The expected business outcome of this project..." />
                </Section>
              ),
              constraints: (
                <Section title="Constraints" subtitle="Scope limitations and other constraints" icon={<Coins size={18} />}>
                  <RephraseField label="Scope Limitations" value={scopeLimitations} onChange={setScopeLimitations} rows={2} aiEnabled={aiEnabled} context="the 'Scope Limitations' of a Project Charter" placeholder="Known limitations on scope..." />
                  <RephraseField label="Other Constraints" value={constraints} onChange={setConstraints} rows={2} aiEnabled={aiEnabled} context="the 'Constraints' section of a Project Charter" placeholder="Time, resourcing, technical, regulatory constraints..." />
                </Section>
              ),
              deliverables: (
                <Section title="Project Deliverables" subtitle="Key milestones, owners and target dates" icon={<ClipboardList size={18} />}>
                  <div className="space-y-2">
                    <div className="hidden md:grid grid-cols-[1fr_180px_150px_40px] gap-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      <span>Key Milestone</span><span>Responsible</span><span>Target Date</span><span />
                    </div>
                    {milestones.map((m, i) => (
                      <div key={i} className="grid grid-cols-1 md:grid-cols-[1fr_180px_150px_40px] gap-2">
                        <Input value={m.milestone} onChange={e => setMilestones(arr => arr.map((x, j) => j === i ? { ...x, milestone: e.target.value } : x))} placeholder="Milestone" className="h-8" />
                        <Input value={m.responsible} onChange={e => setMilestones(arr => arr.map((x, j) => j === i ? { ...x, responsible: e.target.value } : x))} placeholder="Responsible" className="h-8" />
                        <Input type="date" value={m.targetDate} onChange={e => setMilestones(arr => arr.map((x, j) => j === i ? { ...x, targetDate: e.target.value } : x))} className="h-8" />
                        {milestones.length > 1
                          ? <button type="button" onClick={() => setMilestones(arr => arr.filter((_, j) => j !== i))} className="w-10 h-8 rounded-md flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"><Trash2 size={15} /></button>
                          : <span />}
                      </div>
                    ))}
                  </div>
                  <button type="button" onClick={addMilestone} className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary/80"><Plus size={13} /> Add milestone</button>
                </Section>
              ),
              benefits: (
                <Section title="Benefits" subtitle="Topline improvement, bottom-line optimization, compliance benefits & productivity improvement" icon={<TrendingUp size={18} />}>
                  <div className="space-y-2">
                    <div className="hidden md:grid grid-cols-[1fr_1fr_1fr_40px] gap-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      <span>KPI</span><span>Base Line</span><span>Goal</span><span />
                    </div>
                    {kpis.map((k, i) => (
                      <div key={i} className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_40px] gap-2">
                        <Input value={k.kpi} onChange={e => setKpis(arr => arr.map((x, j) => j === i ? { ...x, kpi: e.target.value } : x))} placeholder="KPI" className="h-8" />
                        <Input value={k.baseline} onChange={e => setKpis(arr => arr.map((x, j) => j === i ? { ...x, baseline: e.target.value } : x))} placeholder="Baseline" className="h-8" />
                        <Input value={k.goal} onChange={e => setKpis(arr => arr.map((x, j) => j === i ? { ...x, goal: e.target.value } : x))} placeholder="Goal" className="h-8" />
                        {kpis.length > 1
                          ? <button type="button" onClick={() => setKpis(arr => arr.filter((_, j) => j !== i))} className="w-10 h-8 rounded-md flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"><Trash2 size={15} /></button>
                          : <span />}
                      </div>
                    ))}
                  </div>
                  <button type="button" onClick={addKpi} className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary/80"><Plus size={13} /> Add KPI</button>
                  <Field label="ROI / Annum" hint="₹ per year">
                    <Input type="number" value={roiPerAnnum} onChange={e => setRoiPerAnnum(e.target.value)} placeholder="0" className="h-8 md:max-w-xs" />
                  </Field>
                </Section>
              ),
              risks: (
                <Section title="Risks, Assumptions & Additional Budget" icon={<ShieldAlert size={18} />}>
                  <RephraseField label="Risks" value={risks} onChange={setRisks} rows={3} aiEnabled={aiEnabled} context="the 'Risks' section of a Project Charter" placeholder="Key risks and mitigations..." />
                  <RephraseField label="Assumptions" value={assumptions} onChange={setAssumptions} rows={3} aiEnabled={aiEnabled} context="the 'Assumptions' section of a Project Charter" placeholder="Assumptions underpinning the plan..." />
                  <RephraseField label="Potential Additional Budget Areas" value={potentialAdditionalBudget} onChange={setPotentialAdditionalBudget} rows={2} aiEnabled={aiEnabled} context="the 'Potential Additional Budget' section of a Project Charter" placeholder="Areas that may need additional budget later..." />
                </Section>
              ),
              vendorMatrix: (
                <Section title="Vendor Comparison Matrix" subtitle="Add columns and rows as desired" icon={<TableIcon size={18} />}>
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr>
                          {vendor.columns.map((c, ci) => (
                            <th key={ci} className="p-1 min-w-[140px]">
                              <div className="flex items-center gap-1">
                                <Input value={c} onChange={e => setVendor(v => ({ ...v, columns: v.columns.map((x, j) => j === ci ? e.target.value : x) }))} className="h-8 font-semibold" />
                                {vendor.columns.length > 1 && (
                                  <button type="button" onClick={() => removeVendorColumn(ci)} title="Remove column" className="text-muted-foreground hover:text-destructive shrink-0"><Trash2 size={13} /></button>
                                )}
                              </div>
                            </th>
                          ))}
                          <th className="w-10" />
                        </tr>
                      </thead>
                      <tbody>
                        {vendor.rows.map((row, ri) => (
                          <tr key={ri}>
                            {row.map((cell, ci) => (
                              <td key={ci} className="p-1">
                                <Input value={cell} onChange={e => setVendor(v => ({ ...v, rows: v.rows.map((r, j) => j === ri ? r.map((x, k) => k === ci ? e.target.value : x) : r) }))} className="h-8" />
                              </td>
                            ))}
                            <td className="p-1">
                              <button type="button" onClick={() => removeVendorRow(ri)} title="Remove row" className="w-9 h-8 rounded-md flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10"><Trash2 size={14} /></button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex gap-4">
                    <button type="button" onClick={addVendorRow} className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary/80"><Plus size={13} /> Add row</button>
                    <button type="button" onClick={addVendorColumn} className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary/80"><Plus size={13} /> Add column</button>
                  </div>
                </Section>
              ),
              additionalFields: (
                <Section title="Additional Fields" subtitle="Add your own sections anywhere — drag the handle to reorder" icon={<ListPlus size={18} />}>
                  <CustomFieldsEditor fields={customFields} onChange={setCustomFields} />
                </Section>
              ),
            };
            return (
              <DndContext sensors={sectionSensors} collisionDetection={closestCenter} onDragEnd={onSectionDragEnd}>
                <SortableContext items={sectionOrder} strategy={verticalListSortingStrategy}>
                  {sectionOrder.map(id => sectionNodes[id]
                    ? <SortableSection key={id} id={id}>{sectionNodes[id]}</SortableSection>
                    : null)}
                </SortableContext>
              </DndContext>
            );
          })()}

          {/* ── Step 2 footer ─────────────────────────────────────────────── */}
          <div className="flex items-center justify-between gap-3 pt-2">
            <button type="button" onClick={backToBasics} className="flex items-center gap-1.5 px-4 h-8 rounded-md text-sm font-semibold text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
              <ChevronLeft size={15} /> Back to basics
            </button>
            <button type="button" disabled={saving} onClick={handleSubmit} className="flex items-center gap-2 px-5 h-8 rounded-md text-sm font-semibold bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed">
              {saving ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />}
              {saving ? "Creating…" : "Create Project Charter"}
            </button>
          </div>
        </div>
      )}
      </div>

      {previewId != null && (
        <CharterNfaPreview
          charterId={previewId}
          title={title}
          onClose={() => setLocation(`/charters/${previewId}`)}
          onOpenCharter={() => setLocation(`/charters/${previewId}`)}
        />
      )}
    </div>
  );
}
