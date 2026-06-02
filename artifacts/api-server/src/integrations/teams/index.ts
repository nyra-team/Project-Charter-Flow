import { logger } from "../../lib/logger";
import { mockTeamsAdapter } from "./mockTeamsAdapter";
import { realTeamsAdapter } from "./realTeamsAdapter";
import type { TeamsAdapter } from "./types";

// Singleton selector — read TEAMS_MODE lazily on first call, mirror the
// pattern used by lib/objectStorage.ts, lib/masterDb.ts, and the SAP
// adapter from Stage 5. Reading env inside the function (not at module
// load) survives the dotenv-ordering pitfalls called out in the workspace
// CLAUDE.md.
let _adapter: TeamsAdapter | null = null;

export function getTeamsAdapter(): TeamsAdapter {
  if (_adapter) return _adapter;
  const mode = (process.env["TEAMS_MODE"] || "mock").toLowerCase();
  if (mode === "real") {
    _adapter = realTeamsAdapter;
    logger.info("teams: using real adapter (Microsoft Graph)");
  } else {
    _adapter = mockTeamsAdapter;
    logger.info({ mode }, "teams: using mock adapter (canned fixtures)");
  }
  return _adapter;
}

export type {
  TeamsAdapter,
  TeamsCalendarMeeting,
  TeamsTranscript,
  MomPostInput,
  MomPostResult,
} from "./types";
