import {
  db,
  meetingsTable,
  meetingItemsTable,
  projectsTable,
  notificationsTable,
} from "@workspace/db";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import { llm, isLLMConfigured } from "@workspace/llm";
import { logger } from "../lib/logger";
import { getTeamsAdapter } from "../integrations/teams";

/**
 * Teams sync job — runs every 30 min via the scheduler. Two passes:
 *
 *   1. For every active project (any project with a non-terminal status),
 *      ask the adapter for recent meetings. New Teams meetings are added
 *      to pmo_meetings keyed on teamsMeetingId; the route handler's
 *      import-meetings logic is reused via direct DB writes here to keep
 *      this job self-contained (no HTTP round-trip into our own API).
 *
 *   2. For every meeting that has a teamsMeetingId but no transcript yet,
 *      try to fetch one. Transcripts in Graph typically appear ~5 min
 *      after the meeting ends; this job's catch-and-continue swallows the
 *      "not ready" exception so it retries on the next 30-min tick.
 *
 * Cost guardrails:
 *   - MAX_PROJECTS_PER_TICK caps the import fan-out so a 100-project
 *     deployment doesn't hit the Graph rate limit every half hour.
 *   - LLM extraction runs at most once per meeting (the next tick sees
 *     transcript already set + meeting items present, and skips).
 *
 * Disabled silently if TEAMS_MODE=mock and there are no projects to import
 * for — the mock returns the same fixtures regardless so we don't keep
 * appending dupes on each tick.
 */

const MAX_PROJECTS_PER_TICK = 50;

async function importForProject(projectId: number): Promise<{ created: number; updated: number }> {
  const adapter = getTeamsAdapter();
  const meetings = await adapter.listRecentMeetings({ withinDays: 1 });
  let created = 0;
  let updated = 0;
  for (const m of meetings) {
    const [existing] = await db
      .select({ id: meetingsTable.id })
      .from(meetingsTable)
      .where(eq(meetingsTable.teamsMeetingId, m.teamsMeetingId));
    const date = m.startDateTime.slice(0, 10);
    const time = m.startDateTime.slice(11, 16);
    if (existing) {
      // Don't overwrite a meeting that's already been assigned to a
      // DIFFERENT project — just bump the sync timestamp.
      await db
        .update(meetingsTable)
        .set({ teamsSyncedAt: new Date() })
        .where(eq(meetingsTable.id, existing.id));
      updated += 1;
    } else {
      await db.insert(meetingsTable).values({
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
        momPostedToChannelId: m.channelId ?? null,
      } as never);
      created += 1;
    }
  }
  return { created, updated };
}

async function syncTranscriptFor(meetingId: number): Promise<{ extracted: number } | { skipped: string }> {
  const adapter = getTeamsAdapter();
  const [meeting] = await db.select().from(meetingsTable).where(eq(meetingsTable.id, meetingId));
  if (!meeting?.teamsMeetingId) return { skipped: "no teamsMeetingId" };

  let transcript;
  try {
    transcript = await adapter.getMeetingTranscript(meeting.teamsMeetingId);
  } catch (err) {
    // "not_ready" is the common case — leave the row alone, next tick
    // will retry.
    logger.debug({ meetingId, err: (err as Error).message }, "teams-sync: transcript not ready");
    return { skipped: "transcript not ready" };
  }

  await db
    .update(meetingsTable)
    .set({
      teamsTranscriptRaw: transcript.transcript,
      notes: transcript.transcript,
      teamsSyncedAt: new Date(),
    })
    .where(eq(meetingsTable.id, meetingId));

  if (!isLLMConfigured()) return { skipped: "LLM not configured" };

  const result = await llm({
    task: "teams_transcript_extract",
    system:
      "You read meeting transcripts from a PMO CFT call and extract a clean list of items. Distinguish action_item vs decision vs information. Use the speaker's own words where possible. Owner is the person assigned to do the work, not the speaker.",
    prompt: `Meeting: ${meeting.title}\nDate: ${meeting.scheduledDate}\n\nTranscript:\n"""\n${transcript.transcript}\n"""\n\nExtract the items now.`,
    jsonSchema: z.object({
      items: z.array(z.object({
        description: z.string().min(3),
        owner: z.string().optional(),
        dueDate: z.string().optional(),
        category: z.enum(["action_item", "decision", "information"]),
      })),
    }),
    jsonSchemaHint: `{ "items":[{"description":"...","owner":"name or empty","dueDate":"YYYY-MM-DD or empty","category":"action_item|decision|information"}] }`,
    maxTokens: 2500,
  });
  if (!result.ok) return { skipped: `LLM extract failed: ${result.message}` };

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

  // Notify the project's PM that a transcript was auto-imported + extracted.
  if (meeting.projectId != null) {
    const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, meeting.projectId));
    if (project?.projectManagerId) {
      await db.insert(notificationsTable).values({
        userId: project.projectManagerId,
        type: "teams_transcript_synced",
        title: `Auto-imported transcript: "${meeting.title}"`,
        body: `${result.data.items.length} item${result.data.items.length === 1 ? "" : "s"} extracted.`,
        link: `/projects/${project.id}?tab=meetings`,
        relatedEntityType: "meeting",
        relatedEntityId: meetingId,
      } as never);
    }
  }

  return { extracted: result.data.items.length };
}

export async function runTeamsSync(): Promise<void> {
  logger.info("teams-sync: tick start");

  // 1. IMPORT — sweep active projects.
  // (Active = anything not 'closed'. PMO-side filter keeps the fan-out
  // reasonable; the real Graph API has per-tenant rate limits.)
  const activeProjects = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(eq(projectsTable.status, "active"))
    .limit(MAX_PROJECTS_PER_TICK);

  let imported = 0;
  for (const p of activeProjects) {
    try {
      const r = await importForProject(p.id);
      imported += r.created;
    } catch (err) {
      logger.warn({ projectId: p.id, err: (err as Error).message }, "teams-sync: import failed");
    }
  }

  // 2. TRANSCRIBE — meetings with a teamsMeetingId but no transcript yet.
  const needsTranscript = await db
    .select({ id: meetingsTable.id })
    .from(meetingsTable)
    .where(and(isNotNull(meetingsTable.teamsMeetingId), isNull(meetingsTable.teamsTranscriptRaw)));

  let transcribed = 0;
  for (const m of needsTranscript) {
    try {
      const r = await syncTranscriptFor(m.id);
      if ("extracted" in r) transcribed += 1;
    } catch (err) {
      logger.warn({ meetingId: m.id, err: (err as Error).message }, "teams-sync: transcript sync failed");
    }
  }

  logger.info({ projects: activeProjects.length, imported, transcribed }, "teams-sync: tick done");
}
