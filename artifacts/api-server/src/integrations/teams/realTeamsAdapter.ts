import type {
  TeamsAdapter,
  TeamsCalendarMeeting,
  TeamsTranscript,
  MomPostInput,
  MomPostResult,
} from "./types";

/**
 * Typed stub for the real Microsoft Graph integration. Activated only when
 * TEAMS_MODE=real; until then the selector in ./index.ts hands back the
 * mock and these methods are never reached.
 *
 * Wiring TODOs (intentionally not implemented in Stage 6):
 *
 *  - Auth: MSAL with an application registration in Granules' Microsoft
 *    365 tenant. Scopes needed:
 *      OnlineMeetings.Read.All
 *      OnlineMeetings.ReadWrite.All  (only if we want to post MoM via Graph)
 *      ChannelMessage.Send           (for postMomToChannel)
 *      User.Read.All                 (to resolve attendee userIds → display names)
 *    Read TEAMS_TENANT_ID / TEAMS_CLIENT_ID / TEAMS_CLIENT_SECRET from env
 *    LAZILY inside the function (same dotenv-ordering rule the LLM client
 *    follows in this workspace).
 *
 *  - listRecentMeetings → GET /me/calendarView?startDateTime=…&endDateTime=…
 *    Filter the events to ones with `onlineMeeting` set, then for each one
 *    GET /me/onlineMeetings/{id} to materialise the teamsMeetingId.
 *
 *  - getMeetingTranscript → GET /me/onlineMeetings/{id}/transcripts to
 *    list, then GET the latest transcript's content as text/vtt and
 *    convert to "speaker: utterance" lines (Graph returns VTT cues, not
 *    pre-joined text). Transcripts are typically ready ~5 min after the
 *    meeting ends — throw a typed "not_ready" if absent so the sync job's
 *    catch-and-retry loop kicks in.
 *
 *  - postMomToChannel → POST /teams/{teamId}/channels/{channelId}/messages
 *    with the MoM body. ChannelId stored on pmo_meetings.momPostedToChannelId
 *    is the full Graph composite id ("19:…@thread.tacv2") not just a slug.
 *
 *  - Error handling: 401 → refresh MSAL token + retry once; 429 → respect
 *    the Retry-After header; 5xx → surface to the caller.
 *
 * Each method throws until the wiring lands — guaranteed by the selector
 * which never instantiates this class unless TEAMS_MODE=real.
 */
class RealTeamsAdapter implements TeamsAdapter {
  readonly mode = "real" as const;

  async listRecentMeetings(_opts: { userEmail?: string; withinDays?: number }): Promise<TeamsCalendarMeeting[]> {
    throw new Error("Teams[real].listRecentMeetings: not wired yet. Provide MSAL credentials and implement the Graph calls.");
  }

  async getMeetingTranscript(_teamsMeetingId: string): Promise<TeamsTranscript> {
    throw new Error("Teams[real].getMeetingTranscript: not wired yet.");
  }

  async postMomToChannel(_input: MomPostInput): Promise<MomPostResult> {
    throw new Error("Teams[real].postMomToChannel: not wired yet.");
  }
}

export const realTeamsAdapter: TeamsAdapter = new RealTeamsAdapter();
