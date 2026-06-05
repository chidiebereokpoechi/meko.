import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client.ts";
import { jobs } from "@/db/schema.ts";
import { ctxLog } from "@/lib/logger.ts";

export interface Job {
  id: string;
  type: string;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
}

// Claim one job atomically with FOR UPDATE SKIP LOCKED (§12o). Workers skip rows another worker
// already locked instead of serialising behind them. Single UPDATE avoids the SELECT+UPDATE race.
//
// `match` partitions work across worker pools: the general worker excludes 'export', while the
// network-isolated Chromium sidecar claims only 'export' (§8b).
export async function claimJob(match?: { type?: string; notType?: string }): Promise<Job | null> {
  const typeFilter = match?.type
    ? sql`AND type = ${match.type}`
    : match?.notType
      ? sql`AND type <> ${match.notType}`
      : sql``;
  const res = await db.execute<{
    id: string;
    type: string;
    payload: unknown;
    attempts: number;
    max_attempts: number;
  }>(sql`
    UPDATE jobs
    SET status = 'running',
        claimed_at = now(),
        claim_expires_at = now() + interval '5 minutes',
        attempts = attempts + 1,
        updated_at = now()
    WHERE id = (
      SELECT id FROM jobs
      WHERE status = 'pending' AND run_after <= now() ${typeFilter}
      ORDER BY priority DESC, run_after
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, type, payload, attempts, max_attempts
  `);
  const row = res.rows[0];
  if (!row) return null;
  return { id: row.id, type: row.type, payload: row.payload, attempts: row.attempts, maxAttempts: row.max_attempts };
}

export async function completeJob(id: string): Promise<void> {
  await db.update(jobs).set({ status: "done", updatedAt: new Date() }).where(eq(jobs.id, id));
}

// On failure: dead-letter once attempts are exhausted (§12n), else requeue with capped
// exponential backoff. Backoff is encoded as a future eligibility, not a blocking sleep.
export async function failJob(job: Job, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);

  if (job.attempts >= job.maxAttempts) {
    await db.update(jobs).set({ status: "dead", error: message, updatedAt: new Date() }).where(eq(jobs.id, job.id));
    // 'dead' rows need operator attention — alert via metric/dead_letter table polled by ops.
    ctxLog().error({ action: "job.dead", jobId: job.id, type: job.type, error: message }, "job dead-lettered");
    return;
  }

  const backoffSec = Math.min(30, 2 ** job.attempts);
  await db.execute(sql`
    UPDATE jobs
    SET status = 'pending', claimed_at = NULL,
        claim_expires_at = NULL, error = ${message},
        run_after = now() + make_interval(secs => ${backoffSec}),
        updated_at = now()
    WHERE id = ${job.id}
  `);
  ctxLog().warn({ action: "job.requeue", jobId: job.id, attempts: job.attempts, backoffSec }, "job requeued");
}

export async function enqueue(type: string, payload: unknown, priority = 0): Promise<void> {
  await db.insert(jobs).values({ type, payload: payload as object, priority });
}

// Fail a job by id (used by the export sidecar, which never holds the Job object itself).
export async function failJobById(jobId: string, err: unknown): Promise<void> {
  const [row] = await db
    .select({ id: jobs.id, type: jobs.type, payload: jobs.payload, attempts: jobs.attempts, maxAttempts: jobs.maxAttempts })
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1);
  if (row) await failJob(row, err);
}
