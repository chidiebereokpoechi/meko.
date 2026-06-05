import { beforeAll, expect, test } from "bun:test";
import * as Y from "yjs";
import { sql } from "drizzle-orm";
import { directDb } from "@/db/client.ts";
import { boards, users, workspaces, yjsSnapshots, yjsUpdates } from "@/db/schema.ts";
import { config } from "@/config.ts";
import { appendUpdate, compactBoard, loadDoc } from "@/realtime/persistence.ts";

// §5c/5i: compaction folds updates into a snapshot, prunes folded updates, and keeps at most
// MEKO_SNAPSHOT_RETENTION snapshots per board. loadDoc must reconstruct identical state across
// many compaction cycles.
let boardId: string;

beforeAll(async () => {
  const db = directDb();
  const [u] = await db.insert(users).values({ email: `p${Date.now()}@x.test`, displayName: "P" }).returning();
  const [w] = await db.insert(workspaces).values({ name: "P", ownerId: u!.id }).returning();
  const [b] = await db.insert(boards).values({ workspaceId: w!.id, title: "P" }).returning();
  boardId = b!.id;
});

async function countRows(table: "yjs_snapshots" | "yjs_updates"): Promise<number> {
  const db = directDb();
  const t = table === "yjs_snapshots" ? yjsSnapshots : yjsUpdates;
  const res = await db.execute<{ n: string }>(sql`SELECT COUNT(*)::text AS n FROM ${t} WHERE board_id = ${boardId}`);
  return Number(res.rows[0]!.n);
}

test("compaction folds updates, caps snapshots, and preserves state", async () => {
  const doc = new Y.Doc();
  const map = doc.getMap("m");

  // 6 compaction cycles — more than the retention limit (3).
  for (let i = 1; i <= 6; i++) {
    map.set(`k${i}`, i);
    await appendUpdate(boardId, Y.encodeStateAsUpdate(doc));
    const didCompact = await compactBoard(boardId);
    expect(didCompact).toBe(true);
  }

  // Folded updates are gone.
  expect(await countRows("yjs_updates")).toBe(0);
  // Snapshots are capped at the retention limit.
  expect(await countRows("yjs_snapshots")).toBeLessThanOrEqual(config.MEKO_SNAPSHOT_RETENTION);

  // State is fully reconstructable from the latest snapshot.
  const loaded = await loadDoc(boardId);
  const m = loaded.getMap("m");
  for (let i = 1; i <= 6; i++) expect(m.get(`k${i}`)).toBe(i);
});

test("compactBoard on an empty board is a no-op", async () => {
  const db = directDb();
  const [b] = await db.insert(boards).values({ workspaceId: (await db.select().from(boards).limit(1))[0]!.workspaceId, title: "empty" }).returning();
  expect(await compactBoard(b!.id)).toBe(false);
});
