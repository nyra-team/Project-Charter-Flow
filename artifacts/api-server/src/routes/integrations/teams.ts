import { Router, type IRouter } from "express";
import { z } from "zod/v4";
// llm()'s jsonSchema field is typed against classic `zod` (the same import
// routes/ai.ts uses); aliasing here lets the rest of this file keep using
// zod/v4 for route-body validation while feeding llm() a compatible schema.
import { z as zClassic } from "zod";
import {
  db,
  meetingsTable,
  meetingItemsTable,
  projectsTable,
  notificationsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { llm, isLLMConfigured } from "@workspace/llm";
import { logActivity } from "../activity";
import { getTeamsAdapter } from "../../integrations/teams";

const router: IRouter = Router();

// ─── Validation ─────────────────────────────────────────────────────────────

const ImportBody = z.object({
  projectId: z.number().int(),
  withinDays: z.number().int().min(1).max(30).optional().default(2),
});

const SyncTranscriptBody = z.object({
  autoExtract: z.boolean().optional().default(true),
});

const PostMomBody = z.object({
  channelId: z.string().min(1),
  title: z.string().optional(),
  body: z.string().min(1),
});

// ─── POST /api/integrations/teams/import-meetings ───────────────────────────
//
// Pulls recent meetings from the Teams adapter and upserts pmo_meetings rows
// against teamsMeetingId. Idempotent — re-running on the same day creates
// no duplicates (and updates the synced timestamp on each pass). The
// adapter currently doesn't filter by user, so we associate every imported
// meeting with the passed projectId.

router.post("/integrations/teams/import-meetings", async (req, res): Promise<void> => {
  const parsed = ImportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { projectId, withinDays } = parsed.data;
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const adapter = getTeamsAdapter();
  let upcoming;
  try {
    upcoming = await adapter.listRecentMeetings({
      userEmail: req.user?.email,
      withinDays,
    });
  } catch (err) {
    res.status(502).json({ error: `Teams[${adapter.mode}].listRecentMeetings failed: ${(err as Error).message}` });
    return;
  }

  let created = 0;
  let updated = 0;
  for (const m of upcoming) {
    const [existing] = await db
      .select({ id: meetingsTable.id })
      .from(meetingsTable)
      .where(eq(meetingsTable.teamsMeetingId, m.teamsMeetingId));
    const date = m.startDateTime.slice(0, 10);
    const time = m.startDateTime.slice(11, 16);
    if (existing) {
      await db
        .update(meetingsTable)
        .set({
          title: m.subject,
          scheduledDate: date,
          scheduledTime: time,
          teamsSyncedAt: new Date(),
          ...(m.channelId ? { momPostedToChannelId: m.channelId } : {}),
        })
        .where(eq(meetingsTable.id, existing.id));
      updated += 1;
    } else {
      await db
        .insert(meetingsTable)
        .values({
          title: m.subject,
          type: "other",
          projectId,
          scheduledDate: date,
          scheduledTime: time,
          status: new Date(m.endDateTime) < new Date() ? "completed" : "planned",
          location: "Microsoft Teams",
          agenda: m.attendees.length ? `Attendees: ${m.attendees.join(", ")}` : "",
          teamsMeetingId: m.teamsMeetingId,
          teamsSyncedAt: new Date(),
          // momPostedToChannelId here just records WHERE to post if asked
          // — it doesn't mean MoM is posted yet. momPostedAt is the truth.
          momPostedToChannelId: m.channelId ?? null,
        } as never);
      created += 1;
    }
  }

  await logActivity(
    "teams_import",
    `Imported ${created} new / refreshed ${updated} meetings from Teams[${adapter.mode}] for project ${projectId}`,
    projectId,
    "project",
  );
  res.json({ created, updated, total: upcoming.length });
});

// ─── POST /api/integrations/teams/:meetingId/sync-transcript ────────────────
//
// Pulls the transcript for the meeting from the adapter, writes it to
// teamsTranscriptRaw AND notes (so the existing extract-action-items
// endpoint can read it without changes). When autoExtract=true, the
// freshly synced transcript is fed through the LLM extraction immediately.

router.post("/integrations/teams/:meetingId/sync-transcript", async (req, res): Promise<void> => {
  const meetingId = parseInt(req.params.meetingId);
  if (isNaN(meetingId)) {
    res.status(400).json({ error: "Invalid meetingId" });
    return;
  }
  const parsed = SyncTranscriptBody.safeParse(req.body || {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [meeting] = await db.select().from(meetingsTable).where(eq(meetingsTable.id, meetingId));
  if (!meeting) {
    res.status(404).json({ error: "Meeting not found" });
    return;
  }
  if (!meeting.teamsMeetingId) {
    res.status(409).json({ error: "Meeting has no teamsMeetingId — not imported from Teams" });
    return;
  }

  const adapter = getTeamsAdapter();
  let transcript;
  try {
    transcript = await adapter.getMeetingTranscript(meeting.teamsMeetingId);
  } catch (err) {
    res.status(502).json({ error: `Teams[${adapter.mode}].getMeetingTranscript failed: ${(err as Error).message}` });
    return;
  }

  await db
    .update(meetingsTable)
    .set({
      teamsTranscriptRaw: transcript.transcript,
      // Mirror into notes so the existing /ai/meetings/:id/extract-action-items
      // endpoint (which reads notes) just works with no changes.
      notes: transcript.transcript,
      teamsSyncedAt: new Date(),
    })
    .where(eq(meetingsTable.id, meetingId));

  await logActivity(
    "teams_transcript_synced",
    `Transcript synced for meeting "${meeting.title}" (${transcript.transcript.length} chars)`,
    meetingId,
    "meeting",
  );

  // Auto-extract: run the same LLM call that the existing AI endpoint uses.
  // We don't call /api/ai/... internally (would round-trip auth); we
  // duplicate the small LLM call here. Keeps the route self-contained.
  let extracted: { count: number } | { skipped: string } = { skipped: "autoExtract=false" };
  if (parsed.data.autoExtract) {
    if (!isLLMConfigured()) {
      extracted = { skipped: "LLM not configured" };
    } else {
      const result = await llm({
        task: "teams_transcript_extract",
        system:
          "You read meeting transcripts from a PMO CFT call and extract a clean list of items. Distinguish action_item vs decision vs information. Use the speaker's own words where possible. Owner is the person assigned to do the work, not the speaker.",
        prompt: `Meeting: ${meeting.title}\nDate: ${meeting.scheduledDate}\n\nTranscript:\n"""\n${transcript.transcript}\n"""\n\nExtract the items now.`,
        jsonSchema: zClassic.object({
          items: zClassic.array(zClassic.object({
            description: zClassic.string().min(3),
            owner: zClassic.string().optional(),
            dueDate: zClassic.string().optional(),
            category: zClassic.enum(["action_item", "decision", "information"]),
          })),
        }),
        jsonSchemaHint: `{ "items":[{"description":"...","owner":"name or empty","dueDate":"YYYY-MM-DD or empty","category":"action_item|decision|information"}] }`,
        maxTokens: 2500,
      });
      if (result.ok) {
        for (const it of result.data.items) {
          await db.insert(meetingItemsTable).values({
            meetingId,
            description: it.description,
            dueDate: it.dueDate || null,
            category: it.category,
            notes: it.owner ? `Owner: ${it.owner}` : "",
            status: "open",
          } as never);
        }
        extracted = { count: result.data.items.length };
      } else {
        extracted = { skipped: `LLM extract failed: ${result.message}` };
      }
    }
  }

  // Notify the project PM that a transcript landed (and how many actions
  // came out of it).
  if (meeting.projectId != null) {
    const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, meeting.projectId));
    if (project?.projectManagerId) {
      const summary = "count" in extracted ? `${extracted.count} item${extracted.count === 1 ? "" : "s"} auto-extracted` : extracted.skipped;
      await db.insert(notificationsTable).values({
        userId: project.projectManagerId,
        type: "teams_transcript_synced",
        title: `Transcript ready: "${meeting.title}"`,
        body: summary,
        link: `/projects/${project.id}?tab=meetings`,
        relatedEntityType: "meeting",
        relatedEntityId: meetingId,
      } as never);
    }
  }

  const [refreshed] = await db.select().from(meetingsTable).where(eq(meetingsTable.id, meetingId));
  res.json({ meeting: refreshed, extracted });
});

// ─── POST /api/integrations/teams/:meetingId/post-mom ───────────────────────
//
// Posts the rendered MoM back to a Teams channel. Idempotent at the call
// site: if momPostedAt is already set the caller (UI) is expected to ask
// for confirmation before re-posting.

router.post("/integrations/teams/:meetingId/post-mom", async (req, res): Promise<void> => {
  const meetingId = parseInt(req.params.meetingId);
  if (isNaN(meetingId)) {
    res.status(400).json({ error: "Invalid meetingId" });
    return;
  }
  const parsed = PostMomBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [meeting] = await db.select().from(meetingsTable).where(eq(meetingsTable.id, meetingId));
  if (!meeting) {
    res.status(404).json({ error: "Meeting not found" });
    return;
  }

  const adapter = getTeamsAdapter();
  let post;
  try {
    post = await adapter.postMomToChannel({
      channelId: parsed.data.channelId,
      title: parsed.data.title ?? meeting.title,
      body: parsed.data.body,
    });
  } catch (err) {
    res.status(502).json({ error: `Teams[${adapter.mode}].postMomToChannel failed: ${(err as Error).message}` });
    return;
  }

  await db
    .update(meetingsTable)
    .set({
      momPostedToChannelId: parsed.data.channelId,
      momPostedAt: new Date(post.postedAt),
    })
    .where(eq(meetingsTable.id, meetingId));

  await logActivity(
    "teams_mom_posted",
    `MoM posted to Teams channel ${parsed.data.channelId} for meeting "${meeting.title}"`,
    meetingId,
    "meeting",
  );

  res.json({ postId: post.postId, postedAt: post.postedAt });
});

// Re-export of `and` used implicitly above (drizzle eq sometimes pairs).
void and;

export default router;
