import crypto from "node:crypto";
import * as Y from "yjs";
import { and, asc, desc, eq, lte, sql } from "drizzle-orm";
import { db } from "@/db/client.ts";
import { yjsSnapshots, yjsUpdates } from "@/db/schema.ts";
import { config } from "@/config.ts";
import { ctxLog } from "@/lib/logger.ts";

// Postgres is the source of truth for board state (§3e). Redis is only the incremental bus.

// Stable 31-bit advisory-lock key for a board UUID. Used with the transaction-scoped lock
// pg_try_advisory_xact_lock, which is SAFE through PgBouncer (released at COMMIT) (§3d/5c).
const LOCK_NAMESPACE = 0x6d656b6f; // "meko"
function lockKey(boardId: string): number {
  const h = crypto.createHash("sha256").update(boardId).digest();
  return h.readUInt32BE(0) & 0x7fffffff;
}

// Hydrate a Y.Doc from the latest snapshot + every update that came after it (§5c).
export async function loadDoc(boardId: string): Promise<Y.Doc> {
  const doc = new Y.Doc();
  const [snap] = await db
    .select()
    .from(yjsSnapshots)
    .where(eq(yjsSnapshots.boardId, boardId))
    .orderBy(desc(yjsSnapshots.id))
    .limit(1);

  if (snap) Y.applyUpdate(doc, snap.snapshot);

  const updates = await db
    .select({ update: yjsUpdates.update })
    .from(yjsUpdates)
    .where(eq(yjsUpdates.boardId, boardId))
    .orderBy(asc(yjsUpdates.id));

  for (const { update } of updates) Y.applyUpdate(doc, update);
  return doc;
}

export async function appendUpdate(boardId: string, update: Uint8Array): Promise<void> {
  await db.insert(yjsUpdates).values({ boardId, update });
}

// Compact a board: snapshot current state, delete the updates folded into it, prune old
// snapshots. Guarded by a transaction-scoped advisory lock so concurrent nodes don't double up;
// the loser simply skips (§5c/5i). Returns true if this caller did the compaction.
export async function compactBoard(boardId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const lockRes = await tx.execute<{ locked: boolean }>(
      sql`SELECT pg_try_advisory_xact_lock(${LOCK_NAMESPACE}, ${lockKey(boardId)}) AS locked`,
    );
    if (!lockRes.rows[0]?.locked) return false;

    // Capture the high-water mark BEFORE building the snapshot so updates written concurrently
    // (after this id) survive and are replayed on top of the snapshot.
    const maxRes = await tx.execute<{ maxId: string | null }>(
      sql`SELECT MAX(id)::text AS "maxId" FROM yjs_updates WHERE board_id = ${boardId}`,
    );
    const maxId = maxRes.rows[0]?.maxId ?? null;
    if (maxId === null) return false; // nothing to compact

    const doc = new Y.Doc();
    const snap = await tx
      .select()
      .from(yjsSnapshots)
      .where(eq(yjsSnapshots.boardId, boardId))
      .orderBy(desc(yjsSnapshots.id))
      .limit(1);
    if (snap[0]) Y.applyUpdate(doc, snap[0].snapshot);

    const rows = await tx
      .select({ id: yjsUpdates.id, update: yjsUpdates.update })
      .from(yjsUpdates)
      .where(and(eq(yjsUpdates.boardId, boardId), lte(yjsUpdates.id, Number(maxId))))
      .orderBy(asc(yjsUpdates.id));
    for (const r of rows) Y.applyUpdate(doc, r.update);

    await tx.insert(yjsSnapshots).values({ boardId, snapshot: Y.encodeStateAsUpdate(doc) });

    // Delete only the updates folded into this snapshot (id <= maxId).
    await tx.delete(yjsUpdates).where(and(eq(yjsUpdates.boardId, boardId), lte(yjsUpdates.id, Number(maxId))));

    // Keep MEKO_SNAPSHOT_RETENTION most-recent snapshots as corruption fallback (§5i).
    await tx.execute(sql`
      DELETE FROM yjs_snapshots
      WHERE board_id = ${boardId}
        AND id NOT IN (
          SELECT id FROM yjs_snapshots WHERE board_id = ${boardId}
          ORDER BY id DESC LIMIT ${config.MEKO_SNAPSHOT_RETENTION}
        )
    `);

    ctxLog().info({ action: "yjs.compact", boardId, folded: rows.length }, "compacted board");
    return true;
  });
}

// Find boards needing compaction regardless of room activity (§5h): too many updates, or
// updates older than an hour. The periodic scheduler enqueues these.
export async function findStaleBoards(): Promise<string[]> {
  const res = await db.execute<{ board_id: string }>(sql`
    SELECT board_id
    FROM yjs_updates
    GROUP BY board_id
    HAVING COUNT(*) > 500 OR MIN(created_at) < now() - interval '1 hour'
  `);
  return res.rows.map((r) => r.board_id);
}
