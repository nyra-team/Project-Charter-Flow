import { Router, type IRouter } from "express";
import { z } from "zod";
import {
  db,
  chartersTable,
  projectsTable,
  budgetLinesTable,
  risksTable,
  issuesTable,
  tasksTable,
  milestonesTable,
  meetingsTable,
  meetingItemsTable,
  activityTable,
} from "@workspace/db";
import { eq, desc, and, or, inArray } from "drizzle-orm";
import { llm, isLLMConfigured } from "@workspace/llm";

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
    model: process.env.LLM_DEFAULT_MODEL || "claude-sonnet-4-5",
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

export default router;
