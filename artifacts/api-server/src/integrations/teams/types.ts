// Microsoft Teams adapter contract — implemented by mockTeamsAdapter
// (canned fixtures, dev/demo) and realTeamsAdapter (Microsoft Graph
// onlineMeetings + callRecords/transcripts, gated behind TEAMS_MODE=real).
//
// Same separation-of-concerns as the SAP adapter: this surface only models
// the Teams/Graph side. Persistence into pmo_meetings + AI extraction +
// notification mirroring all live in routes/integrations/teams.ts and
// jobs/teams-sync.ts.

export interface TeamsCalendarMeeting {
  /** Graph onlineMeeting id (real) or fixture id like `mock-mtg-001` (mock). */
  teamsMeetingId: string;
  subject: string;
  /** ISO 8601 — adapter never returns null; mock generates plausible times. */
  startDateTime: string;
  /** ISO 8601 — end == start + canonical 30 min if unknown. */
  endDateTime: string;
  /** Display names of likely attendees (no emails — those need an extra Graph call). */
  attendees: string[];
  /** Where to post the MoM back to, if known at fetch time. */
  channelId?: string;
}

export interface TeamsTranscript {
  teamsMeetingId: string;
  /** Plain-text transcript. The mock formats it as `speaker: utterance\n` lines
   *  so the existing extract-action-items LLM call can parse it without changes. */
  transcript: string;
  /** When the transcript was finalised in Teams; null when not yet ready. */
  capturedAt?: string;
}

export interface MomPostInput {
  channelId: string;
  /** Already-rendered MoM (heading + decisions + action items). The adapter
   *  doesn't try to format — composition is done at the route handler. */
  body: string;
  /** Display title for the channel post; mock just logs. */
  title?: string;
}

export interface MomPostResult {
  /** Graph message id (real) or `mock-post-<ts>` (mock). */
  postId: string;
  postedAt: string;
}

export interface TeamsAdapter {
  /** Mode label for diagnostics. */
  readonly mode: "mock" | "real";

  /**
   * List meetings the given user attended/owns within `withinDays` of today
   * (defaults to 1 — "yesterday's meetings"). Mock returns the same handful
   * of fixtures regardless of userId so any demo seeds something to look at.
   */
  listRecentMeetings(opts: { userEmail?: string; withinDays?: number }): Promise<TeamsCalendarMeeting[]>;

  /**
   * Fetch the transcript for a meeting. Throws when the transcript isn't
   * ready yet (caller swallows + retries on the next sync tick).
   */
  getMeetingTranscript(teamsMeetingId: string): Promise<TeamsTranscript>;

  /**
   * Post a rendered MoM into a Teams channel. Idempotent on (channelId,
   * body) is NOT guaranteed by Graph — the caller is responsible for
   * checking `momPostedAt` on the meeting row before invoking.
   */
  postMomToChannel(input: MomPostInput): Promise<MomPostResult>;
}
