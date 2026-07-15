import "./db-target"; // MUST stay first — overlays DB env vars before @workspace/db loads
import app from "./app";
import { logger } from "./lib/logger";
import { registerJob, startScheduler } from "./lib/scheduler";
import { runEscalationEvaluator } from "./jobs/escalation-evaluator";
import { runNudgeGenerator } from "./jobs/nudge-generator";
import { runSapSync } from "./jobs/sap-sync";
import { runTeamsSync } from "./jobs/teams-sync";
import { runStageEscalationLadder } from "./jobs/stage-escalation-ladder";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Register background jobs BEFORE startScheduler so the boot loop sees them.
// startScheduler is a no-op unless ENABLE_SCHEDULER=true so this is safe to
// always wire in (the registrations themselves are inert without start).
//
// Cadences:
//   escalation-evaluator → every 5 min  (cheap; pure DB read+write, no LLM)
//   nudge-generator      → every 15 min (one LLM call per active user, capped)
registerJob("escalation-evaluator", 5 * 60 * 1000, runEscalationEvaluator);
registerJob("nudge-generator", 15 * 60 * 1000, runNudgeGenerator);
// sap-sync polls the SAP adapter for open PR/PO status transitions. Two
// minutes is short enough to feel live during a demo, low-cost enough to
// never matter against the in-memory mock, and reasonable for the future
// S/4HANA OData calls (each row is one round-trip).
registerJob("sap-sync", 2 * 60 * 1000, runSapSync);
// teams-sync polls the Teams adapter for new meetings + ready transcripts.
// 30 min is a deliberately quiet cadence — transcripts appear ~5 min after a
// meeting ends, and we don't want to hammer the Graph API; the UI's
// "Import from Teams" button gives users an on-demand alternative.
registerJob("teams-sync", 30 * 60 * 1000, runTeamsSync);
// stage-escalation-ladder walks the global per-stage escalation policy (pmo_stage_escalation_policy)
// and fires reminder/escalation tiers by person. Hourly is plenty — dedup is day-granular,
// and the manual Remind/Escalate buttons + /jobs/run/stage-escalation-ladder cover on-demand needs.
registerJob("stage-escalation-ladder", 60 * 60 * 1000, runStageEscalationLadder);

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  startScheduler();
});
