import { and, eq, isNotNull, lt, sql } from "drizzle-orm";
import { db } from "@/db/client.ts";
import { boards } from "@/db/schema.ts";
import { loadDoc } from "@/realtime/persistence.ts";
import { log } from "@/lib/logger.ts";

// A nested board is an orphan once no board-tile in its parent references it (tile deleted, or its
// creation undone). Cleanup is DEFERRED — never on tile-delete — so in-session undo restores the
// tile and keeps the board. The age floor avoids racing a just-created board whose tile hasn't yet
// landed in the parent doc, and keeps the undo window well clear of the hourly sweep. Deleting a
// parent cascades to its subtree (FK), so this only needs to handle live parents.
const AGE_FLOOR = "1 hour";

export async function cleanupOrphanBoards(ageFloor = AGE_FLOOR): Promise<number> {
  const candidates = await db
    .select({ id: boards.id, parentBoardId: boards.parentBoardId })
    .from(boards)
    .where(and(isNotNull(boards.parentBoardId), lt(boards.createdAt, sql`now() - ${sql.raw(`interval '${ageFloor}'`)}`)));
  if (!candidates.length) return 0;

  // Group children by parent so each parent doc is hydrated at most once.
  const byParent = new Map<string, string[]>();
  for (const c of candidates) {
    const arr = byParent.get(c.parentBoardId!) ?? [];
    arr.push(c.id);
    byParent.set(c.parentBoardId!, arr);
  }

  const orphans: string[] = [];
  for (const [parentId, childIds] of byParent) {
    // If the parent itself is gone, its children already cascaded — skip.
    const [parent] = await db.select({ id: boards.id }).from(boards).where(eq(boards.id, parentId)).limit(1);
    if (!parent) continue;
    const doc = await loadDoc(parentId);
    const referenced = new Set<string>();
    for (const el of doc.getMap("elements").values()) {
      const e = el as { type?: string; boardId?: string };
      if (e.type === "board" && e.boardId) referenced.add(e.boardId);
    }
    doc.destroy();
    for (const id of childIds) if (!referenced.has(id)) orphans.push(id);
  }

  if (!orphans.length) return 0;
  for (const id of orphans) await db.delete(boards).where(eq(boards.id, id));
  log.info({ action: "boards.orphan_cleanup", count: orphans.length }, "deleted orphan nested boards");
  return orphans.length;
}
