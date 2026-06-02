import { logger } from "./logger";

/**
 * Lightweight in-process scheduler. setInterval-based — no cron expressions,
 * no external dependency. All four registered jobs only need fixed cadences
 * (every N minutes), so we trade the flexibility of node-cron for zero deps
 * and zero supply-chain attack surface. If a future job needs true cron
 * semantics (e.g. "every weekday at 09:00"), lift this to `node-cron` then.
 *
 * Boot is opt-in via ENABLE_SCHEDULER=true so dev / multi-replica
 * deployments don't all fire the same jobs in parallel. The intended
 * deployment is one process with the flag set.
 *
 * Jobs:
 *  - register their fn via registerJob(name, intervalMs, fn)
 *  - are kicked off after a small randomised jitter (so they don't all fire
 *    at the same wall-clock second when the process boots)
 *  - report per-run status (last run, duration, failure count) via listJobs()
 *  - can be triggered manually via runJobNow(name) — backs the
 *    POST /api/jobs/run/:name debug route for QA + nudge testing
 *
 * Reentrancy: a single job never overlaps itself — if a tick fires while the
 * previous one is still in flight, the new tick is skipped and a warning
 * logged. This guards the heavier nudge-generator (LLM call per active user)
 * from piling up if the model is slow.
 */

type JobFn = () => Promise<void>;

interface RegisteredJob {
  name: string;
  intervalMs: number;
  fn: JobFn;
  handle: NodeJS.Timeout | null;
  inFlight: boolean;
  lastRunAt: Date | null;
  lastDurationMs: number | null;
  lastError: string | null;
  consecutiveFailures: number;
}

const jobs = new Map<string, RegisteredJob>();
let started = false;

export interface JobStatus {
  name: string;
  intervalMs: number;
  inFlight: boolean;
  lastRunAt: string | null;
  lastDurationMs: number | null;
  lastError: string | null;
  consecutiveFailures: number;
}

export function registerJob(name: string, intervalMs: number, fn: JobFn): void {
  if (jobs.has(name)) {
    logger.warn({ name }, "scheduler.registerJob: overwriting existing job");
  }
  jobs.set(name, {
    name,
    intervalMs,
    fn,
    handle: null,
    inFlight: false,
    lastRunAt: null,
    lastDurationMs: null,
    lastError: null,
    consecutiveFailures: 0,
  });
}

async function tick(job: RegisteredJob): Promise<void> {
  if (job.inFlight) {
    logger.warn({ job: job.name }, "scheduler.tick: previous run still in flight, skipping");
    return;
  }
  job.inFlight = true;
  const start = Date.now();
  try {
    await job.fn();
    job.lastDurationMs = Date.now() - start;
    job.lastRunAt = new Date();
    job.lastError = null;
    job.consecutiveFailures = 0;
    logger.debug({ job: job.name, durationMs: job.lastDurationMs }, "scheduler.tick: ok");
  } catch (err) {
    job.lastDurationMs = Date.now() - start;
    job.lastRunAt = new Date();
    job.lastError = err instanceof Error ? err.message : String(err);
    job.consecutiveFailures += 1;
    logger.error(
      { job: job.name, err, consecutiveFailures: job.consecutiveFailures },
      "scheduler.tick: failed",
    );
  } finally {
    job.inFlight = false;
  }
}

export function startScheduler(): void {
  if (started) {
    logger.warn("scheduler.startScheduler: already started; ignoring");
    return;
  }
  if (process.env["ENABLE_SCHEDULER"] !== "true") {
    logger.info("scheduler: disabled (set ENABLE_SCHEDULER=true to enable)");
    return;
  }
  started = true;
  logger.info({ jobs: jobs.size }, "scheduler: starting");
  for (const job of jobs.values()) {
    // Jitter 0–10% of the interval, capped at 30s, so jobs don't all align on
    // boot. Avoids a thundering herd of LLM/DB calls in the first minute.
    const jitter = Math.min(30_000, Math.floor(job.intervalMs * Math.random() * 0.1));
    setTimeout(() => {
      // Fire once immediately after the jitter so QA doesn't have to wait
      // a full interval (15 min for nudges) to see the first run.
      void tick(job);
      job.handle = setInterval(() => void tick(job), job.intervalMs);
    }, jitter);
  }
}

export function stopScheduler(): void {
  for (const job of jobs.values()) {
    if (job.handle) {
      clearInterval(job.handle);
      job.handle = null;
    }
  }
  started = false;
  logger.info("scheduler: stopped");
}

export async function runJobNow(
  name: string,
): Promise<{ ok: true; durationMs: number } | { ok: false; error: string }> {
  const job = jobs.get(name);
  if (!job) return { ok: false, error: `unknown job: ${name}` };
  if (job.inFlight) return { ok: false, error: `${name} is already in flight` };
  const start = Date.now();
  try {
    await job.fn();
    const durationMs = Date.now() - start;
    job.lastDurationMs = durationMs;
    job.lastRunAt = new Date();
    job.lastError = null;
    job.consecutiveFailures = 0;
    return { ok: true, durationMs };
  } catch (err) {
    job.consecutiveFailures += 1;
    job.lastError = err instanceof Error ? err.message : String(err);
    job.lastRunAt = new Date();
    return { ok: false, error: job.lastError };
  }
}

export function listJobs(): JobStatus[] {
  return Array.from(jobs.values()).map((j) => ({
    name: j.name,
    intervalMs: j.intervalMs,
    inFlight: j.inFlight,
    lastRunAt: j.lastRunAt?.toISOString() ?? null,
    lastDurationMs: j.lastDurationMs,
    lastError: j.lastError,
    consecutiveFailures: j.consecutiveFailures,
  }));
}
