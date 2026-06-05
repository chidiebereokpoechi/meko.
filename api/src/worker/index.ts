import { config } from "@/config.ts";
import { log } from "@/lib/logger.ts";
import { closeDb } from "@/db/client.ts";
import { closeRedis } from "@/lib/redis.ts";
import { claimJob, completeJob, enqueue, failJob, type Job } from "@/worker/queue.ts";
import { compactBoard, findStaleBoards } from "@/realtime/persistence.ts";
import { processUpload } from "@/media/process.ts";
import { cleanupOrphanBoards } from "@/worker/orphans.ts";
import { sql } from "drizzle-orm";
import { db } from "@/db/client.ts";

// Job handlers keyed by type. Export/email land in later phases.
const handlers: Record<string, (payload: any) => Promise<void>> = {
  async compact({ boardId }: { boardId: string }) {
    await compactBoard(boardId);
  },
  async "process-upload"({ mediaId }: { mediaId: string }) {
    await processUpload(mediaId);
  },
  // Reclaim expired ephemera so high-churn tables don't accumulate dead rows (§13a).
  async cleanup() {
    await db.execute(sql`DELETE FROM idempotency_keys WHERE expires_at < now()`);
    await db.execute(sql`DELETE FROM refresh_tokens WHERE expires_at < now()`);
    await db.execute(sql`DELETE FROM invites WHERE expires_at < now() AND accepted_at IS NULL`);
    await db.execute(sql`DELETE FROM share_links WHERE expires_at IS NOT NULL AND expires_at < now()`);
    await cleanupOrphanBoards();
  },
};

async function runOne(job: Job): Promise<void> {
  const handler = handlers[job.type];
  if (!handler) throw new Error(`no handler for job type "${job.type}"`);
  await handler(job.payload);
}

let running = true;

// Poll loop. Empty queue → short idle sleep; otherwise drain back-to-back.
async function workLoop(): Promise<void> {
  while (running) {
    let job: Job | null = null;
    try {
      // Export rendering is handled by the isolated Chromium sidecar, not here (§8b).
      job = await claimJob({ notType: "export" });
    } catch (err) {
      log.error({ err, action: "job.claim_fail" }, "claim failed");
      await sleep(1000);
      continue;
    }
    if (!job) {
      await sleep(500);
      continue;
    }
    try {
      await runOne(job);
      await completeJob(job.id);
    } catch (err) {
      await failJob(job, err);
    }
  }
}

// Time-based compaction (§5h): enqueue compaction for boards that never go idle. Every node
// runs this; the transaction-scoped advisory lock in compactBoard makes duplicates harmless.
async function periodicCompaction(): Promise<void> {
  try {
    const boards = await findStaleBoards();
    for (const boardId of boards) await enqueue("compact", { boardId });
    if (boards.length) log.info({ action: "compact.scheduled", count: boards.length }, "scheduled compaction");
    // Hourly expired-ephemera sweep (§13a / idempotency-key cleanup open question).
    await enqueue("cleanup", {});
  } catch (err) {
    log.error({ err, action: "compact.schedule_fail" }, "periodic compaction scan failed");
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function shutdown() {
  running = false;
  clearInterval(compactionTimer);
  await sleep(200);
  await Promise.allSettled([closeDb(), closeRedis()]);
  process.exit(0);
}

const compactionTimer = setInterval(periodicCompaction, 60 * 60 * 1000);
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

log.info({ action: "worker.start", nodeId: config.NODE_ID }, "worker started");
workLoop();
