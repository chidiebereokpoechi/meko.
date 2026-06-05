import { afterAll, beforeAll, expect, test } from "bun:test";
import * as Y from "yjs";
import { eq, sql } from "drizzle-orm";
import { directDb } from "@/db/client.ts";
import { boards, users, workspaces, members } from "@/db/schema.ts";
import { appendUpdate } from "@/realtime/persistence.ts";
import { cleanupOrphanBoards } from "@/worker/orphans.ts";

// Orphan nested-board cleanup: a nested board with no referencing tile in its parent doc is
// reaped; one still referenced survives. Deferred + age-floored so in-session undo is safe.
const db = directDb();
let wsId: string, parentId: string, referencedId: string, orphanId: string;

beforeAll(async () => {
  const [u] = await db.insert(users).values({ email: `orph${Date.now()}@x.test`, displayName: "orph" }).returning();
  const [ws] = await db.insert(workspaces).values({ name: "WS", ownerId: u!.id }).returning();
  wsId = ws!.id;
  await db.insert(members).values({ workspaceId: wsId, userId: u!.id, role: "owner" });
  const [parent] = await db.insert(boards).values({ workspaceId: wsId, title: "Parent" }).returning();
  parentId = parent!.id;
  const [ref] = await db.insert(boards).values({ workspaceId: wsId, title: "Referenced", parentBoardId: parentId }).returning();
  const [orph] = await db.insert(boards).values({ workspaceId: wsId, title: "Orphan", parentBoardId: parentId }).returning();
  referencedId = ref!.id;
  orphanId = orph!.id;

  // Parent doc references only the "referenced" child via a board tile.
  const doc = new Y.Doc();
  doc.getMap("elements").set("tile1", { id: "tile1", type: "board", x: 0, y: 0, w: 200, h: 100, boardId: referencedId });
  await appendUpdate(parentId, Y.encodeStateAsUpdate(doc));
});

afterAll(async () => {
  await db.delete(workspaces).where(eq(workspaces.id, wsId)); // cascades boards/members
});

test("orphan nested board is deleted; referenced one survives", async () => {
  // Age floor of 0 so the freshly-created rows qualify.
  const n = await cleanupOrphanBoards("0 seconds");
  expect(n).toBeGreaterThanOrEqual(1);

  const left = await db.select({ id: boards.id }).from(boards).where(eq(boards.parentBoardId, parentId));
  const ids = left.map((r) => r.id);
  expect(ids).toContain(referencedId);
  expect(ids).not.toContain(orphanId);
});

test("age floor protects recently-orphaned boards", async () => {
  // Re-add an orphan, leave the parent doc referencing only `referencedId`, run with a 1h floor.
  const [fresh] = await db.insert(boards).values({ workspaceId: wsId, title: "Fresh", parentBoardId: parentId }).returning();
  const n = await cleanupOrphanBoards("1 hour");
  expect(n).toBe(0);
  const [still] = await db.select({ id: boards.id }).from(boards).where(eq(boards.id, fresh!.id)).limit(1);
  expect(still?.id).toBe(fresh!.id);
  // sanity: the column predicate compiled
  void sql;
});
