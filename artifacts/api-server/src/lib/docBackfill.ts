// ---------------------------------------------------------------------------
// Document-driven stage backfill.
//
// Pipeline (invoked after a document upload, or on demand via the ai route):
//   1. For each doc whose AI cache is stale (summaryVersion !== version):
//        - Pull plain text via extractDocText
//        - LLM classifies → stage, canonical requiredDocName, summary,
//          which blocking checklist ids this doc satisfies, optional charter
//          field extraction.
//        - Persist: documentsTable.stage, .name (canonicalised), .summary,
//          .summaryVersion. Optionally merge charter extracts into the
//          project's charter.
//        - Tick the classifier's checklist ids on the target stage record.
//   2. Walk applicableStages() in order — for each stage whose gate is now
//      satisfied (per evaluateStageGate), mark `complete` and activate the
//      next stage on the project's path. Mirrors the manual /advance endpoint
//      but bypasses the role check (AI-driven advancement is logged in the
//      activity feed for audit).
// ---------------------------------------------------------------------------

import {
  db,
  documentsTable,
  projectStagesTable,
  projectsTable,
  chartersTable,
  type Document,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { llm, isLLMConfigured } from "@workspace/llm";
import { extractDocText, MAX_DOC_TEXT_CHARS } from "./liveCharter";
import {
  STAGE_GATES,
  STAGE_META,
  STAGE_SUBGATES,
  applicableStages,
  evaluateStageGate,
  nextStageFor,
} from "./stage-gates";
import { logActivity } from "../routes/activity";

// ---------------------------------------------------------------------------
// LLM classification schema
// ---------------------------------------------------------------------------

const charterExtractSchema = z.object({
  description: z.string().nullable().optional(),
  scope: z.string().nullable().optional(),
  deliverables: z.string().nullable().optional(),
  executiveSummary: z.string().nullable().optional(),
  currentState: z.string().nullable().optional(),
  businessDrivers: z.string().nullable().optional(),
  outOfScope: z.string().nullable().optional(),
  constraints: z.string().nullable().optional(),
  assumptions: z.string().nullable().optional(),
  toplineImprovement: z.string().nullable().optional(),
  bottomLineOptimization: z.string().nullable().optional(),
  complianceBenefits: z.string().nullable().optional(),
  productivityImprovement: z.string().nullable().optional(),
  tentativeBudget: z.number().nullable().optional(),
  capexAmount: z.number().nullable().optional(),
  opexAmount: z.number().nullable().optional(),
});

const classificationSchema = z.object({
  stage: z.string().nullable(),
  canonicalDocName: z.string().nullable(),
  summary: z.string(),
  checklistTicks: z.array(z.string()).default([]),
  approvalFlags: z.array(z.string()).default([]),
  charterFields: charterExtractSchema.nullable().optional(),
});

type Classification = z.infer<typeof classificationSchema>;

// ---------------------------------------------------------------------------
// Build the classifier prompt — sends the full stage/doc/checklist menu so the
// model has the exact vocabulary to choose from.
// ---------------------------------------------------------------------------

function buildClassifierMenu(stages: string[]): string {
  return stages
    .map((key) => {
      const gate = STAGE_GATES[key];
      const meta = STAGE_META[key];
      if (!gate || !meta) return "";
      const subgates = STAGE_SUBGATES[key];
      const docs = gate.requiredDocNames.length
        ? `\n  requiredDocs: ${gate.requiredDocNames.map((n) => `"${n}"`).join(", ")}`
        : "";
      const checklist = gate.blockingChecklistIds.length
        ? `\n  blockingChecklist: ${gate.blockingChecklistIds.map((id) => `"${id}"`).join(", ")}`
        : "";
      const approvalFlags = subgates?.length
        ? `\n  approvalFlags: ${subgates
            .flatMap((s) => s.approvalFlags.map((f) => `"${f.flag}"`))
            .join(", ")}`
        : "";
      return `- "${key}" (${meta.label})${docs}${checklist}${approvalFlags}`;
    })
    .filter(Boolean)
    .join("\n");
}

// ---------------------------------------------------------------------------
// Public entry point.
// ---------------------------------------------------------------------------

export type BackfillResult = {
  ok: boolean;
  reason?: string;
  classifiedDocs: number;
  ticksApplied: number;
  charterUpdated: boolean;
  stagesAdvanced: string[];
  finalStage: string | null;
};

export async function backfillFromDocs(
  projectId: number,
  options: { force?: boolean } = {},
): Promise<BackfillResult> {
  const result: BackfillResult = {
    ok: true,
    classifiedDocs: 0,
    ticksApplied: 0,
    charterUpdated: false,
    stagesAdvanced: [],
    finalStage: null,
  };

  if (!isLLMConfigured()) {
    return { ...result, ok: false, reason: "no_api_key" };
  }

  const [project] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId));
  if (!project) return { ...result, ok: false, reason: "project_not_found" };
  if (project.status === "closed") {
    return { ...result, ok: false, reason: "project_closed" };
  }

  result.finalStage = project.stage ?? null;

  const stages = applicableStages(project.projectType);
  const menu = buildClassifierMenu(stages);

  // -- 1. Classify each not-yet-cached document. ----------------------------
  const docs = await db
    .select()
    .from(documentsTable)
    .where(eq(documentsTable.projectId, projectId));

  // checklist tick aggregator keyed by stage → set of item ids to flip true
  const stageTicks: Record<string, Set<string>> = {};
  const stageFlags: Record<string, Set<string>> = {};
  const charterAccum: Record<string, string | number> = {};

  for (const doc of docs) {
    const cached =
      !options.force &&
      doc.summary != null &&
      doc.summaryVersion === doc.version;
    if (cached) continue;

    const text = await extractDocText(doc);
    if (!text || text.trim().length < 50) continue;

    const classification = await classifyDoc(doc, text, menu);
    if (!classification) continue;

    result.classifiedDocs += 1;
    const targetStage =
      classification.stage && STAGE_GATES[classification.stage]
        ? classification.stage
        : doc.stage ?? null;

    // Canonicalise the document name when the classifier produced a match
    // against the stage's requiredDocNames vocabulary — this is what
    // evaluateStageGate matches on, so an "RFP_v3.pdf" upload becomes
    // "RFP Document" so the gate can resolve.
    const canonicalName =
      classification.canonicalDocName &&
      targetStage &&
      STAGE_GATES[targetStage].requiredDocNames.includes(classification.canonicalDocName)
        ? classification.canonicalDocName
        : doc.name;

    await db
      .update(documentsTable)
      .set({
        stage: targetStage ?? doc.stage ?? null,
        name: canonicalName,
        summary: classification.summary,
        summaryVersion: doc.version,
        summaryGeneratedAt: new Date(),
      })
      .where(eq(documentsTable.id, doc.id));

    // Accumulate stage-level signals.
    if (targetStage) {
      const gate = STAGE_GATES[targetStage];
      const validTicks = classification.checklistTicks.filter((id) =>
        gate.blockingChecklistIds.includes(id),
      );
      if (validTicks.length) {
        (stageTicks[targetStage] ??= new Set<string>());
        validTicks.forEach((id) => stageTicks[targetStage].add(id));
      }

      const validFlags = classification.approvalFlags.filter((flag) =>
        (STAGE_SUBGATES[targetStage] ?? [])
          .flatMap((s) => s.approvalFlags.map((f) => f.flag))
          .includes(flag),
      );
      if (validFlags.length) {
        (stageFlags[targetStage] ??= new Set<string>());
        validFlags.forEach((flag) => stageFlags[targetStage].add(flag));
      }
    }

    // Accumulate charter field extracts — last writer wins per field, but
    // longer prose tends to be the more comprehensive doc (Charter PDF over
    // a 1-pager).
    if (classification.charterFields) {
      for (const [k, v] of Object.entries(classification.charterFields)) {
        if (v == null || v === "") continue;
        const prior = charterAccum[k];
        if (
          prior == null ||
          (typeof v === "string" &&
            typeof prior === "string" &&
            v.length > prior.length)
        ) {
          charterAccum[k] = v as string | number;
        }
      }
    }
  }

  // -- 2. Persist accumulated checklist ticks + approval flags. -------------
  for (const [stage, ticks] of Object.entries(stageTicks)) {
    const applied = await mergeStageNotes(projectId, stage, {
      ticks: [...ticks],
      flags: [...(stageFlags[stage] ?? [])],
    });
    result.ticksApplied += applied;
  }
  // Stages that had only flags (no ticks) still need a write pass.
  for (const [stage, flags] of Object.entries(stageFlags)) {
    if (stageTicks[stage]) continue;
    await mergeStageNotes(projectId, stage, { ticks: [], flags: [...flags] });
  }

  // -- 3. Merge charter extracts into the project's charter (if any). -------
  if (project.charterId && Object.keys(charterAccum).length > 0) {
    result.charterUpdated = await mergeCharterFields(
      project.charterId,
      charterAccum,
    );
  }

  // -- 4. Auto-advance stages whose gates are now satisfied. ----------------
  let currentStage = project.stage;
  for (const stage of stages) {
    const idxCurrent = currentStage ? stages.indexOf(currentStage) : -1;
    const idxCandidate = stages.indexOf(stage);
    // Only advance stages at or before the current active stage (we move
    // FORWARD from currentStage; earlier stages should already be complete).
    if (idxCandidate < idxCurrent) continue;

    // Ensure the stage record exists (newly created projects may only have
    // the initiation record).
    await ensureStageRecord(projectId, stage);

    const ev = await evaluateStageGate(projectId, stage, project.projectType);
    if (!ev.satisfied) break; // first unsatisfied gate halts the chain

    await db
      .update(projectStagesTable)
      .set({ status: "complete", completedAt: new Date() })
      .where(
        and(
          eq(projectStagesTable.projectId, projectId),
          eq(projectStagesTable.stage, stage),
        ),
      );

    const next = nextStageFor(stage, project.projectType);
    if (next) {
      await ensureStageRecord(projectId, next, "in_progress");
      await db
        .update(projectsTable)
        .set({ stage: next, updatedAt: new Date() })
        .where(eq(projectsTable.id, projectId));
      currentStage = next;
      result.finalStage = next;
    } else {
      await db
        .update(projectsTable)
        .set({ status: "closed", updatedAt: new Date() })
        .where(eq(projectsTable.id, projectId));
      result.finalStage = stage;
    }

    result.stagesAdvanced.push(stage);
    await logActivity(
      "stage_advanced_by_ai",
      `AI auto-advanced from "${stage}" to "${next ?? "(final)"}" after document backfill`,
      projectId,
      "project",
    );
  }

  return result;
}

// ---------------------------------------------------------------------------
// Per-doc LLM classification.
// ---------------------------------------------------------------------------

async function classifyDoc(
  doc: Document,
  text: string,
  menu: string,
): Promise<Classification | null> {
  const system =
    "You are a PMO governance assistant. Read the supplied project document " +
    "and classify it against the project lifecycle. You must use the EXACT " +
    "stage keys and document/checklist identifiers from the supplied menu. " +
    "If no stage clearly applies, return null. Only tick checklist items that " +
    "are directly evidenced by the document content — never speculate.";

  const prompt = [
    `Stage / required-document / checklist menu (the only valid vocabulary):`,
    menu,
    ``,
    `Document name: ${doc.name}`,
    `Currently assigned to stage: ${doc.stage ?? "(unassigned)"}`,
    `Content (truncated to ${MAX_DOC_TEXT_CHARS} chars):`,
    `"""`,
    text.slice(0, MAX_DOC_TEXT_CHARS),
    `"""`,
    ``,
    `Return JSON with: stage (one menu key or null), canonicalDocName (one of`,
    `that stage's requiredDocs or null), summary (≤300 chars), checklistTicks`,
    `(blocking ids from that stage that this doc clearly satisfies),`,
    `approvalFlags (subgate approval-flag names like __bc_approved /`,
    `__urs_biz_approved that the doc explicitly signs off), charterFields`,
    `(only when the doc is a charter or business case — extract scope,`,
    `deliverables, sponsor, budgets, drivers, etc.; otherwise null).`,
  ].join("\n");

  const r = await llm({
    task: "doc_backfill_classify",
    system,
    prompt,
    jsonSchema: classificationSchema,
    jsonSchemaHint:
      `{"stage":"initiation|vendor_selection|investment_authorization|contract_po|design|build|uat|go_live|closure|null",` +
      `"canonicalDocName":"<one of stage's requiredDocs or null>",` +
      `"summary":"<≤300 chars>",` +
      `"checklistTicks":["<id>",...],` +
      `"approvalFlags":["__bc_approved",...],` +
      `"charterFields":{"description":"...","scope":"...","tentativeBudget":1000000,...}|null}`,
    maxTokens: 1200,
  });
  if (!r.ok) return null;
  // Normalise — zod defaults aren't reflected in the helper's inferred type,
  // so coerce to the resolved Classification shape.
  return {
    stage: r.data.stage,
    canonicalDocName: r.data.canonicalDocName,
    summary: r.data.summary,
    checklistTicks: r.data.checklistTicks ?? [],
    approvalFlags: r.data.approvalFlags ?? [],
    charterFields: r.data.charterFields ?? null,
  };
}

// ---------------------------------------------------------------------------
// Stage-notes JSON merge — preserves any existing checklist ticks + flags.
// Returns the number of *new* ticks applied.
// ---------------------------------------------------------------------------

async function mergeStageNotes(
  projectId: number,
  stage: string,
  patch: { ticks: string[]; flags: string[] },
): Promise<number> {
  const [row] = await db
    .select()
    .from(projectStagesTable)
    .where(
      and(
        eq(projectStagesTable.projectId, projectId),
        eq(projectStagesTable.stage, stage),
      ),
    );

  let notes: Record<string, unknown> = {};
  if (row?.notes) {
    try {
      notes = JSON.parse(row.notes) as Record<string, unknown>;
    } catch {
      notes = {};
    }
  }
  const checklist = (notes.__checklist ?? {}) as Record<string, boolean>;
  let added = 0;
  for (const id of patch.ticks) {
    if (!checklist[id]) {
      checklist[id] = true;
      added += 1;
    }
  }
  notes.__checklist = checklist;
  const now = new Date().toISOString();
  for (const flag of patch.flags) {
    if (notes[flag] !== true) {
      notes[flag] = true;
      notes[`${flag}_at`] = now;
    }
  }

  const serialised = JSON.stringify(notes);
  if (row) {
    await db
      .update(projectStagesTable)
      .set({ notes: serialised })
      .where(eq(projectStagesTable.id, row.id));
  } else {
    await db.insert(projectStagesTable).values({
      projectId,
      stage,
      status: "in_progress",
      enteredAt: new Date(),
      notes: serialised,
    });
  }
  return added;
}

// ---------------------------------------------------------------------------
// Charter merge — only fills empty fields. Existing user content always wins.
// ---------------------------------------------------------------------------

async function mergeCharterFields(
  charterId: number,
  extracted: Record<string, string | number>,
): Promise<boolean> {
  const [charter] = await db
    .select()
    .from(chartersTable)
    .where(eq(chartersTable.id, charterId));
  if (!charter) return false;

  const TEXT_FIELDS: Array<keyof typeof chartersTable.$inferSelect> = [
    "description",
    "scope",
    "deliverables",
    "executiveSummary",
    "currentState",
    "businessDrivers",
    "outOfScope",
    "constraints",
    "assumptions",
    "toplineImprovement",
    "bottomLineOptimization",
    "complianceBenefits",
    "productivityImprovement",
  ];
  const NUM_FIELDS: Array<keyof typeof chartersTable.$inferSelect> = [
    "tentativeBudget",
    "capexAmount",
    "opexAmount",
  ];

  const patch: Record<string, unknown> = {};
  for (const k of TEXT_FIELDS) {
    const incoming = extracted[k as string];
    const current = charter[k];
    if (
      typeof incoming === "string" &&
      incoming.trim() &&
      (current == null || current === "")
    ) {
      patch[k as string] = incoming;
    }
  }
  for (const k of NUM_FIELDS) {
    const incoming = extracted[k as string];
    const current = charter[k];
    if (
      typeof incoming === "number" &&
      isFinite(incoming) &&
      incoming > 0 &&
      (current == null || Number(current) === 0)
    ) {
      patch[k as string] = String(incoming);
    }
  }

  if (Object.keys(patch).length === 0) return false;
  await db
    .update(chartersTable)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(chartersTable.id, charterId));
  return true;
}

// ---------------------------------------------------------------------------
// Stage record bootstrap — projects may have stage records lazily.
// ---------------------------------------------------------------------------

async function ensureStageRecord(
  projectId: number,
  stage: string,
  initialStatus: "not_started" | "in_progress" = "not_started",
) {
  const [existing] = await db
    .select()
    .from(projectStagesTable)
    .where(
      and(
        eq(projectStagesTable.projectId, projectId),
        eq(projectStagesTable.stage, stage),
      ),
    );
  if (existing) {
    if (initialStatus === "in_progress" && existing.status === "not_started") {
      await db
        .update(projectStagesTable)
        .set({ status: "in_progress", enteredAt: new Date() })
        .where(eq(projectStagesTable.id, existing.id));
    }
    return;
  }
  await db.insert(projectStagesTable).values({
    projectId,
    stage,
    status: initialStatus,
    enteredAt: initialStatus === "in_progress" ? new Date() : undefined,
  });
}
