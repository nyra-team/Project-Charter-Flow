import { Router, type IRouter } from "express";
import { z } from "zod";
import {
  db,
  chartersTable,
  projectsTable,
  projectStagesTable,
  budgetLinesTable,
  risksTable,
  issuesTable,
  tasksTable,
  milestonesTable,
  meetingsTable,
  meetingItemsTable,
  activityTable,
  pifsTable,
  documentsTable,
  liveChartersTable,
} from "@workspace/db";
import { eq, desc, and, or, inArray } from "drizzle-orm";
import { llm, isLLMConfigured, llmWithTools, type AnthropicTool } from "@workspace/llm";
import { runNyraSql, getNyraSchemaDocs } from "../lib/nyraSql";
import { extractDocText, buildStageMatrix, MAX_DOC_TEXT_CHARS } from "../lib/liveCharter";
import { backfillFromDocs } from "../lib/docBackfill";
import type { Document } from "@workspace/db";

const router: IRouter = Router();

/**
 * ALL AI calls in this application MUST be routed through this file.
 * This file itself MUST only call the single `llm()` helper from
 * @workspace/llm — never instantiate Anthropic, OpenAI, or any other
 * provider directly anywhere else.
 */

function aiError(reason: string, message: string, res: any) {
  res.status(reason === "no_api_key" ? 503 : 502).json({ error: message, reason });
}

// ---------------------------------------------------------------------------
// GET /api/ai/status
// ---------------------------------------------------------------------------
router.get("/ai/status", (_req, res) => {
  res.json({
    configured: isLLMConfigured(),
    provider: "anthropic",
    model: process.env.LLM_DEFAULT_MODEL || "claude-sonnet-4-6",
  });
});

// ---------------------------------------------------------------------------
// POST /api/ai/improve-text
// ---------------------------------------------------------------------------
router.post("/ai/improve-text", async (req, res): Promise<void> => {
  const { text, tone = "professional, concise, executive", audience = "PMO executives", maxWords = 200, instruction } = (req.body || {}) as {
    text?: string; tone?: string; audience?: string; maxWords?: number; instruction?: string;
  };
  if (!text || text.trim().length < 3) { res.status(400).json({ error: "text is required" }); return; }
  const result = await llm({
    task: "improve_text",
    system:
      "You are a senior PMO writing assistant. Rewrite the given text to be clearer, more precise, and aligned with enterprise PMO communication standards. Preserve all facts, numbers, dates, and intent. Never invent data.",
    prompt: `Tone: ${tone}\nAudience: ${audience}\nMax words: ${maxWords}\n${instruction ? `Extra instruction: ${instruction}\n` : ""}\nOriginal text:\n"""\n${text}\n"""\n\nReturn ONLY the rewritten text. No preamble, no quotes, no markdown.`,
    maxTokens: 1500,
  });
  if (!result.ok) return aiError(result.reason, result.message, res);
  res.json({ rewritten: result.data, usage: result.usage });
});

// ---------------------------------------------------------------------------
// POST /api/ai/charters/:id/rewrite-brd
// ---------------------------------------------------------------------------
router.post("/ai/charters/:id/rewrite-brd", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [charter] = await db.select().from(chartersTable).where(eq(chartersTable.id, id));
  if (!charter) { res.status(404).json({ error: "Charter not found" }); return; }

  const result = await llm({
    task: "rewrite_brd",
    system:
      "You are an experienced PMO Business Analyst rewriting a Business Requirements Document (BRD) / Project Charter. Improve clarity, structure (Problem → Goal → Scope → Deliverables → Success Metrics → Benefits), business specificity, and executive readability. Never invent stakeholders, numbers, or dates that are not already present.",
    prompt: `Project title: ${charter.title}\nBudget (tentative): ${charter.tentativeBudget ?? "-"}\nStart: ${charter.startDate ?? "-"} | End: ${charter.endDate ?? "-"}\n\nCurrent draft:\n${JSON.stringify({
      description: charter.description,
      scope: charter.scope,
      deliverables: charter.deliverables,
      solutionComparison: charter.solutionComparison,
      toplineImprovement: charter.toplineImprovement,
      bottomLineOptimization: charter.bottomLineOptimization,
      complianceBenefits: charter.complianceBenefits,
      productivityImprovement: charter.productivityImprovement,
    }, null, 2)}\n\nRewrite each field in-place to be sharper and more executive-grade. Return ALL fields, even if unchanged.`,
    jsonSchema: z.object({
      description: z.string(),
      scope: z.string(),
      deliverables: z.string(),
      solutionComparison: z.string().optional(),
      toplineImprovement: z.string().optional(),
      bottomLineOptimization: z.string().optional(),
      complianceBenefits: z.string().optional(),
      productivityImprovement: z.string().optional(),
      suggestions: z.array(z.string()),
    }),
    jsonSchemaHint: `{ "description":"...", "scope":"...", "deliverables":"...", "solutionComparison":"...", "toplineImprovement":"...", "bottomLineOptimization":"...", "complianceBenefits":"...", "productivityImprovement":"...", "suggestions":["short bullet of what changed"] }`,
    maxTokens: 4000,
  });
  if (!result.ok) return aiError(result.reason, result.message, res);
  res.json(result.data);
});

// ---------------------------------------------------------------------------
// POST /api/ai/charters/:id/risk-suggestions
// (risks are keyed off charterId)
// ---------------------------------------------------------------------------
router.post("/ai/charters/:id/risk-suggestions", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [charter] = await db.select().from(chartersTable).where(eq(chartersTable.id, id));
  if (!charter) { res.status(404).json({ error: "Charter not found" }); return; }
  const existing = await db.select().from(risksTable).where(eq(risksTable.charterId, id));

  const result = await llm({
    task: "risk_suggestions",
    system:
      "You are a seasoned PMO risk officer. Given a project's scope and existing risks, suggest 3–7 ADDITIONAL plausible risks that are NOT already in the register. For each, suggest mitigation. Use realistic enterprise risk language. impact and likelihood are one of: low | medium | high.",
    prompt: `Project: ${charter.title}\nDescription: ${charter.description}\nScope: ${charter.scope}\nDeliverables: ${charter.deliverables}\nBudget: ${charter.tentativeBudget ?? "-"}\nDuration: ${charter.durationDays ?? "-"} days\n\nExisting risks (do NOT repeat these):\n${existing.map((r) => `- ${r.title}`).join("\n") || "(none)"}\n`,
    jsonSchema: z.object({
      risks: z.array(z.object({
        title: z.string(),
        description: z.string(),
        impact: z.enum(["low", "medium", "high"]),
        likelihood: z.enum(["low", "medium", "high"]),
        priority: z.enum(["low", "medium", "high"]),
        mitigation: z.string(),
        owner: z.string().optional(),
      })),
    }),
    jsonSchemaHint: `{ "risks":[{"title":"...","description":"...","impact":"low|medium|high","likelihood":"low|medium|high","priority":"low|medium|high","mitigation":"...","owner":"role name"}] }`,
    maxTokens: 3000,
  });
  if (!result.ok) return aiError(result.reason, result.message, res);
  res.json(result.data);
});

// ---------------------------------------------------------------------------
// POST /api/ai/projects/:id/budget-insights
// ---------------------------------------------------------------------------
router.post("/ai/projects/:id/budget-insights", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }
  const lines = await db.select().from(budgetLinesTable).where(eq(budgetLinesTable.projectId, id));

  const totalBaseline = lines.reduce((s, l) => s + Number(l.baselineAmount ?? 0), 0);
  const totalForecast = lines.reduce((s, l) => s + Number(l.forecastAmount ?? 0), 0);
  const totalActual = lines.reduce((s, l) => s + Number(l.actualAmount ?? 0), 0);
  const variancePct = totalBaseline > 0 ? ((totalActual - totalBaseline) / totalBaseline) * 100 : 0;

  const result = await llm({
    task: "budget_insights",
    system:
      "You are a CFO-level budget analyst. Given project budget line items (baseline / forecast / actual), produce a short, executive briefing. Call out over-utilization, under-utilization, category-level red flags, and 2-4 actionable recommendations. Use precise numbers and percentages.",
    prompt: `Project: ${project.name}\nBudget threshold: ${project.budgetThresholdPct}%\nTotal baseline: ${totalBaseline}\nTotal forecast: ${totalForecast}\nTotal actual: ${totalActual}\nVariance vs baseline: ${variancePct.toFixed(1)}%\n\nBudget lines:\n${lines.map((l) => `- [${l.category}] ${l.description || "Line"}: baseline ${l.baselineAmount}, forecast ${l.forecastAmount}, actual ${l.actualAmount}`).join("\n") || "(none)"}\n`,
    jsonSchema: z.object({
      headline: z.string(),
      overall_health: z.enum(["healthy", "watch", "at_risk", "critical"]),
      variance_pct: z.number(),
      over_utilized_categories: z.array(z.object({ category: z.string(), variancePct: z.number(), note: z.string() })),
      under_utilized_categories: z.array(z.object({ category: z.string(), variancePct: z.number(), note: z.string() })),
      recommendations: z.array(z.string()),
    }),
    jsonSchemaHint: `{ "headline":"one-line summary", "overall_health":"healthy|watch|at_risk|critical", "variance_pct": n, "over_utilized_categories":[{"category":"...","variancePct":n,"note":"..."}], "under_utilized_categories":[...], "recommendations":["..."] }`,
    maxTokens: 2500,
  });
  if (!result.ok) return aiError(result.reason, result.message, res);
  res.json(result.data);
});

// ---------------------------------------------------------------------------
// POST /api/ai/projects/:id/dashboard-summary
// ---------------------------------------------------------------------------
router.post("/ai/projects/:id/dashboard-summary", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  const [tasks, milestones, projectRisks, openIssues, budget] = await Promise.all([
    db.select().from(tasksTable).where(eq(tasksTable.projectId, id)),
    db.select().from(milestonesTable).where(eq(milestonesTable.projectId, id)),
    db.select().from(risksTable).where(eq(risksTable.charterId, project.charterId)),
    db.select().from(issuesTable).where(eq(issuesTable.projectId, id)).orderBy(desc(issuesTable.createdAt)).limit(10),
    db.select().from(budgetLinesTable).where(eq(budgetLinesTable.projectId, id)),
  ]);

  const taskStats = tasks.reduce((acc: Record<string, number>, t) => {
    acc[t.status ?? "unknown"] = (acc[t.status ?? "unknown"] ?? 0) + 1; return acc;
  }, {});
  const baseline = budget.reduce((s, l) => s + Number(l.baselineAmount ?? 0), 0);
  const actual = budget.reduce((s, l) => s + Number(l.actualAmount ?? 0), 0);
  const highRisks = projectRisks.filter((r) => r.priority === "high" || r.rag === "red").length;

  const result = await llm({
    task: "dashboard_summary",
    system:
      "You are an executive PMO chief of staff. Produce a tight, decision-grade weekly summary for senior leadership. Focus on what changed, what is at risk, and what needs a decision. No fluff.",
    prompt: `Project: ${project.name} (${project.status}, RAG ${project.ragStatus})\nProgress: ${project.progress}%\nTasks by status: ${JSON.stringify(taskStats)}\nMilestones: ${milestones.length} total, ${milestones.filter((m) => m.status === "completed").length} done\nOpen risks: ${projectRisks.length} (high/red: ${highRisks})\nOpen issues: ${openIssues.length}\nBudget: baseline ${baseline}, actual ${actual}\n\nRecent issues:\n${openIssues.map((i) => `- ${i.title} (${i.status})`).join("\n") || "(none)"}\n`,
    jsonSchema: z.object({
      headline: z.string(),
      health_call: z.enum(["green", "amber", "red"]),
      key_wins: z.array(z.string()),
      key_concerns: z.array(z.string()),
      decisions_needed: z.array(z.string()),
      next_two_weeks: z.array(z.string()),
    }),
    jsonSchemaHint: `{ "headline":"...", "health_call":"green|amber|red", "key_wins":["..."], "key_concerns":["..."], "decisions_needed":["..."], "next_two_weeks":["..."] }`,
    maxTokens: 2500,
  });
  if (!result.ok) return aiError(result.reason, result.message, res);
  res.json(result.data);
});

// ---------------------------------------------------------------------------
// POST /api/ai/meetings/:id/extract-action-items
// ---------------------------------------------------------------------------
router.post("/ai/meetings/:id/extract-action-items", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [meeting] = await db.select().from(meetingsTable).where(eq(meetingsTable.id, id));
  if (!meeting) { res.status(404).json({ error: "Meeting not found" }); return; }
  const transcript = (req.body?.transcript as string | undefined) ?? meeting.notes ?? "";
  if (!transcript || transcript.trim().length < 20) {
    res.status(400).json({ error: "Meeting has no notes/transcript to extract from" });
    return;
  }

  const result = await llm({
    task: "extract_action_items",
    system:
      "You read meeting transcripts/notes from a PMO CFT call (steering committee, WRM, BRM, fortnightly LD) and extract a clean list of items. Distinguish action_item vs decision vs information. Use the speaker's own words where possible. Owner is the person assigned to do the work, not the speaker.",
    prompt: `Meeting: ${meeting.title} (${meeting.type}) on ${meeting.scheduledDate}\n\nTranscript / notes:\n"""\n${transcript}\n"""\n`,
    jsonSchema: z.object({
      items: z.array(z.object({
        description: z.string(),
        owner: z.string().optional(),
        dueDate: z.string().optional(),
        category: z.enum(["action_item", "decision", "information"]),
      })),
    }),
    jsonSchemaHint: `{ "items":[{"description":"...","owner":"name or empty","dueDate":"YYYY-MM-DD or empty","category":"action_item|decision|information"}] }`,
    maxTokens: 3000,
  });
  if (!result.ok) return aiError(result.reason, result.message, res);

  const inserted: Array<typeof meetingItemsTable.$inferSelect> = [];
  for (const item of result.data.items) {
    const [row] = await db.insert(meetingItemsTable).values({
      meetingId: id,
      description: item.description,
      dueDate: item.dueDate || null,
      status: "open",
      category: item.category,
      notes: item.owner ? `AI-extracted · owner: ${item.owner}` : "AI-extracted",
    }).returning();
    inserted.push(row);
  }
  res.json({ extracted: result.data.items.length, items: inserted });
});

// ---------------------------------------------------------------------------
// POST /api/ai/lessons-learned/search
// ---------------------------------------------------------------------------
router.post("/ai/projects/:id/audit-rca", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  const projectTasks = await db.select({ id: tasksTable.id }).from(tasksTable).where(eq(tasksTable.projectId, id));
  const projectMs = await db.select({ id: milestonesTable.id }).from(milestonesTable).where(eq(milestonesTable.projectId, id));
  const taskIds = projectTasks.map(t => t.id);
  const msIds = projectMs.map(m => m.id);

  const conditions = [and(eq(activityTable.entityType, "project"), eq(activityTable.entityId, id))!];
  if (taskIds.length) conditions.push(and(eq(activityTable.entityType, "task"), inArray(activityTable.entityId, taskIds))!);
  if (msIds.length) conditions.push(and(eq(activityTable.entityType, "milestone"), inArray(activityTable.entityId, msIds))!);

  const events = await db.select().from(activityTable)
    .where(conditions.length === 1 ? conditions[0] : or(...conditions))
    .orderBy(desc(activityTable.createdAt))
    .limit(200);

  if (events.length === 0) {
    res.status(400).json({ error: "No audit events recorded yet — nothing to analyze." });
    return;
  }

  const trail = events.map(e =>
    `[${new Date(e.createdAt as unknown as string).toISOString().slice(0,16).replace("T"," ")}] ${e.type} · ${e.entityType}#${e.entityId} · ${e.message}`
  ).join("\n");

  const result = await llm({
    task: "audit_rca",
    system:
      "You are a senior PMO root-cause analyst. Read a project's structured audit trail (most recent first) and produce a tight Root Cause Analysis: identify what went wrong (or what is trending wrong), the likely root causes, contributing factors, and concrete corrective actions. Cite event types/timestamps when relevant. Never invent events not in the trail.",
    prompt: `Project: ${project.name} (status: ${project.status}, RAG: ${project.ragStatus}, progress: ${project.progress}%)\n\nAudit trail (newest → oldest, up to 200 events):\n"""\n${trail}\n"""\n`,
    jsonSchema: z.object({
      summary: z.string(),
      timeline_signals: z.array(z.string()),
      root_causes: z.array(z.object({ cause: z.string(), evidence: z.string() })),
      contributing_factors: z.array(z.string()),
      corrective_actions: z.array(z.object({ action: z.string(), owner_hint: z.string().optional(), priority: z.enum(["P0","P1","P2","P3"]) })),
      risk_outlook: z.enum(["green","amber","red"]),
    }),
    jsonSchemaHint: `{ "summary":"...", "timeline_signals":["..."], "root_causes":[{"cause":"...","evidence":"..."}], "contributing_factors":["..."], "corrective_actions":[{"action":"...","owner_hint":"role/dept","priority":"P0|P1|P2|P3"}], "risk_outlook":"green|amber|red" }`,
    maxTokens: 3500,
  });
  if (!result.ok) return aiError(result.reason, result.message, res);
  res.json({ ...result.data, eventsAnalyzed: events.length });
});

router.post("/ai/lessons-learned/search", async (req, res): Promise<void> => {
  const { query, lessons } = (req.body || {}) as {
    query?: string;
    lessons?: Array<{ id: number; title: string; description?: string; tags?: string[] }>;
  };
  if (!query) { res.status(400).json({ error: "query is required" }); return; }
  if (!lessons || lessons.length === 0) { res.json({ ranked: [] }); return; }

  const result = await llm({
    task: "lessons_search",
    system:
      "You rank lessons-learned entries by relevance to the user's query. Return the IDs in order, most relevant first, with a one-line reason for each.",
    prompt: `Query: ${query}\n\nLessons:\n${lessons.map((l) => `[${l.id}] ${l.title}${l.description ? " — " + l.description.slice(0, 200) : ""}`).join("\n")}\n`,
    jsonSchema: z.object({
      ranked: z.array(z.object({ id: z.number(), score: z.number().min(0).max(1), why: z.string() })),
    }),
    jsonSchemaHint: `{ "ranked":[{"id":1,"score":0.0-1.0,"why":"..."}] }`,
    maxTokens: 2000,
  });
  if (!result.ok) return aiError(result.reason, result.message, res);
  res.json(result.data);
});

// ---------------------------------------------------------------------------
// POST /api/ai/charters/draft-fields
// Drafts charter long-form fields from a few basic inputs (title + function +
// strategic themes + optional hint). Used by the charter-new wizard's
// "AI Draft from Project Details" button to populate empty fields only.
// ---------------------------------------------------------------------------
router.post("/ai/charters/draft-fields", async (req, res): Promise<void> => {
  const {
    title,
    function: fn,
    strategicThemes,
    hint,
    tentativeBudget,
  } = (req.body || {}) as {
    title?: string;
    function?: string;
    strategicThemes?: string[];
    hint?: string;
    tentativeBudget?: number;
  };
  if (!title || title.trim().length < 3) {
    res.status(400).json({ error: "title is required" });
    return;
  }
  const themesStr = (strategicThemes ?? []).filter(Boolean).join(", ") || "(none specified)";
  const result = await llm({
    task: "charter_draft_fields",
    system:
      "You are an experienced PMO Business Analyst drafting the long-form sections of a project charter. Given only a project title, owning function, and strategic themes (and an optional hint), produce realistic, executive-grade first-draft content for each section. Be specific to the project as described — never write generic placeholder text. Where you state numbers, label them as illustrative ('e.g.', 'approx.'). Never invent stakeholders, vendors, or hard dates.",
    prompt: `Project title: ${title}\nFunction / Department: ${fn || "(unspecified)"}\nStrategic themes: ${themesStr}\nTentative budget: ${tentativeBudget ? `USD ${tentativeBudget}` : "(unspecified)"}\nUser hint: ${hint || "(none)"}\n\nDraft each charter field in 80-180 words (shorter for summaries). Use professional, decision-grade language an executive steering committee would expect.`,
    jsonSchema: z.object({
      businessJustification: z.string().min(100),
      scopeSummary: z.string().min(50),
      expectedOutcomes: z.string().min(20),
      scope: z.string().min(50),
      deliverables: z.string().min(20),
      solutionComparison: z.string().optional(),
      toplineImprovement: z.string().optional(),
      bottomLineOptimization: z.string().optional(),
      complianceBenefits: z.string().optional(),
      productivityImprovement: z.string().optional(),
    }),
    jsonSchemaHint: `{ "businessJustification":"...", "scopeSummary":"...", "expectedOutcomes":"...", "scope":"In-Scope: ...\\nOut-of-Scope: ...", "deliverables":"- ...\\n- ...", "solutionComparison":"...", "toplineImprovement":"...", "bottomLineOptimization":"...", "complianceBenefits":"...", "productivityImprovement":"..." }`,
    maxTokens: 4000,
  });
  if (!result.ok) return aiError(result.reason, result.message, res);
  res.json(result.data);
});

// ---------------------------------------------------------------------------
// POST /api/ai/extract-doc-text
// Pulls plain text from an already-uploaded reference document (by its storage
// fileUrl) so the Charter/e-NFA wizard can feed real source content into the AI
// draft. Reuses extractDocText (PDF/DOCX/XLSX/txt). Returns capped plaintext;
// `extracted:false` when the file is unsupported/empty (caller degrades silently).
// ---------------------------------------------------------------------------
router.post("/ai/extract-doc-text", async (req, res): Promise<void> => {
  const { fileUrl, fileName, fileType, fileSize } = (req.body || {}) as {
    fileUrl?: string; fileName?: string; fileType?: string; fileSize?: number;
  };
  if (!fileUrl) { res.status(400).json({ error: "fileUrl is required" }); return; }
  const text = await extractDocText({
    fileUrl, name: fileName || "upload",
    fileType: fileType ?? null, fileSize: fileSize ?? null,
  } as unknown as Document);
  if (!text) { res.json({ text: "", extracted: false }); return; }
  res.json({ text: text.slice(0, MAX_DOC_TEXT_CHARS), extracted: true });
});

// ---------------------------------------------------------------------------
// POST /api/ai/charters/extract-fields
// Pulls the structured Charter basics that are ACTUALLY present in an uploaded
// reference document / email — so mandatory fields auto-fill from the source
// instead of forcing the user to retype them. Extraction only: never invents;
// any field not stated in the text is omitted.
// ---------------------------------------------------------------------------
router.post("/ai/charters/extract-fields", async (req, res): Promise<void> => {
  const { sourceText } = (req.body || {}) as { sourceText?: string };
  if (!sourceText || sourceText.trim().length < 20) { res.json({}); return; }
  const result = await llm({
    task: "charter_extract_fields",
    system:
      "You extract structured Project Charter fields from a source document or email. Return ONLY values explicitly stated or unambiguously implied in the text. If a field is not present, OMIT it entirely — never guess, never invent placeholders. Map free text to the allowed enum option only when it clearly matches; otherwise omit. Keep extracted strings verbatim/concise.",
    prompt: `Source document (treat as the only source of truth):\n"""\n${sourceText.slice(0, MAX_DOC_TEXT_CHARS)}\n"""\n\nExtract any of these that the document provides:\n- title: the project / initiative name\n- sponsor: ONE of [CMD, ED, CEO, CFO, COO, CHRO] if a sponsoring executive is named\n- function: owning function / department\n- category: ONE of [Compliance, ROI, "Compliance + ROI"]\n- pmType: ONE of ["IT PM", "Business PM"]\n- pmName: the project manager's name\n- approvedBudget: approved budget as written (with currency)\n- leBudget: latest-estimate budget as written\n- members: array of key project member names mentioned\n- projectDescription: a 1-3 sentence description of the project drawn from the document\nOmit any field the document does not clearly provide.`,
    jsonSchema: z.object({
      title: z.string().optional(),
      sponsor: z.string().optional(),
      function: z.string().optional(),
      category: z.string().optional(),
      pmType: z.string().optional(),
      pmName: z.string().optional(),
      approvedBudget: z.string().optional(),
      leBudget: z.string().optional(),
      members: z.array(z.string()).optional(),
      projectDescription: z.string().optional(),
    }),
    jsonSchemaHint: `{ "title":"...", "sponsor":"CFO", "function":"...", "category":"ROI", "pmType":"IT PM", "pmName":"...", "approvedBudget":"INR 50,00,000", "leBudget":"...", "members":["..."], "projectDescription":"..." }`,
    maxTokens: 1200,
  });
  if (!result.ok) return aiError(result.reason, result.message, res);
  res.json(result.data);
});

// POST /api/ai/charters/draft-template
// Drafts the single-page Project Charter template fields (charter-template-new
// form) from a few basic inputs. Returns the long-form narrative AND structured
// milestone / KPI tables so the "Draft with AI" button can fill the whole form.
// ---------------------------------------------------------------------------
router.post("/ai/charters/draft-template", async (req, res): Promise<void> => {
  const {
    title,
    sponsor,
    function: fn,
    category,
    approvedBudget,
    hint,
    sourceText,
  } = (req.body || {}) as {
    title?: string;
    sponsor?: string;
    function?: string;
    category?: string;
    approvedBudget?: number;
    hint?: string;
    sourceText?: string;
  };
  if (!title || title.trim().length < 3) {
    res.status(400).json({ error: "title is required" });
    return;
  }
  const result = await llm({
    task: "charter_draft_template",
    system:
      "You are an experienced PMO Business Analyst drafting a corporate Project Charter. Given a project title, sponsor, owning function, category and optional budget/hint, produce realistic, executive-grade first-draft content for every section of the charter. Be specific to the project as described — never write generic placeholder text. Where you state numbers, label them as illustrative ('e.g.', 'approx.'). Never invent real stakeholder names, real vendors, or hard calendar dates — for milestone target dates use relative phrasing like 'Q1' / 'Month 3'. For responsible parties use roles (e.g. 'IT Lead', 'Process Owner'), not invented names.",
    prompt: `Project title: ${title}\nProject sponsor: ${sponsor || "(unspecified)"}\nFunction / Department: ${fn || "(unspecified)"}\nCategory: ${category || "(unspecified)"}\nApproved budget: ${approvedBudget ? `INR ${approvedBudget}` : "(unspecified)"}\nUser hint: ${hint || "(none)"}${sourceText ? `\n\nReference document (extracted from an uploaded source — treat as ground truth; incorporate the relevant facts, do not copy verbatim):\n${sourceText.slice(0, MAX_DOC_TEXT_CHARS)}` : ""}\n\nDraft each charter field. Narrative fields 60-160 words each (shorter for one-line items). Provide 4-6 milestones and 3-5 KPIs. Use professional, decision-grade language an executive steering committee would expect.`,
    jsonSchema: z.object({
      executiveSummary: z.string().min(80),
      background: z.string().min(60),
      inScope: z.string().min(40),
      outOfScope: z.string().min(20),
      businessOutcome: z.string().min(40),
      constraints: z.string().optional(),
      scopeLimitations: z.string().optional(),
      assumptions: z.string().optional(),
      risks: z.string().optional(),
      potentialAdditionalBudget: z.string().optional(),
      milestones: z.array(z.object({
        milestone: z.string(),
        responsible: z.string().optional(),
        targetDate: z.string().optional(),
      })).optional(),
      kpis: z.array(z.object({
        kpi: z.string(),
        baseline: z.string().optional(),
        goal: z.string().optional(),
      })).optional(),
    }),
    jsonSchemaHint: `{ "executiveSummary":"...", "background":"...", "inScope":"...", "outOfScope":"...", "businessOutcome":"...", "constraints":"...", "scopeLimitations":"...", "assumptions":"...", "risks":"...", "potentialAdditionalBudget":"...", "milestones":[{"milestone":"...","responsible":"IT Lead","targetDate":"Q1"}], "kpis":[{"kpi":"...","baseline":"...","goal":"..."}] }`,
    maxTokens: 4000,
  });
  if (!result.ok) return aiError(result.reason, result.message, res);
  res.json(result.data);
});

// ---------------------------------------------------------------------------
// POST /api/ai/charters/draft-narrative
//
// Stateless. Takes the in-flight wizard form values and returns AI-drafted
// prose for the 8 narrative sections of the merged Charter+NFA. Charter row
// does not need to exist yet — this is called from the final wizard step
// before submit, as part of the "Generate & Review" HITL flow.
//
// Supports a `regenerateOnly` array so the user can re-roll individual
// sections without re-drafting the whole document.
// ---------------------------------------------------------------------------
router.post("/ai/charters/draft-narrative", async (req, res): Promise<void> => {
  const body = (req.body || {}) as {
    title?: string;
    function?: string;
    strategicThemes?: string[];
    businessJustification?: string;
    scopeSummary?: string;
    expectedOutcomes?: string;
    scope?: string;
    outOfScope?: string;
    deliverables?: string;
    category?: string;
    entity?: string;
    department?: string;
    kind?: string;
    tentativeBudget?: number;
    capexAmount?: number;
    opexAmount?: number;
    fyRecurring?: Array<{ fyLabel?: string; amountInr?: number }>;
    roiPerAnnum?: number;
    paybackMonths?: number;
    milestones?: Array<{ milestone?: string; responsible?: string; targetDate?: string }>;
    kpis?: Array<{ kpi?: string; baseline?: string; goal?: string }>;
    regenerateOnly?: string[];
  };

  if (!body.title || body.title.trim().length < 3) {
    res.status(400).json({ error: "title is required (>= 3 chars)" });
    return;
  }

  const themesStr = (body.strategicThemes ?? []).filter(Boolean).join(", ") || "(none specified)";
  const fyStr = (body.fyRecurring ?? [])
    .filter(r => r.fyLabel)
    .map(r => `${r.fyLabel}: ₹${r.amountInr ?? 0}`)
    .join(" | ") || "(none)";
  const milestonesStr = (body.milestones ?? [])
    .filter(m => m.milestone)
    .map(m => `• ${m.milestone}${m.targetDate ? ` (${m.targetDate})` : ""}`)
    .join("\n") || "(none yet)";
  const kpisStr = (body.kpis ?? [])
    .filter(k => k.kpi)
    .map(k => `• ${k.kpi}: ${k.baseline ?? ""} → ${k.goal ?? ""}`)
    .join("\n") || "(none yet)";

  const onlyClause = (body.regenerateOnly && body.regenerateOnly.length > 0)
    ? `\nOnly regenerate these sections (return empty strings for the rest): ${body.regenerateOnly.join(", ")}`
    : "";

  const result = await llm({
    task: "charter_nfa_draft_narrative",
    system:
      "You are an experienced PMO Business Analyst drafting the narrative sections of a consolidated Project Charter and Note for Approval (Charter+NFA) for a regulated pharmaceutical manufacturer (Granules India). Audience: CMD, ED, CFO, and the Steering Committee. Write in confident, decision-grade English. Be specific to the project as described — never write generic placeholder text. Where you state numbers, label them as illustrative (e.g., 'approx.'). Never invent stakeholders, vendors, or hard dates. Use clear paragraphs; no markdown headings (the document template adds those).",
    prompt:
      `Project: ${body.title}\n` +
      `Function / Department: ${body.function || body.department || "(unspecified)"}\n` +
      `Entity: ${body.entity || "(unspecified)"}\n` +
      `Category: ${body.category || "(unspecified)"}\n` +
      `Strategic themes: ${themesStr}\n` +
      `Kind: ${body.kind || "capex"}\n` +
      `Tentative budget (INR): ${body.tentativeBudget ?? "(unspecified)"}\n` +
      `CAPEX: ₹${body.capexAmount ?? 0}  |  OPEX: ₹${body.opexAmount ?? 0}\n` +
      `FY-wise recurring: ${fyStr}\n` +
      `ROI/Annum: ${body.roiPerAnnum ?? "(unspecified)"}  |  Payback (months): ${body.paybackMonths ?? "(unspecified)"}\n` +
      `\nUser-provided sketches (use these as ground truth — expand, don't invent contradictions):\n` +
      `Business justification: ${body.businessJustification || "(empty)"}\n` +
      `Scope summary: ${body.scopeSummary || "(empty)"}\n` +
      `Expected outcomes: ${body.expectedOutcomes || "(empty)"}\n` +
      `In-scope detail: ${body.scope || "(empty)"}\n` +
      `Out-of-scope detail: ${body.outOfScope || "(empty)"}\n` +
      `Deliverables: ${body.deliverables || "(empty)"}\n` +
      `Milestones:\n${milestonesStr}\n` +
      `KPIs:\n${kpisStr}\n` +
      onlyClause +
      `\n\nDraft each section in 80-180 words (shorter for constraints/assumptions).`,
    jsonSchema: z.object({
      executiveSummary: z.string(),
      background: z.string(),
      currentState: z.string(),
      businessDrivers: z.string(),
      outOfScope: z.string(),
      constraints: z.string(),
      assumptions: z.string(),
      recommendation: z.string(),
    }),
    jsonSchemaHint: `{ "executiveSummary":"...", "background":"...", "currentState":"...", "businessDrivers":"...", "outOfScope":"...", "constraints":"...", "assumptions":"...", "recommendation":"..." }`,
    maxTokens: 4000,
  });
  if (!result.ok) return aiError(result.reason, result.message, res);
  res.json(result.data);
});

// ---------------------------------------------------------------------------
// POST /api/ai/scope-improvement
// ---------------------------------------------------------------------------
router.post("/ai/scope-improvement", async (req, res): Promise<void> => {
  const { current, projectContext } = (req.body || {}) as { current?: string; projectContext?: string };
  if (!current) { res.status(400).json({ error: "current is required" }); return; }
  const result = await llm({
    task: "scope_improvement",
    system:
      "You are a PMO scope coach. Improve the given scope statement using SMART principles: split into In-Scope, Out-of-Scope, Assumptions, Constraints. Identify ambiguities. Suggest deliverables. Stay faithful to the original intent.",
    prompt: `${projectContext ? `Project context: ${projectContext}\n\n` : ""}Current scope:\n"""\n${current}\n"""\n`,
    jsonSchema: z.object({
      inScope: z.array(z.string()),
      outOfScope: z.array(z.string()),
      assumptions: z.array(z.string()),
      constraints: z.array(z.string()),
      deliverables: z.array(z.string()),
      ambiguities: z.array(z.string()),
      rewritten: z.string(),
    }),
    jsonSchemaHint: `{ "inScope":[...], "outOfScope":[...], "assumptions":[...], "constraints":[...], "deliverables":[...], "ambiguities":[...], "rewritten":"single-paragraph cleaned version" }`,
    maxTokens: 3000,
  });
  if (!result.ok) return aiError(result.reason, result.message, res);
  res.json(result.data);
});

// ---------------------------------------------------------------------------
// Early-stage helpers — load project + selected stage notes for AI context.
// ---------------------------------------------------------------------------
async function loadProjectContext(projectId: number) {
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) return null;
  const stages = await db.select().from(projectStagesTable).where(eq(projectStagesTable.projectId, projectId));
  const [charter] = await db.select().from(chartersTable).where(eq(chartersTable.projectId, projectId));
  const stageNotes: Record<string, Record<string, unknown>> = {};
  for (const s of stages) {
    try { stageNotes[s.stage] = JSON.parse(s.notes ?? "{}"); } catch { stageNotes[s.stage] = {}; }
  }
  return { project, stages, charter, stageNotes };
}

// ---------------------------------------------------------------------------
// POST /api/ai/demand/draft-idea
// Used by the standalone "New Demand" form BEFORE a project exists.
// Takes whatever the user has typed (name, rough description, sponsor) and
// returns a polished name + one-line description + suggested sponsor role.
// ---------------------------------------------------------------------------
router.post("/ai/demand/draft-idea", async (req, res): Promise<void> => {
  const { name, description, sponsor, hint } = (req.body || {}) as {
    name?: string; description?: string; sponsor?: string; hint?: string;
  };
  const seed = [name, description, sponsor, hint].filter(Boolean).join(" | ").trim();
  if (seed.length < 3) { res.status(400).json({ error: "Provide at least a rough name or description" }); return; }
  const result = await llm({
    task: "demand_draft_idea",
    system:
      "You are a senior PMO Business Analyst at Granules India (an Indian pharmaceuticals manufacturer) helping a colleague capture a new project demand at the very start of governance. Produce a crisp, executive-grade project name, a single-sentence description, and a likely sponsor role. Be specific to what the user typed. Never invent specific people, vendors, dates, or rupee amounts.",
    prompt: `User has typed so far:\nName: ${name ?? "(empty)"}\nDescription: ${description ?? "(empty)"}\nSponsor: ${sponsor ?? "(empty)"}\nExtra hint: ${hint ?? "(none)"}\n\nReturn a polished project name (max 8 words, Title Case), a one-line description (15-30 words, ends with a period), and a suggested sponsor role (e.g. "Head of Manufacturing IT"). Keep it grounded in what the user typed.`,
    jsonSchema: z.object({
      name: z.string().min(3).max(120),
      description: z.string().min(20).max(400),
      sponsor: z.string().min(2).max(120),
    }),
    jsonSchemaHint: `{ "name":"SAP MM Module Upgrade", "description":"Modernise the materials management module to streamline procurement and inventory across the API and FD plants.", "sponsor":"Head of Supply Chain" }`,
    maxTokens: 800,
  });
  if (!result.ok) return aiError(result.reason, result.message, res);
  res.json(result.data);
});

// ---------------------------------------------------------------------------
// POST /api/ai/demand/draft
// ---------------------------------------------------------------------------
router.post("/ai/demand/draft", async (req, res): Promise<void> => {
  const { projectId, hint } = (req.body || {}) as { projectId?: number; hint?: string };
  if (!projectId) { res.status(400).json({ error: "projectId is required" }); return; }
  const ctx = await loadProjectContext(projectId);
  if (!ctx) { res.status(404).json({ error: "Project not found" }); return; }
  const { project, charter } = ctx;
  const result = await llm({
    task: "demand_draft",
    system:
      "You are a senior PMO Business Analyst drafting the Business Case (Demand Initiation) for a new enterprise project at Granules India, an Indian pharmaceuticals manufacturer. Produce realistic, executive-grade first-draft content for each field. Be specific to the project as described. Where numbers appear, mark them illustrative ('e.g.', 'approx.'). Never invent stakeholders, vendors, or hard dates. For capexEstimate and opexEstimate, propose order-of-magnitude rupee figures (whole numbers, no commas) that a sponsor would find plausible for a project of this scope at an Indian pharma manufacturer — these are first-draft placeholders the user will refine.",
    prompt: `Project: ${project.name}\nDescription: ${project.description ?? "(none)"}\nFunction: ${(project as { function?: string }).function ?? "(unspecified)"}\nCharter title: ${charter?.title ?? "(no charter yet)"}\nCharter description: ${charter?.description ?? ""}\nUser hint: ${hint ?? "(none)"}\n\nDraft each text field in 80-180 words, in professional decision-grade tone. Provide plausible CapEx and OpEx rupee estimates.`,
    jsonSchema: z.object({
      businessJustification: z.string().min(100),
      scopeSummary: z.string().min(50),
      expectedOutcomes: z.string().min(20),
      sponsor: z.string().optional(),
      capexEstimate: z.number().nonnegative().optional(),
      opexEstimate: z.number().nonnegative().optional(),
    }),
    jsonSchemaHint: `{ "businessJustification":"...", "scopeSummary":"In-Scope: ...\\nOut-of-Scope: ...", "expectedOutcomes":"- KPI ...\\n- Savings ...", "sponsor":"role / function", "capexEstimate": 2500000, "opexEstimate": 600000 }`,
    maxTokens: 3000,
  });
  if (!result.ok) return aiError(result.reason, result.message, res);
  res.json(result.data);
});

// ---------------------------------------------------------------------------
// POST /api/ai/urs/draft
// ---------------------------------------------------------------------------
router.post("/ai/urs/draft", async (req, res): Promise<void> => {
  const { projectId, hint } = (req.body || {}) as { projectId?: number; hint?: string };
  if (!projectId) { res.status(400).json({ error: "projectId is required" }); return; }
  const ctx = await loadProjectContext(projectId);
  if (!ctx) { res.status(404).json({ error: "Project not found" }); return; }
  const { project, charter, stageNotes } = ctx;
  const demand = (stageNotes.initiation?.__demand_initiation ?? {}) as Record<string, unknown>;
  const result = await llm({
    task: "urs_draft",
    system:
      "You are a senior PMO Business Analyst drafting a User Requirements Specification (URS). Convert business intent into a clear scope and a numbered list of testable functional and non-functional requirements. Be specific. Each requirement must be implementable and verifiable. Avoid vague verbs like 'support' alone — pair with measurable criteria.",
    prompt: `Project: ${project.name}\nDescription: ${project.description ?? ""}\nCharter scope: ${charter?.scope ?? ""}\nCharter deliverables: ${charter?.deliverables ?? ""}\nDemand business justification: ${demand.businessJustification ?? ""}\nDemand scope summary: ${demand.scopeSummary ?? ""}\nDemand expected outcomes: ${demand.expectedOutcomes ?? ""}\nUser hint: ${hint ?? "(none)"}\n\nProduce a URS scope paragraph (120-200 words) AND 10-15 numbered requirements grouped by Functional / Non-Functional / Integration / Security.`,
    jsonSchema: z.object({
      scope: z.string().min(100),
      requirements: z.string().min(100),
    }),
    jsonSchemaHint: `{ "scope":"end-to-end paragraph", "requirements":"FUNCTIONAL\\n1. ...\\n2. ...\\n\\nNON-FUNCTIONAL\\n6. ...\\n\\nINTEGRATION\\n...\\n\\nSECURITY\\n..." }`,
    maxTokens: 3500,
  });
  if (!result.ok) return aiError(result.reason, result.message, res);
  res.json(result.data);
});

// ---------------------------------------------------------------------------
// POST /api/ai/rfp/draft-sections
// ---------------------------------------------------------------------------
router.post("/ai/rfp/draft-sections", async (req, res): Promise<void> => {
  const { projectId } = (req.body || {}) as { projectId?: number };
  if (!projectId) { res.status(400).json({ error: "projectId is required" }); return; }
  const ctx = await loadProjectContext(projectId);
  if (!ctx) { res.status(404).json({ error: "Project not found" }); return; }
  const { project, charter, stageNotes } = ctx;
  const urs = stageNotes.initiation ?? {};
  const demand = (stageNotes.initiation?.__demand_initiation ?? {}) as Record<string, unknown>;
  const result = await llm({
    task: "rfp_draft_sections",
    system:
      "You are a procurement specialist drafting an RFP (Request for Proposal) for an Indian pharmaceuticals company. Produce sharp, vendor-actionable sections. Avoid boilerplate; tie every paragraph back to the specific project context provided.",
    prompt: `Project: ${project.name}\nFunction: ${(project as { function?: string }).function ?? ""}\nCharter scope: ${charter?.scope ?? ""}\nURS scope: ${(urs as { __urs_scope?: string }).__urs_scope ?? ""}\nURS requirements: ${(urs as { __urs_requirements?: string }).__urs_requirements ?? ""}\nDemand outcomes: ${demand.expectedOutcomes ?? ""}\n\nDraft the RFP narrative sections below in professional procurement tone.`,
    jsonSchema: z.object({
      introduction: z.string().min(80),
      scopeOfWork: z.string().min(80),
      proposalRequirements: z.string().min(80),
      evaluationCriteria: z.string().min(80),
      termsAndConditions: z.string().min(80),
    }),
    jsonSchemaHint: `{ "introduction":"...", "scopeOfWork":"...", "proposalRequirements":"(a) ... (b) ... (c) ...", "evaluationCriteria":"Functional fit (40%) ...", "termsAndConditions":"..." }`,
    maxTokens: 3500,
  });
  if (!result.ok) return aiError(result.reason, result.message, res);
  res.json(result.data);
});

// ---------------------------------------------------------------------------
// POST /api/ai/rfp/draft-annexure
// Drafts the *variable* content for the Granules "Annexure — Request for
// Proposal" template (Background, Objective, Scope-of-work rows, Deliverables,
// Success Criteria, Expected Timelines). The boilerplate sections of the
// Annexure (confidentiality preamble, Specific Terms, Instructions for
// Proposal Document, commercial cost template) are fixed and assembled
// client-side in the .docx builder — they are NOT AI-generated.
// ---------------------------------------------------------------------------
router.post("/ai/rfp/draft-annexure", async (req, res): Promise<void> => {
  const { projectId } = (req.body || {}) as { projectId?: number };
  if (!projectId) { res.status(400).json({ error: "projectId is required" }); return; }
  const ctx = await loadProjectContext(projectId);
  if (!ctx) { res.status(404).json({ error: "Project not found" }); return; }
  const { project, charter, stageNotes } = ctx;
  const urs = stageNotes.initiation ?? {};
  const demand = (stageNotes.initiation?.__demand_initiation ?? {}) as Record<string, unknown>;
  const result = await llm({
    task: "rfp_draft_annexure",
    system:
      "You are a senior procurement specialist at Granules India Limited (an Indian pharmaceuticals manufacturer) authoring the variable content of a formal Request for Proposal (RFP) issued to prospective vendors. Write in a precise, professional procurement register. Tie every line to the specific project context supplied — never emit generic boilerplate. Do not invent specific vendor names, individuals, rupee amounts, or calendar dates. The issuing organisation is always Granules India Limited.",
    prompt: `Project: ${project.name}\nFunction: ${(project as { function?: string }).function ?? ""}\nProject description: ${project.description ?? ""}\nCharter scope: ${charter?.scope ?? ""}\nCharter deliverables: ${charter?.deliverables ?? ""}\nURS scope: ${(urs as { __urs_scope?: string }).__urs_scope ?? ""}\nURS requirements: ${(urs as { __urs_requirements?: string }).__urs_requirements ?? ""}\nDemand business justification: ${demand.businessJustification ?? ""}\nDemand expected outcomes: ${demand.expectedOutcomes ?? ""}\n\nDraft the variable sections of the Granules RFP Annexure for this project.`,
    jsonSchema: z.object({
      title: z.string().min(3).max(160),
      background: z.string().min(80),
      objective: z.string().min(60),
      scopeOfWork: z.array(z.object({
        requirement: z.string().min(3),
        description: z.string().min(10),
      })).min(3).max(12),
      deliverables: z.string().min(60),
      successCriteria: z.string().min(60),
      expectedTimelines: z.string().min(40),
    }),
    jsonSchemaHint: `{ "title":"<short project title for the RFP cover>", "background":"2-4 sentence project context", "objective":"what this engagement must achieve", "scopeOfWork":[{"requirement":"<short label>","description":"<what the vendor must do>"}], "deliverables":"newline-separated list of concrete deliverables", "successCriteria":"how success will be measured", "expectedTimelines":"narrative + key milestones; mention indicative durations, never fixed calendar dates" }`,
    maxTokens: 4000,
  });
  if (!result.ok) return aiError(result.reason, result.message, res);
  res.json(result.data);
});

// ---------------------------------------------------------------------------
// POST /api/ai/vendors/score
// ---------------------------------------------------------------------------
router.post("/ai/vendors/score", async (req, res): Promise<void> => {
  const { projectId, vendorName, vendorNotes } = (req.body || {}) as { projectId?: number; vendorName?: string; vendorNotes?: string };
  if (!projectId || !vendorName) { res.status(400).json({ error: "projectId and vendorName are required" }); return; }
  const ctx = await loadProjectContext(projectId);
  if (!ctx) { res.status(404).json({ error: "Project not found" }); return; }
  const { project, charter, stageNotes } = ctx;
  const urs = stageNotes.initiation ?? {};
  const result = await llm({
    task: "vendor_score_suggest",
    system:
      "You are an evaluation committee assistant scoring a vendor proposal against a URS. Score four criteria 0-100: Functional Fit to URS, Technical Architecture, Commercial Competitiveness, Vendor Track Record. Return scores AND a 1-2 sentence rationale each. Be honest — do NOT default everything to 70+. If information is missing, score conservatively and say so in the rationale.",
    prompt: `Project: ${project.name}\nCharter scope: ${charter?.scope ?? ""}\nURS scope: ${(urs as { __urs_scope?: string }).__urs_scope ?? ""}\nURS requirements: ${(urs as { __urs_requirements?: string }).__urs_requirements ?? ""}\n\nVendor under evaluation: ${vendorName}\nVendor proposal notes / known info: ${vendorNotes ?? "(none provided — score conservatively)"}\n`,
    jsonSchema: z.object({
      functional: z.number().min(0).max(100),
      technical: z.number().min(0).max(100),
      commercial: z.number().min(0).max(100),
      track_record: z.number().min(0).max(100),
      rationale: z.object({
        functional: z.string(),
        technical: z.string(),
        commercial: z.string(),
        track_record: z.string(),
      }),
      overallNote: z.string(),
    }),
    jsonSchemaHint: `{ "functional":75, "technical":70, "commercial":65, "track_record":60, "rationale":{ "functional":"...", "technical":"...", "commercial":"...", "track_record":"..." }, "overallNote":"summary recommendation" }`,
    maxTokens: 2500,
  });
  if (!result.ok) return aiError(result.reason, result.message, res);
  res.json(result.data);
});

// ---------------------------------------------------------------------------
// POST /api/ai/vendors/suggest-list
// Suggest 3-5 sample vendors based on URS scope so the user can populate the
// shortlist quickly for testing. Returned vendors are illustrative only.
// ---------------------------------------------------------------------------
router.post("/ai/vendors/suggest-list", async (req, res): Promise<void> => {
  const { projectId } = (req.body || {}) as { projectId?: number };
  if (!projectId) { res.status(400).json({ error: "projectId is required" }); return; }
  const ctx = await loadProjectContext(projectId);
  if (!ctx) { res.status(404).json({ error: "Project not found" }); return; }
  const { project, charter, stageNotes } = ctx;
  const urs = stageNotes.initiation ?? {};
  const result = await llm({
    task: "vendor_suggest_list",
    system:
      "You are a procurement analyst familiar with the Indian and global vendor landscape for enterprise software, pharma, manufacturing, and digital transformation projects. Given a project's URS scope, suggest 3-5 realistic vendors who could plausibly respond to this RFP. Mix well-known names with credible niche players. Each vendor: a plausible short description, a realistic website host, a sample contact line, indicative pricing in Indian context (Lakh/Crore), and a one-line strengths note. Mark them as ILLUSTRATIVE in the description so users know they are sample data.",
    prompt: `Project: ${project.name}\nFunction: ${(project as { function?: string }).function ?? ""}\nCharter scope: ${charter?.scope ?? ""}\nURS scope: ${(urs as { __urs_scope?: string }).__urs_scope ?? ""}\nURS requirements: ${(urs as { __urs_requirements?: string }).__urs_requirements ?? ""}\n\nSuggest 3-5 vendors who could realistically respond.`,
    jsonSchema: z.object({
      vendors: z.array(z.object({
        name: z.string().min(2),
        description: z.string(),
        contact: z.string().optional(),
        website: z.string().optional(),
        pricing: z.string().optional(),
        notes: z.string().optional(),
      })).min(1).max(8),
    }),
    jsonSchemaHint: `{ "vendors": [ { "name":"Acme ERP", "description":"ILLUSTRATIVE — mid-market ERP …", "contact":"sales@acme.com", "website":"acme.com", "pricing":"₹40-60L CapEx + ₹8L/yr AMC", "notes":"strong in pharma" } ] }`,
    maxTokens: 2000,
  });
  if (!result.ok) return aiError(result.reason, result.message, res);
  res.json(result.data);
});

// ---------------------------------------------------------------------------
// POST /api/ai/vendors/suggest-dimensions
// Suggest additional evaluation dimensions (technical + commercial) tailored
// to the project's URS, on top of what the user already has.
// ---------------------------------------------------------------------------
router.post("/ai/vendors/suggest-dimensions", async (req, res): Promise<void> => {
  const { projectId, existing } = (req.body || {}) as { projectId?: number; existing?: string[] };
  if (!projectId) { res.status(400).json({ error: "projectId is required" }); return; }
  const ctx = await loadProjectContext(projectId);
  if (!ctx) { res.status(404).json({ error: "Project not found" }); return; }
  const { project, charter, stageNotes } = ctx;
  const urs = stageNotes.initiation ?? {};
  const result = await llm({
    task: "vendor_suggest_dimensions",
    system:
      "You are an evaluation committee assistant designing a vendor-scoring matrix. Suggest 3-6 evaluation dimensions tailored to the project's URS. Mix technical dimensions (architecture, integration, security, data migration, scalability) with commercial dimensions (TCO, payment terms, vendor stability, support SLAs, training). Avoid duplicating dimensions the user already has. Each dimension: a short label, kind (technical|commercial), a weight 5-30, and a one-line description of how to judge it.",
    prompt: `Project: ${project.name}\nFunction: ${(project as { function?: string }).function ?? ""}\nCharter scope: ${charter?.scope ?? ""}\nURS scope: ${(urs as { __urs_scope?: string }).__urs_scope ?? ""}\nURS requirements: ${(urs as { __urs_requirements?: string }).__urs_requirements ?? ""}\n\nExisting dimensions (do not duplicate): ${(existing ?? []).join(", ") || "(none)"}\n\nSuggest 3-6 additional dimensions.`,
    jsonSchema: z.object({
      dimensions: z.array(z.object({
        label: z.string().min(3),
        kind: z.enum(["technical", "commercial"]),
        weight: z.number().min(1).max(50),
        description: z.string().optional(),
      })).min(1).max(8),
    }),
    jsonSchemaHint: `{ "dimensions":[ { "label":"Data Migration Readiness", "kind":"technical", "weight":10, "description":"…" } ] }`,
    maxTokens: 1500,
  });
  if (!result.ok) return aiError(result.reason, result.message, res);
  res.json(result.data);
});

// ---------------------------------------------------------------------------
// POST /api/ai/vendors/score-matrix
// Score a single vendor against a caller-supplied list of evaluation
// dimensions (technical + commercial). Returns scores keyed by dimension id.
// ---------------------------------------------------------------------------
router.post("/ai/vendors/score-matrix", async (req, res): Promise<void> => {
  const { projectId, vendorName, vendorNotes, dimensions } = (req.body || {}) as {
    projectId?: number;
    vendorName?: string;
    vendorNotes?: string;
    dimensions?: Array<{ id: string; label: string; kind: string; weight: number; description?: string }>;
  };
  if (!projectId || !vendorName) { res.status(400).json({ error: "projectId and vendorName are required" }); return; }
  if (!dimensions || dimensions.length === 0) { res.status(400).json({ error: "dimensions array is required" }); return; }
  const ctx = await loadProjectContext(projectId);
  if (!ctx) { res.status(404).json({ error: "Project not found" }); return; }
  const { project, charter, stageNotes } = ctx;
  const urs = stageNotes.initiation ?? {};
  const dimLines = dimensions.map((d, i) =>
    `${i + 1}. [${d.id}] ${d.label} (${d.kind}, weight ${d.weight}%) — ${d.description ?? "(no description)"}`,
  ).join("\n");
  const result = await llm({
    task: "vendor_score_matrix",
    system:
      "You are an evaluation committee assistant scoring a single vendor against a custom matrix of evaluation dimensions. For EACH dimension supplied, return a score 0-100 and a 1-2 sentence rationale. Be honest — if information is missing, score conservatively and say so. Do not default everything to 70+.",
    prompt: `Project: ${project.name}\nCharter scope: ${charter?.scope ?? ""}\nURS scope: ${(urs as { __urs_scope?: string }).__urs_scope ?? ""}\nURS requirements: ${(urs as { __urs_requirements?: string }).__urs_requirements ?? ""}\n\nVendor under evaluation: ${vendorName}\nVendor info: ${vendorNotes ?? "(none — score conservatively)"}\n\nDimensions to score:\n${dimLines}\n\nReturn JSON with scores and rationale keyed by dimension id.`,
    jsonSchema: z.object({
      scores: z.record(z.string(), z.number().min(0).max(100)),
      rationale: z.record(z.string(), z.string()),
      overallNote: z.string(),
    }),
    jsonSchemaHint: `{ "scores":{ "d_functional":72, "d_technical":65 }, "rationale":{ "d_functional":"…", "d_technical":"…" }, "overallNote":"…" }`,
    maxTokens: 2500,
  });
  if (!result.ok) return aiError(result.reason, result.message, res);
  res.json(result.data);
});

// ---------------------------------------------------------------------------
// POST /api/ai/vendors/insights
// Comparative insights across all vendors: who is strongest, what URS gaps
// remain, what each vendor offers/misses, and a recommendation.
// ---------------------------------------------------------------------------
router.post("/ai/vendors/insights", async (req, res): Promise<void> => {
  const { projectId, vendors, dimensions, scores } = (req.body || {}) as {
    projectId?: number;
    vendors?: Array<{ id: string; name: string; description?: string; notes?: string; pricing?: string }>;
    dimensions?: Array<{ id: string; label: string; kind: string; weight: number; description?: string }>;
    scores?: Record<string, Record<string, number>>;
  };
  if (!projectId) { res.status(400).json({ error: "projectId is required" }); return; }
  if (!vendors || vendors.length === 0) { res.status(400).json({ error: "vendors array is required" }); return; }
  if (!dimensions || dimensions.length === 0) { res.status(400).json({ error: "dimensions array is required" }); return; }
  const ctx = await loadProjectContext(projectId);
  if (!ctx) { res.status(404).json({ error: "Project not found" }); return; }
  const { project, charter, stageNotes } = ctx;
  const urs = stageNotes.initiation ?? {};

  const vendorLines = vendors.map((v) => {
    const s = scores?.[v.id] ?? {};
    const scoreLine = dimensions.map((d) => `${d.label}=${s[d.id] ?? "—"}`).join(", ");
    return `- [${v.id}] ${v.name}\n  Info: ${v.description ?? ""} ${v.notes ?? ""}\n  Pricing: ${v.pricing ?? "n/a"}\n  Scores: ${scoreLine}`;
  }).join("\n");

  const result = await llm({
    task: "vendor_insights",
    system:
      "You are an evaluation committee assistant producing comparative insights across multiple vendors. Identify the strongest and weakest vendor by weighted score AND by URS fit. Flag gaps where NO vendor covers a URS requirement. For each vendor, summarise what they offer well and what they miss. Finish with a concrete recommendation: which vendor to pick, OR which vendor to ask follow-up questions of, OR whether the shortlist needs to be expanded.",
    prompt: `Project: ${project.name}\nCharter scope: ${charter?.scope ?? ""}\nURS scope: ${(urs as { __urs_scope?: string }).__urs_scope ?? ""}\nURS requirements: ${(urs as { __urs_requirements?: string }).__urs_requirements ?? ""}\n\nDimensions:\n${dimensions.map((d) => `- ${d.label} (${d.kind}, weight ${d.weight}%) — ${d.description ?? ""}`).join("\n")}\n\nVendors:\n${vendorLines}\n\nGenerate comparative insights.`,
    jsonSchema: z.object({
      strongest: z.string(),
      weakest: z.string(),
      gaps: z.array(z.string()),
      recommendation: z.string(),
      perVendor: z.array(z.object({
        vendorId: z.string(),
        whatTheyOffer: z.string(),
        whatTheyMiss: z.string(),
      })),
    }),
    jsonSchemaHint: `{ "strongest":"Acme — strong functional + commercial", "weakest":"Beta — thin track record", "gaps":["No vendor addresses GxP audit logging"], "recommendation":"Pick Acme; ask Beta for clarifications on …", "perVendor":[ { "vendorId":"v_abc", "whatTheyOffer":"…", "whatTheyMiss":"…" } ] }`,
    maxTokens: 3000,
  });
  if (!result.ok) return aiError(result.reason, result.message, res);
  res.json(result.data);
});

// ---------------------------------------------------------------------------
// POST /api/ai/nfa/draft
// ---------------------------------------------------------------------------
router.post("/ai/nfa/draft", async (req, res): Promise<void> => {
  const { projectId, amount } = (req.body || {}) as { projectId?: number; amount?: number };
  if (!projectId) { res.status(400).json({ error: "projectId is required" }); return; }
  const ctx = await loadProjectContext(projectId);
  if (!ctx) { res.status(404).json({ error: "Project not found" }); return; }
  const { project, charter, stageNotes } = ctx;
  const demand = (stageNotes.initiation?.__demand_initiation ?? {}) as Record<string, unknown>;
  const vendor = (stageNotes.vendor_evaluation ?? {}) as Record<string, unknown>;
  const result = await llm({
    task: "nfa_draft",
    system:
      "You are a Finance Business Partner drafting an NFA (Note for Approval) at Granules India. The NFA is presented to Finance Head, PMO, Department Head and Chairman/MD. Tone: factual, executive, financially literate. Always tie spend back to business outcomes.",
    prompt: `Project: ${project.name}\nFunction: ${(project as { function?: string }).function ?? ""}\nCharter description: ${charter?.description ?? ""}\nCharter expected benefits: ${charter?.toplineImprovement ?? ""} / ${charter?.bottomLineOptimization ?? ""}\nDemand justification: ${demand.businessJustification ?? ""}\nDemand expected outcomes: ${demand.expectedOutcomes ?? ""}\nSelected vendor: ${(vendor as { __vendor_name?: string }).__vendor_name ?? "(not yet selected)"}\nAmount requested: INR ${amount ?? 0}\n\nDraft the four NFA narrative sections below.`,
    jsonSchema: z.object({
      executiveSummary: z.string().min(80),
      businessJustification: z.string().min(80),
      financialImpact: z.string().min(80),
      riskAndMitigation: z.string().min(80),
    }),
    jsonSchemaHint: `{ "executiveSummary":"2-3 lines", "businessJustification":"why this spend", "financialImpact":"CapEx/OpEx/payback", "riskAndMitigation":"top risks + controls" }`,
    maxTokens: 3000,
  });
  if (!result.ok) return aiError(result.reason, result.message, res);
  res.json(result.data);
});

// ---------------------------------------------------------------------------
// POST /api/ai/nfa/draft-from-brief
// Standalone NFA initiator helper — turns a free-text brief (and optional
// linked project) into the structured note fields the /nfas form binds to.
// ---------------------------------------------------------------------------
router.post("/ai/nfa/draft-from-brief", async (req, res): Promise<void> => {
  const { brief, projectId } = (req.body || {}) as { brief?: string; projectId?: number };
  if (!brief || brief.trim().length < 10) { res.status(400).json({ error: "brief is required (min 10 chars)" }); return; }

  let projectLine = "";
  if (projectId) {
    const ctx = await loadProjectContext(projectId);
    if (ctx) projectLine = `Linked project: ${ctx.project.name}\nCharter description: ${ctx.charter?.description ?? ""}\n`;
  }

  const result = await llm({
    task: "nfa_draft_from_brief",
    system:
      "You are a Finance Business Partner at Granules India drafting an Internal Approval Note (NFA). Convert the requester's brief into a structured, executive note. Tone: factual, financially literate, concise. Never invent specific amounts the brief doesn't support — leave costing blank if unknown. Tie spend to a business outcome.",
    prompt: `${projectLine}Requester brief:\n"""\n${brief.trim()}\n"""\n\nProduce the structured NFA fields.`,
    jsonSchema: z.object({
      subject: z.string().min(5),
      background: z.string().min(40),
      requirementItems: z.array(z.object({ item: z.string(), details: z.string() })).min(1),
      orderFormNote: z.string(),
      recommendation: z.string().min(30),
    }),
    jsonSchemaHint: `{ "subject":"one-line subject", "background":"why this is needed", "requirementItems":[{"item":"Platform Fee","details":"..."}], "orderFormNote":"attachment/order-form context or ''", "recommendation":"recommended action" }`,
    maxTokens: 3000,
  });
  if (!result.ok) return aiError(result.reason, result.message, res);
  res.json(result.data);
});

// ---------------------------------------------------------------------------
// POST /api/ai/nfa/extract-fields
// Pulls the structured e-NFA basics actually present in an uploaded reference
// document / email so mandatory fields auto-fill from the source. Extraction
// only: never invents; absent fields are omitted.
// ---------------------------------------------------------------------------
router.post("/ai/nfa/extract-fields", async (req, res): Promise<void> => {
  const { sourceText } = (req.body || {}) as { sourceText?: string };
  if (!sourceText || sourceText.trim().length < 20) { res.json({}); return; }
  const result = await llm({
    task: "nfa_extract_fields",
    system:
      "You extract structured e-NFA (internal approval note) fields from a source document or email. Return ONLY values explicitly stated or unambiguously implied. If a field is not present, OMIT it — never guess or invent. Map free text to an allowed enum option only when it clearly matches; otherwise omit.",
    prompt: `Source document (treat as the only source of truth):\n"""\n${sourceText.slice(0, MAX_DOC_TEXT_CHARS)}\n"""\n\nExtract any of these that the document provides:\n- subject: the note's subject / what is being approved\n- functionDept: owning function / department\n- modeOfProcurement: ONE of [Limited Tender, Open Tender, Single Source, Repeat Order, Rate Contract, Direct Purchase]\n- financialAmount: the spend amount as written (with currency)\n- background: 1-3 sentence background of the request drawn from the document\nOmit any field the document does not clearly provide.`,
    jsonSchema: z.object({
      subject: z.string().optional(),
      functionDept: z.string().optional(),
      modeOfProcurement: z.string().optional(),
      financialAmount: z.string().optional(),
      background: z.string().optional(),
    }),
    jsonSchemaHint: `{ "subject":"...", "functionDept":"...", "modeOfProcurement":"Limited Tender", "financialAmount":"INR 12,00,000", "background":"..." }`,
    maxTokens: 1000,
  });
  if (!result.ok) return aiError(result.reason, result.message, res);
  res.json(result.data);
});

// ---------------------------------------------------------------------------
// POST /api/ai/nfa/draft-template
// Drafts the corporate e-NFA template fields (nfa-new single-page form) from a
// short subject/brief plus optional function & mode. Returns every long-form
// section the form binds to (background, requirements, justification, vendor
// details, mode of procurement, financial implication, recommendation).
// ---------------------------------------------------------------------------
router.post("/ai/nfa/draft-template", async (req, res): Promise<void> => {
  const {
    subject,
    functionDept,
    modeOfProcurement,
    financialAmount,
    hint,
    sourceText,
  } = (req.body || {}) as {
    subject?: string;
    functionDept?: string;
    modeOfProcurement?: string;
    financialAmount?: number;
    hint?: string;
    sourceText?: string;
  };
  if (!subject || subject.trim().length < 3) {
    res.status(400).json({ error: "subject is required" });
    return;
  }
  const result = await llm({
    task: "nfa_draft_template",
    system:
      "You are a Finance Business Partner at Granules India drafting an Internal Approval Note (e-NFA) for a procurement / spend approval. Convert the given subject (and optional function, mode of procurement, amount, hint) into a structured, executive e-NFA. Tone: factual, financially literate, concise. Never invent specific amounts the inputs don't support — describe the financial implication qualitatively if no amount is given. Never invent real vendor names — describe vendor selection approach generically (e.g. 'shortlist of 3 OEM-authorised vendors').",
    prompt: `Subject: ${subject}\nFunction / Department: ${functionDept || "(unspecified)"}\nMode of procurement: ${modeOfProcurement || "(unspecified)"}\nApprox. amount: ${financialAmount ? `INR ${financialAmount}` : "(unspecified)"}\nHint: ${hint || "(none)"}${sourceText ? `\n\nReference document (extracted from an uploaded source — treat as ground truth; incorporate the relevant facts, do not copy verbatim):\n${sourceText.slice(0, MAX_DOC_TEXT_CHARS)}` : ""}\n\nDraft each e-NFA section. Background 60-150 words; other sections 30-100 words.`,
    jsonSchema: z.object({
      background: z.string().min(40),
      requirements: z.string().min(20),
      justification: z.string().min(30),
      vendorDetails: z.string().optional(),
      modeOfProcurement: z.string().optional(),
      financialImplication: z.string().min(20),
      recommendation: z.string().min(20),
    }),
    jsonSchemaHint: `{ "background":"why this is needed", "requirements":"procurement details / line items", "justification":"why this spend is justified", "vendorDetails":"vendor selection approach", "modeOfProcurement":"e.g. Limited tender / Single source", "financialImplication":"cost framing", "recommendation":"recommended action" }`,
    maxTokens: 3000,
  });
  if (!result.ok) return aiError(result.reason, result.message, res);
  res.json(result.data);
});

// ---------------------------------------------------------------------------
// POST /api/ai/kickoff/agenda
// ---------------------------------------------------------------------------
router.post("/ai/kickoff/agenda", async (req, res): Promise<void> => {
  const { projectId } = (req.body || {}) as { projectId?: number };
  if (!projectId) { res.status(400).json({ error: "projectId is required" }); return; }
  const ctx = await loadProjectContext(projectId);
  if (!ctx) { res.status(404).json({ error: "Project not found" }); return; }
  const { project, charter } = ctx;
  const result = await llm({
    task: "kickoff_agenda",
    system:
      "You are a PMO chief of staff preparing a project kickoff meeting agenda and suggested attendee list for an Indian pharmaceuticals company. Produce a tight, time-boxed 60-minute agenda and a realistic role-based attendee list. Use Indian corporate role titles (HOD, GM, Finance Head, IT Lead, etc.).",
    prompt: `Project: ${project.name}\nFunction: ${(project as { function?: string }).function ?? ""}\nDescription: ${project.description ?? ""}\nCharter scope: ${charter?.scope ?? ""}\nCharter deliverables: ${charter?.deliverables ?? ""}\n`,
    jsonSchema: z.object({
      agendaItems: z.array(z.object({ minutes: z.number(), title: z.string(), owner: z.string() })).min(5),
      suggestedAttendees: z.array(z.object({ name: z.string(), dept: z.string(), role: z.string() })).min(5),
      openingRemarks: z.string(),
    }),
    jsonSchemaHint: `{ "agendaItems":[{"minutes":5,"title":"Welcome & Objectives","owner":"Project Sponsor"}, ...], "suggestedAttendees":[{"name":"<role>","dept":"<Dept>","role":"Sponsor"}], "openingRemarks":"2-3 sentences" }`,
    maxTokens: 2500,
  });
  if (!result.ok) return aiError(result.reason, result.message, res);
  res.json(result.data);
});

// ---------------------------------------------------------------------------
// POST /api/ai/pif/draft-from-idea
// Mirror of /ai/demand/draft-idea but produces a full PIF (Project Initiation
// Form) payload — title, problem, solution, outcomes, metrics, ballpark
// cost/duration, top risks. Used by the "Draft with AI" CTA on /pifs/new
// before a PIF row exists.
// ---------------------------------------------------------------------------
router.post("/ai/pif/draft-from-idea", async (req, res): Promise<void> => {
  const { ideaText, hint } = (req.body || {}) as { ideaText?: string; hint?: string };
  if (!ideaText || ideaText.trim().length < 10) {
    res.status(400).json({ error: "ideaText is required (min 10 chars)" });
    return;
  }
  const result = await llm({
    task: "pif_draft_from_idea",
    system:
      "You are a senior PMO Business Analyst at Granules India (an Indian pharmaceuticals manufacturer). A colleague has typed a raw project idea and you must structure it into a full Project Initiation Form (PIF) draft. Be concrete and grounded in what was typed — never invent specific people, vendors, dates, or rupee amounts. Where numbers appear, mark them illustrative. Use Indian corporate context (HOD, GM, plant, function).",
    prompt: `Raw idea:\n"""\n${ideaText}\n"""\n${hint ? `\nExtra hint: ${hint}\n` : ""}\nProduce a complete PIF with: a polished title (Title Case, max 10 words), a 60-120 word business problem statement, a 60-150 word proposed solution, 3-5 target outcomes (each one short sentence), 3-5 success metrics (each measurable, e.g. "Reduce changeover time by 30%"), 2-4 likely dependencies, 2-4 top risks, ballpark estimated CapEx and OpEx in INR (whole numbers), estimated duration in days, and a one-word urgency level (low/normal/high/critical).`,
    jsonSchema: z.object({
      title: z.string().min(5).max(120),
      businessProblem: z.string().min(60),
      proposedSolution: z.string().min(60),
      targetOutcomes: z.array(z.string().min(5)).min(3).max(8),
      successMetrics: z.array(z.string().min(5)).min(3).max(8),
      dependencies: z.array(z.string().min(3)).max(8),
      topRisks: z.array(z.string().min(5)).max(8),
      estimatedCapex: z.number().nonnegative().optional(),
      estimatedOpex: z.number().nonnegative().optional(),
      estimatedDurationDays: z.number().int().positive().optional(),
      urgency: z.enum(["low", "normal", "high", "critical"]).optional(),
    }),
    jsonSchemaHint: `{ "title":"ERP Upgrade for FD Plant", "businessProblem":"…60-120 words…", "proposedSolution":"…", "targetOutcomes":["Faster month-end close","..."], "successMetrics":["Close cycle <3 days","..."], "dependencies":["IT bandwidth","Vendor selection"], "topRisks":["Data migration quality","User adoption"], "estimatedCapex": 8000000, "estimatedOpex": 1500000, "estimatedDurationDays": 240, "urgency":"normal" }`,
    maxTokens: 3500,
  });
  if (!result.ok) return aiError(result.reason, result.message, res);
  res.json(result.data);
});

// ---------------------------------------------------------------------------
// POST /api/ai/pif/critique
// Flags weak / missing fields in an existing PIF (vague business case, no
// measurable metrics, no risks called out) so the initiator can tighten the
// draft before HOD review.
// ---------------------------------------------------------------------------
router.post("/ai/pif/critique", async (req, res): Promise<void> => {
  const { pifId } = (req.body || {}) as { pifId?: number };
  if (!pifId) { res.status(400).json({ error: "pifId is required" }); return; }
  const [pif] = await db.select().from(pifsTable).where(eq(pifsTable.id, pifId));
  if (!pif) { res.status(404).json({ error: "PIF not found" }); return; }

  const result = await llm({
    task: "pif_critique",
    system:
      "You are a critical PMO reviewer. Read a Project Initiation Form and call out concrete gaps that would weaken HOD sign-off. Be direct and specific — point at the actual text. Score each section out of 5 (1=barely usable, 5=executive-ready). No filler praise.",
    prompt: `PIF to critique:\n${JSON.stringify({
      title: pif.title,
      businessProblem: pif.businessProblem,
      proposedSolution: pif.proposedSolution,
      targetOutcomes: pif.targetOutcomes,
      successMetrics: pif.successMetrics,
      dependencies: pif.dependencies,
      topRisks: pif.topRisks,
      estimatedCapex: pif.estimatedCapex,
      estimatedOpex: pif.estimatedOpex,
      estimatedDurationDays: pif.estimatedDurationDays,
      classification: pif.classification,
      urgency: pif.urgency,
    }, null, 2)}`,
    jsonSchema: z.object({
      overallScore: z.number().min(1).max(5),
      readyForHod: z.boolean(),
      sectionScores: z.object({
        businessProblem: z.number().min(1).max(5),
        proposedSolution: z.number().min(1).max(5),
        targetOutcomes: z.number().min(1).max(5),
        successMetrics: z.number().min(1).max(5),
        risks: z.number().min(1).max(5),
        estimates: z.number().min(1).max(5),
      }),
      gaps: z.array(z.string().min(5)).min(1),
      suggestedEdits: z.array(z.string().min(5)).max(8),
    }),
    jsonSchemaHint: `{ "overallScore": 3, "readyForHod": false, "sectionScores": {...}, "gaps":["Success metrics are not measurable — quantify each.","Top risks omit regulatory exposure."], "suggestedEdits":["Replace 'improve efficiency' with '%-based KPI'..."] }`,
    maxTokens: 2500,
  });
  if (!result.ok) return aiError(result.reason, result.message, res);
  res.json(result.data);
});

// ---------------------------------------------------------------------------
// POST /api/ai/vendors/extract-document
// Claude reads a vendor-uploaded registration / financial / KYC document and
// pre-fills the master profile fields. The frontend sends the raw extracted
// text (from a PDF-to-text pass it already does); we never send the binary.
// ---------------------------------------------------------------------------
router.post("/ai/vendors/extract-document", async (req, res): Promise<void> => {
  const { documentText, hint } = (req.body || {}) as { documentText?: string; hint?: string };
  if (!documentText || documentText.trim().length < 20) {
    res.status(400).json({ error: "documentText is required" }); return;
  }
  const result = await llm({
    task: "vendor_doc_extract",
    system:
      "You are a procurement KYC analyst. Read the supplied vendor document and extract structured profile fields. Never invent data — if a field isn't present, return null for it.",
    prompt: `Hint: ${hint ?? "Generic"}\n\nDocument text (truncated to first 8000 chars):\n"""\n${documentText.slice(0, 8000)}\n"""`,
    jsonSchema: z.object({
      name: z.string().nullable(),
      legalName: z.string().nullable(),
      gst: z.string().nullable(),
      pan: z.string().nullable(),
      country: z.string().nullable(),
      region: z.string().nullable(),
      address: z.string().nullable(),
      email: z.string().nullable(),
      phone: z.string().nullable(),
      website: z.string().nullable(),
      category: z.string().nullable(),
      notes: z.string().nullable(),
    }),
    jsonSchemaHint: `{ "name": "Acme Pvt Ltd", "legalName": "Acme Private Limited", "gst": "29ABCDE1234F1Z5", "pan": "ABCDE1234F", "country": "IN", "region": "Karnataka", "address": "...", "email": "info@acme.com", "phone": "+91...", "website": "acme.com", "category": "API supplier", "notes": null }`,
    maxTokens: 1500,
  });
  if (!result.ok) return aiError(result.reason, result.message, res);
  res.json(result.data);
});

// ---------------------------------------------------------------------------
// POST /api/ai/rfx/:id/draft-questions
// Suggest a balanced tech + commercial question bank for an RFx given the
// brief. Author can accept-all, merge, or edit. Output matches the shape
// PUT /api/rfx/:id/questions accepts.
// ---------------------------------------------------------------------------
router.post("/ai/rfx/draft-questions", async (req, res): Promise<void> => {
  const { brief, type = "rfp", focusAreas } = (req.body || {}) as {
    brief?: string; type?: string; focusAreas?: string[];
  };
  if (!brief || brief.trim().length < 30) {
    res.status(400).json({ error: "brief is required (min 30 chars)" }); return;
  }
  const result = await llm({
    task: "rfx_draft_questions",
    system:
      "You are an enterprise SCM analyst. Draft a question bank that lets a vendor answer cleanly in two envelopes: a technical envelope (capability, approach, compliance) and a commercial envelope (price, payment terms, TCO). Qualification questions go outside both envelopes and are visible from invitation acceptance.",
    prompt: `RFx type: ${type}\nFocus areas: ${(focusAreas ?? []).join(", ") || "general"}\n\nBrief:\n"""\n${brief}\n"""\n\nReturn 8-15 questions total. Avoid yes/no unless commercial-binary (eg. "Are you GST registered").`,
    jsonSchema: z.object({
      questions: z.array(z.object({
        section: z.enum(["technical", "commercial", "qualification"]),
        label: z.string().min(5),
        description: z.string().optional(),
        kind: z.enum(["text", "number", "select", "multi", "file", "bool", "currency"]),
        options: z.array(z.string()).optional(),
        weight: z.number().int().min(0).max(20).optional(),
        required: z.boolean().optional(),
      })).min(4).max(20),
    }),
    jsonSchemaHint: `{ "questions": [ { "section":"qualification","label":"Are you GST registered?","kind":"bool","required":true }, { "section":"technical","label":"Describe your manufacturing capacity","kind":"text","weight":10 }, { "section":"commercial","label":"Unit price (INR)","kind":"currency","weight":15 } ] }`,
    maxTokens: 2500,
  });
  if (!result.ok) return aiError(result.reason, result.message, res);
  res.json(result.data);
});

// ---------------------------------------------------------------------------
// POST /api/ai/vendors/:id/risk-summary
// Roll up known risk events + KPI history into a 3-sentence summary + a
// recommended risk_status (green/amber/red). Used in vendor 360 and the
// admin segment-decision modal.
// ---------------------------------------------------------------------------
router.post("/ai/vendors/risk-summary", async (req, res): Promise<void> => {
  const { vendorName, riskEvents, kpis, segment } = (req.body || {}) as {
    vendorName?: string;
    riskEvents?: Array<{ source: string; severity: string; summary: string; createdAt?: string }>;
    kpis?: Array<{ period: string; compositeScore?: number | null }>;
    segment?: string;
  };
  if (!vendorName) { res.status(400).json({ error: "vendorName is required" }); return; }
  const result = await llm({
    task: "vendor_risk_summary",
    system:
      "You are a procurement risk analyst. Given a vendor's known risk events and KPI history, write a 3-sentence summary and recommend a rolled-up risk status. Be specific; cite the strongest signal driving the recommendation.",
    prompt: `Vendor: ${vendorName}\nCurrent segment: ${segment ?? "unknown"}\n\nRisk events:\n${JSON.stringify(riskEvents ?? [], null, 2)}\n\nKPI history:\n${JSON.stringify(kpis ?? [], null, 2)}`,
    jsonSchema: z.object({
      summary: z.string().min(20),
      recommendedRiskStatus: z.enum(["green", "amber", "red"]),
      drivers: z.array(z.string()).max(5),
    }),
    jsonSchemaHint: `{ "summary": "...", "recommendedRiskStatus":"amber", "drivers":["Two missed deliveries in last quarter","Recent ESG audit flagged a labor concern"] }`,
    maxTokens: 1200,
  });
  if (!result.ok) return aiError(result.reason, result.message, res);
  res.json(result.data);
});

// ---------------------------------------------------------------------------
// POST /api/ai/rfx/:id/award-scenarios
// Model multiple award scenarios (single winner / split / phased) from the
// supplied tech + commercial scores + TCO components. Output is consumed by
// the Award Analysis tab so the user can pick a scenario, edit, and submit.
// ---------------------------------------------------------------------------
router.post("/ai/rfx/award-scenarios", async (req, res): Promise<void> => {
  const { vendors, dimensions, scores, tcoModel, currency = "INR" } = (req.body || {}) as {
    vendors?: Array<{ id: number; name: string; segment?: string }>;
    dimensions?: Array<{ id: number; label: string; kind: string; weight: number }>;
    scores?: Array<{ envelopeId: number; dimensionId: number; score: number; vendorId?: number }>;
    tcoModel?: Record<string, unknown>;
    currency?: string;
  };
  if (!vendors || vendors.length === 0) {
    res.status(400).json({ error: "vendors are required" }); return;
  }
  const result = await llm({
    task: "rfx_award_scenarios",
    system:
      "You are a senior SCM strategist. Given the tech + commercial scores and the TCO model, propose 2-3 distinct award scenarios. For each: name, brief rationale, per-vendor share_pct (must sum to 100), and an indicative total-cost figure if computable.",
    prompt: `Currency: ${currency}\nVendors:\n${JSON.stringify(vendors, null, 2)}\n\nDimensions:\n${JSON.stringify(dimensions ?? [], null, 2)}\n\nScores:\n${JSON.stringify(scores ?? [], null, 2)}\n\nTCO model:\n${JSON.stringify(tcoModel ?? {}, null, 2)}`,
    jsonSchema: z.object({
      scenarios: z.array(z.object({
        name: z.string().min(3),
        rationale: z.string().min(10),
        allocation: z.array(z.object({
          vendorId: z.number().int(),
          sharePct: z.number().int().min(1).max(100),
          note: z.string().optional(),
        })).min(1),
        indicativeTotal: z.number().nullable(),
      })).min(2).max(4),
    }),
    jsonSchemaHint: `{ "scenarios": [ { "name":"Single winner (lowest TCO)","rationale":"...","allocation":[{"vendorId":1,"sharePct":100}],"indicativeTotal":4500000 }, { "name":"Split 60/40 (risk diversification)","rationale":"...","allocation":[{"vendorId":1,"sharePct":60},{"vendorId":2,"sharePct":40}],"indicativeTotal":4700000 } ] }`,
    maxTokens: 2200,
  });
  if (!result.ok) return aiError(result.reason, result.message, res);
  res.json(result.data);
});

// ---------------------------------------------------------------------------
// POST /api/ai/ask  — "Ask NYRA" conversational analyst (text-to-SQL)
// ---------------------------------------------------------------------------
// The agentic counterpart to the CXO dashboard's NYRA: the model writes
// read-only SELECTs (via the query_database tool) over the PMO portfolio and
// answers from live results. Returns { reply, queries } so the UI can show a
// collapsible "view query & data" trace.
router.post("/ai/ask", async (req, res): Promise<void> => {
  if (!isLLMConfigured()) {
    aiError(
      "no_api_key",
      "NYRA needs Anthropic credentials. Add ANTHROPIC_API_KEY to the api-server environment and restart.",
      res,
    );
    return;
  }

  const { messages, context } = (req.body || {}) as {
    messages?: Array<{ role: "user" | "assistant"; content: string }>;
    context?: unknown;
  };
  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "messages required" });
    return;
  }
  const turns: Array<{ role: "user" | "assistant"; content: unknown }> = messages
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && m.content)
    .slice(-12)
    .map((m) => ({ role: m.role, content: String(m.content).slice(0, 4000) }));
  if (turns.length === 0 || turns[turns.length - 1].role !== "user") {
    res.status(400).json({ error: "last message must be from user" });
    return;
  }

  // Captured for the frontend's collapsible "view query & data" panel.
  const ranQueries: Array<{
    sql: string;
    columns: string[];
    rows: Record<string, unknown>[];
    rowCount: number;
    error?: string;
  }> = [];

  const tool: AnthropicTool = {
    name: "query_database",
    description:
      "Run a single read-only SQL SELECT against the live Project Hub (PMO) portfolio and get the rows back. " +
      "Use this for any question about projects, stages, milestones, tasks, risks, issues, charters, owners/PMs, budgets, status, RAG, progress, dates or counts. " +
      "Prefer aggregates (COUNT/SUM/GROUP BY) over raw rows. Always answer from the returned data.",
    input_schema: {
      type: "object",
      properties: {
        sql: { type: "string", description: "A single read-only SELECT (or WITH ... SELECT) over pmo_* tables." },
        purpose: { type: "string", description: "One short line: what this query is for." },
      },
      required: ["sql"],
    },
  };

  try {
    const schema = await getNyraSchemaDocs();
    const system = [
      "You are NYRA, the AI analyst inside the Granules Project Hub (PMO). If asked who you are, you are NYRA.",
      "Answer the user's question about the project portfolio by querying the live database with the query_database tool, then summarising the real results.",
      "Rules:",
      "- GROUNDING (most important): every number, name, date, status or fact in your answer MUST come from a query_database result in THIS conversation. NEVER invent, estimate, guess or extrapolate. If the data isn't there, say so plainly (e.g. 'I couldn't find that in the portfolio data') rather than fabricating.",
      "- ALWAYS get figures from query_database. Write valid PostgreSQL. Use aggregates + GROUP BY; add ORDER BY + LIMIT for 'top N' questions.",
      "- You may ONLY query pmo_* tables. If a query errors, read the error and try a corrected query. You may call the tool more than once to drill down.",
      "- Use the exact enum spellings from the schema (e.g. pmo_tasks 'in_progress', pmo_projects rag_status 'amber'/'red') — a wrong value silently returns 0 rows.",
      "- Final answer: executive-concise. Lead with the answer + key numbers (bold the key figures), then 1-3 bullets of insight/risk. The UI renders GitHub-flavoured markdown in a narrow side panel — when listing multiple records (projects, tasks, people) use a compact markdown table with only the 3-4 columns that matter. Don't over-format short answers.",
      "",
      "The user is currently viewing this app state (context only — still query for figures):",
      JSON.stringify(context ?? {}).slice(0, 2000),
      "",
      "DATABASE SCHEMA:",
      schema,
    ].join("\n");

    const runTool = async (name: string, input: any) => {
      if (name !== "query_database") return { error: `unknown tool ${name}` };
      const sql = String(input?.sql ?? "");
      try {
        const { columns, rows, effectiveSql } = await runNyraSql(sql);
        ranQueries.push({ sql: effectiveSql, columns, rows, rowCount: rows.length });
        return { columns, rowCount: rows.length, rows: rows.slice(0, 200) };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        ranQueries.push({ sql, columns: [], rows: [], rowCount: 0, error: message });
        return { error: message };
      }
    };

    const reply = await llmWithTools(turns, system, [tool], runTool, { maxTokens: 2000, maxTurns: 5 });
    res.json({ reply, queries: ranQueries });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    aiError("llm_error", "NYRA is temporarily unavailable. Please try again.", res);
    req.log?.error?.({ err: message }, "ai/ask failed");
  }
});

// ---------------------------------------------------------------------------
// Live Project Charter
// ---------------------------------------------------------------------------
// A read-only, regenerable executive view of a single project: the consolidated
// AI summary of every document in the project's space plus a stage governance
// roll-up. Cached per project (one pmo_live_charters row) with a Refresh button.
//
// GET  /api/ai/projects/:id/live-charter          → cached snapshot or {exists:false}
// POST /api/ai/projects/:id/live-charter/refresh  → recompute + regenerate + upsert
// ---------------------------------------------------------------------------

router.get("/ai/projects/:id/live-charter", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [row] = await db.select().from(liveChartersTable).where(eq(liveChartersTable.projectId, id));
  if (!row) { res.json({ exists: false }); return; }
  res.json({ exists: true, ...row });
});

// Rebuild a project's Live Charter snapshot from its current documents. Per-doc
// summaries are cached by version, so this is cheap to re-run after a single doc
// changes. Exported so document mutations can trigger it (see scheduleLiveCharterRefresh).
export async function refreshLiveCharter(
  id: number,
  generatedBy: number | null = null,
): Promise<typeof liveChartersTable.$inferSelect | null> {
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
  if (!project) return null;

  // 1. Per-document summaries (cached by version — only re-summarize changed files).
  const docs = await db.select().from(documentsTable).where(eq(documentsTable.projectId, id));
  const digest: Array<{
    docId: number; name: string; stage: string | null; tags: unknown;
    approvalStatus: string; summary: string | null;
  }> = [];

  for (const doc of docs) {
    let summary = doc.summary ?? null;
    const cached = summary && doc.summaryVersion === doc.version;
    if (!cached) {
      const text = await extractDocText(doc);
      if (text) {
        const r = await llm({
          task: "live_charter_doc_summary",
          system:
            "You are a PMO analyst. Summarize the supplied project document in 2-4 sentences (max ~150 words) for an executive charter. Capture purpose, key decisions/figures/dates, and status. State facts only — never invent anything not in the text.",
          prompt: `Document: ${doc.name}\nLifecycle stage: ${doc.stage ?? "(unassigned)"}\n\nContent:\n"""\n${text.slice(0, MAX_DOC_TEXT_CHARS)}\n"""\n\nReturn ONLY the summary prose.`,
          maxTokens: 400,
        });
        if (r.ok) {
          summary = r.data.trim();
          await db.update(documentsTable)
            .set({ summary, summaryVersion: doc.version, summaryGeneratedAt: new Date() })
            .where(eq(documentsTable.id, doc.id));
        }
      }
    }
    digest.push({
      docId: doc.id, name: doc.name, stage: doc.stage ?? null, tags: doc.tags,
      approvalStatus: doc.approvalStatus, summary: summary ?? null,
    });
  }

  // 2. Stage governance roll-up (reuses the existing gate evaluator).
  const matrix = await buildStageMatrix(id, project.projectType);

  // 3. Consolidated executive narrative (graceful when AI is unavailable).
  let narrative: string | null = null;
  if (isLLMConfigured()) {
    const summarized = digest.filter((d) => d.summary);
    const byStage = summarized.reduce((acc: Record<string, string[]>, d) => {
      const key = d.stage || "Unassigned";
      (acc[key] ??= []).push(`- ${d.name} [${d.approvalStatus}]: ${d.summary}`);
      return acc;
    }, {});
    const docsBlock = Object.entries(byStage)
      .map(([stage, lines]) => `### ${stage}\n${lines.join("\n")}`)
      .join("\n\n") || "(no readable documents uploaded yet)";
    const gapsBlock = matrix
      .map((m) => {
        const gaps: string[] = [];
        if (m.prerequisitesMissing.length) gaps.push(`prereq incomplete: ${m.prerequisitesMissing.join(", ")}`);
        if (m.missingDocs.length) gaps.push(`missing docs: ${m.missingDocs.join(", ")}`);
        if (m.uncheckedChecklist.length) gaps.push(`${m.uncheckedChecklist.length} blocking checklist item(s) open`);
        return `- ${m.stage} (${m.status})${gaps.length ? ` — ${gaps.join("; ")}` : " — clear"}`;
      })
      .join("\n");

    const r = await llm({
      task: "live_charter_narrative",
      system:
        "You are an executive PMO chief of staff writing a one-page Live Project Charter for senior leadership. Consolidate the document summaries and governance status into a tight, decision-grade brief. Use markdown with these sections: ## Overview, ## Scope & Objectives, ## Key Documents by Stage, ## Governance & Gaps, ## Risks & Next Steps. State facts grounded in the inputs only — never invent figures, dates, or documents.",
      prompt: `Project: ${project.name}\nStatus: ${project.status} | RAG: ${project.ragStatus} | Progress: ${project.progress}%\nLifecycle path: ${project.projectType}\nDescription: ${project.description || "(none)"}\n\nDocument summaries by stage:\n${docsBlock}\n\nStage governance roll-up:\n${gapsBlock}\n\nWrite the Live Project Charter now.`,
      maxTokens: 3000,
    });
    if (r.ok) narrative = r.data.trim();
  }

  // 4. Upsert the snapshot (one row per project).
  const now = new Date();
  const [row] = await db
    .insert(liveChartersTable)
    .values({ projectId: id, narrative, matrix, docDigest: digest, stale: false, generatedBy, generatedAt: now })
    .onConflictDoUpdate({
      target: liveChartersTable.projectId,
      set: { narrative, matrix, docDigest: digest, stale: false, generatedBy, generatedAt: now },
    })
    .returning();

  return row;
}

// Debounced auto-refresh: coalesce a burst of document updates for one project
// into a single Live Charter rebuild ~10s after the last change, so a multi-file
// upload doesn't fire N refreshes. Fire-and-forget; errors are logged only.
const liveCharterTimers = new Map<number, ReturnType<typeof setTimeout>>();
export function scheduleLiveCharterRefresh(projectId: number): void {
  const existing = liveCharterTimers.get(projectId);
  if (existing) clearTimeout(existing);
  const t = setTimeout(() => {
    liveCharterTimers.delete(projectId);
    refreshLiveCharter(projectId).catch((err) =>
      console.error(`[live-charter] auto-refresh project=${projectId} failed:`, err));
  }, 10_000);
  if (typeof t.unref === "function") t.unref();
  liveCharterTimers.set(projectId, t);
}

router.post("/ai/projects/:id/live-charter/refresh", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const generatedBy = typeof req.body?.generatedBy === "number" ? req.body.generatedBy : null;
  const row = await refreshLiveCharter(id, generatedBy);
  if (!row) { res.status(404).json({ error: "Project not found" }); return; }
  res.json({ exists: true, ...row });
});

// ---------------------------------------------------------------------------
// POST /api/ai/projects/:id/backfill-from-docs
// Run the document-driven stage backfill. Reads every project document,
// classifies it against the lifecycle, ticks satisfied checklist items, fills
// the charter where empty, and auto-advances stages whose gates clear. Also
// invoked automatically (fire-and-forget) after each document upload.
// ---------------------------------------------------------------------------
router.post("/ai/projects/:id/backfill-from-docs", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const force = req.body?.force === true;
  const result = await backfillFromDocs(id, { force });
  if (!result.ok) {
    const status = result.reason === "no_api_key" ? 503 : result.reason === "project_not_found" ? 404 : 409;
    res.status(status).json({ error: result.reason ?? "backfill_failed", ...result });
    return;
  }
  res.json(result);
});

export default router;
