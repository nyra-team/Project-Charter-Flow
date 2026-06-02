import type {
  TeamsAdapter,
  TeamsCalendarMeeting,
  TeamsTranscript,
  MomPostInput,
  MomPostResult,
} from "./types";

/**
 * In-memory Teams mock. Returns a small set of canned fixtures (steering
 * committee, daily stand-up, vendor review) deliberately rich enough that
 * the existing /api/ai/meetings/:id/extract-action-items endpoint produces
 * meaningful action items.
 *
 * The fixtures are returned with subject/attendee variations every call so
 * a demo can run "import" multiple times without ending up with duplicate-
 * looking rows. Each new fetch generates fresh `mock-mtg-…` IDs anchored on
 * today's date so the dedupe by teamsMeetingId in the route handler still
 * keeps things tidy.
 *
 * Posting MoM is a no-op that logs and returns a fake `mock-post-…` id.
 */

const FIXTURE_TRANSCRIPTS: Record<string, string> = {
  "steering-committee": `Aarti (Sponsor): Welcome everyone. Let's review the FY26 ANDA submission progress.
Khaleel (PM): We're on track for the formulation lock by month-end. Two pilot batches are pending.
Aarti: Any blockers on the BE study side?
Khaleel: The reference product procurement was delayed by two weeks. We should be back on track by next Tuesday.
Asha (QA Lead): I need the analytical method validation report by Friday so we can include it in the dossier.
Khaleel: Acknowledged. Mahesh will send it across by Friday EOD.
Mahesh (R&D): Will do.
Aarti: Decision — we'll push for an internal QA pre-review one week before the FDA submission. PMO to schedule.
Khaleel: I'll coordinate with PMO this week.
Aarti: For information — the budget for analytical instruments was approved by CFO yesterday. Procurement can proceed.
Khaleel: Noted. SCM will raise the PR.
Aarti: Action — PMO to add a milestone "FDA Pre-Submission Internal QA" by EOD Wednesday.
Aarti: That's all. Thanks everyone.`,
  "daily-standup": `Khaleel: What's blocking the bioequivalence study?
Mahesh: The pilot scale-up batch yield was lower than expected. We need to repeat with adjusted parameters.
Khaleel: How much delay does that introduce?
Mahesh: Three to four days at most.
Asha: I can prepare the rework protocol by tomorrow morning.
Khaleel: Action — Asha to send the revised protocol by 11 AM tomorrow.
Khaleel: Decision — we move the BE study start date by one week to absorb the rework.
Khaleel: Anything else?
Mahesh: No, that's it.`,
  "vendor-review": `Khaleel: We have three vendor proposals for the analytical instruments — Agilent, Waters, and Shimadzu.
SCM Head: Agilent is the lowest cost but their service network in Hyderabad is weaker.
Khaleel: How much weaker?
SCM Head: Average response time of 36 hours versus 18 for Waters.
Finance Head: For a 5 crore investment, the service window matters more than the upfront delta.
Khaleel: Decision — we proceed with Waters. SCM to issue the LOI by Friday.
Khaleel: Action — Finance Head to share revised cash-flow projection reflecting Waters' payment terms by Wednesday.
SCM Head: I'll start the LOI draft today.
Khaleel: For information — the Waters quote excludes installation training. We'll need to budget separately.
Khaleel: That's a wrap.`,
};

function isoOffsetHoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function fixtureMeetings(): TeamsCalendarMeeting[] {
  // Anchor IDs on today's YYYY-MM-DD so re-running "import" lands deterministic
  // ids per day. The route handler dedupes on teamsMeetingId.
  const day = new Date().toISOString().slice(0, 10);
  return [
    {
      teamsMeetingId: `mock-mtg-${day}-steering`,
      subject: "ANDA FY26 Steering Committee",
      startDateTime: isoOffsetHoursAgo(26),
      endDateTime: isoOffsetHoursAgo(25),
      attendees: ["Aarti Verma", "Khaleel Shaik", "Asha Monica", "Mahesh Rao"],
      channelId: "mock-channel-projects-anda",
    },
    {
      teamsMeetingId: `mock-mtg-${day}-standup`,
      subject: "BE Study Daily Stand-up",
      startDateTime: isoOffsetHoursAgo(20),
      endDateTime: isoOffsetHoursAgo(19.7),
      attendees: ["Khaleel Shaik", "Mahesh Rao", "Asha Monica"],
      channelId: "mock-channel-be-study",
    },
    {
      teamsMeetingId: `mock-mtg-${day}-vendor`,
      subject: "Vendor Review — Analytical Instruments",
      startDateTime: isoOffsetHoursAgo(7),
      endDateTime: isoOffsetHoursAgo(6),
      attendees: ["Khaleel Shaik", "SCM Head", "Finance Head"],
      channelId: "mock-channel-procurement",
    },
  ];
}

const postedMoms = new Map<string, MomPostResult>();

class MockTeamsAdapter implements TeamsAdapter {
  readonly mode = "mock" as const;

  async listRecentMeetings(_opts: { userEmail?: string; withinDays?: number }): Promise<TeamsCalendarMeeting[]> {
    return fixtureMeetings();
  }

  async getMeetingTranscript(teamsMeetingId: string): Promise<TeamsTranscript> {
    // Map the fixture id back to one of the three transcripts. Anything
    // else throws — matches Graph behaviour when a transcript hasn't
    // finished post-processing yet.
    const kind = teamsMeetingId.endsWith("-steering")
      ? "steering-committee"
      : teamsMeetingId.endsWith("-standup")
        ? "daily-standup"
        : teamsMeetingId.endsWith("-vendor")
          ? "vendor-review"
          : null;
    if (!kind) {
      throw new Error(`Teams[mock].getMeetingTranscript: no fixture transcript for ${teamsMeetingId}`);
    }
    return {
      teamsMeetingId,
      transcript: FIXTURE_TRANSCRIPTS[kind],
      capturedAt: new Date().toISOString(),
    };
  }

  async postMomToChannel(input: MomPostInput): Promise<MomPostResult> {
    const postId = `mock-post-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const result: MomPostResult = { postId, postedAt: new Date().toISOString() };
    postedMoms.set(postId, result);
    // The mock just records the post — a real Graph call would land it in
    // the actual channel.
    return result;
  }
}

export const mockTeamsAdapter: TeamsAdapter = new MockTeamsAdapter();
