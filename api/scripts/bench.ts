import * as Y from "yjs";
import { eq, sql } from "drizzle-orm";
import { directDb, db, closeDb } from "@/db/client.ts";
import { boards, jobs, users, workspaces } from "@/db/schema.ts";
import { appendUpdate, loadDoc } from "@/realtime/persistence.ts";
import { claimJob, completeJob, enqueue } from "@/worker/queue.ts";
import { closeRedis } from "@/lib/redis.ts";

// Performance regression guard (§14e). Run: `bun run bench`. Exits non-zero if any metric breaches
// its budget so it can fail CI. Budgets are deliberately generous — they catch order-of-magnitude
// regressions, not micro-noise.

const results: { name: string; ms: number; budgetMs: number }[] = [];
const time = async (name: string, budgetMs: number, fn: () => Promise<void>) => {
  const t = performance.now();
  await fn();
  const ms = Math.round(performance.now() - t);
  results.push({ name, ms, budgetMs });
  console.log(`${ms <= budgetMs ? "ok  " : "SLOW"} ${name}: ${ms}ms (budget ${budgetMs}ms)`);
};

async function main() {
  const d = directDb();
  const [u] = await d.insert(users).values({ email: `bench${Date.now()}@x.test`, displayName: "B" }).returning();
  const [w] = await d.insert(workspaces).values({ name: "bench", ownerId: u!.id }).returning();
  const [board] = await d.insert(boards).values({ workspaceId: w!.id, title: "bench" }).returning();
  const boardId = board!.id;

  // Board load: 10k elements in the Yjs doc, then time a cold loadDoc (§14e: < 2s).
  const doc = new Y.Doc();
  const m = doc.getMap("elements");
  for (let i = 0; i < 10_000; i++) {
    m.set(`e${i}`, { id: `e${i}`, type: "note", x: i, y: i, w: 10, h: 10, text: `n${i}` });
  }
  await appendUpdate(boardId, Y.encodeStateAsUpdate(doc));
  await time("board-load (10k elements)", 2000, async () => {
    const loaded = await loadDoc(boardId);
    if (loaded.getMap("elements").size !== 10_000) throw new Error("element count mismatch");
  });

  // Job throughput: enqueue 1000 jobs, drain them via the claim loop (§14e: < 60s).
  const N = 1000;
  await time(`job-throughput (${N} jobs enqueue+drain)`, 60_000, async () => {
    await Promise.all(Array.from({ length: N }, (_, i) => enqueue("bench", { i })));
    let drained = 0;
    while (drained < N) {
      const job = await claimJob({ type: "bench" });
      if (!job) break;
      await completeJob(job.id);
      drained++;
    }
    if (drained !== N) throw new Error(`drained ${drained}/${N}`);
  });

  // Cleanup bench rows.
  await db.delete(jobs).where(eq(jobs.type, "bench"));
  await db.execute(sql`DELETE FROM boards WHERE id = ${boardId}`);

  const breached = results.filter((r) => r.ms > r.budgetMs);
  await Promise.allSettled([closeDb(), closeRedis()]);
  if (breached.length) {
    console.error(`\n${breached.length} metric(s) over budget`);
    process.exit(1);
  }
  console.log("\nall benchmarks within budget");
  process.exit(0);
}

main();
