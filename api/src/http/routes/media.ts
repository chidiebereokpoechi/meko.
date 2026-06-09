import { Elysia, t } from "elysia";
import { eq } from "drizzle-orm";
import { db } from "@/db/client.ts";
import { media } from "@/db/schema.ts";
import { requireAuth } from "@/auth/middleware.ts";
import { requireBoardAccess } from "@/lib/permissions.ts";
import { enforceRateLimit } from "@/lib/rate-limit.ts";
import { mediaEnabled, presignGet, presignPut, putBytes } from "@/lib/storage.ts";
import { ALLOWED_UPLOAD_TYPES, rawKey } from "@/media/keys.ts";
import { fetchRemoteImage } from "@/media/fetch-image.ts";
import { SsrfError } from "@/lib/ssrf.ts";
import { enqueue } from "@/worker/queue.ts";

function ensureEnabled(set: { status?: number | string }) {
  if (!mediaEnabled) {
    set.status = 503;
    return { error: "MEDIA_DISABLED" };
  }
  return null;
}

export const mediaRoutes = new Elysia({ prefix: "/api" })
  .use(requireAuth)
  // Request a presigned PUT for a board upload. Edit access + 50/hour/user (§12m).
  .post(
    "/boards/:id/uploads",
    async ({ userId, params, body, set }) => {
      const disabled = ensureEnabled(set);
      if (disabled) return disabled;
      await requireBoardAccess(userId!, params.id, "edit");
      if (!ALLOWED_UPLOAD_TYPES.has(body.contentType)) {
        set.status = 415;
        return { error: "UNSUPPORTED_TYPE" };
      }
      await enforceRateLimit(`rl:user:${userId}:uploads`, 50, 3600);

      const [row] = await db
        .insert(media)
        .values({ boardId: params.id, ownerId: userId!, declaredType: body.contentType, originalKey: "" })
        .returning();
      const key = rawKey(params.id, row!.id);
      await db.update(media).set({ originalKey: key }).where(eq(media.id, row!.id));

      return { mediaId: row!.id, uploadUrl: presignPut(key, body.contentType), key };
    },
    { body: t.Object({ contentType: t.String({ maxLength: 100 }) }) },
  )
  // Import an image from an external URL (server-side, SSRF-guarded): fetch the bytes, store them as
  // the raw original, then run the same sniff + transcode pipeline as a normal upload. Used to copy
  // pasted/imported images (e.g. from Milanote) into meko's own storage. Edit access + 100/hour/user.
  .post(
    "/boards/:id/media/import",
    async ({ userId, params, body, set }) => {
      const disabled = ensureEnabled(set);
      if (disabled) return disabled;
      await requireBoardAccess(userId!, params.id, "edit");
      await enforceRateLimit(`rl:user:${userId}:media-import`, 100, 3600);

      let fetched: { bytes: Uint8Array; contentType: string };
      try {
        fetched = await fetchRemoteImage(body.url);
      } catch (err) {
        if (err instanceof SsrfError) {
          set.status = 422;
          return { error: "UNSAFE_OR_INVALID_URL" };
        }
        set.status = 502;
        return { error: "FETCH_FAILED" };
      }

      const [row] = await db
        .insert(media)
        .values({
          boardId: params.id,
          ownerId: userId!,
          declaredType: fetched.contentType,
          originalKey: "",
        })
        .returning();
      const key = rawKey(params.id, row!.id);
      await putBytes(key, fetched.bytes, fetched.contentType);
      await db
        .update(media)
        .set({ originalKey: key })
        .where(eq(media.id, row!.id));
      await enqueue("process-upload", { mediaId: row!.id }, 5);

      return { mediaId: row!.id };
    },
    { body: t.Object({ url: t.String({ maxLength: 2048 }) }) },
  )
  // Client signals the PUT finished; enqueue sniff + transcode (§6e).
  .post("/media/:id/complete", async ({ userId, params, set }) => {
    const row = await db.query.media.findFirst({ where: eq(media.id, params.id) });
    if (!row) {
      set.status = 404;
      return { error: "NOT_FOUND" };
    }
    await requireBoardAccess(userId!, row.boardId, "edit");
    await enqueue("process-upload", { mediaId: row.id }, 5);
    return { status: row.status };
  })
  // Resolve the display derivative (presigned GET). View access (§6e).
  .get("/media/:id", async ({ userId, params, set }) => {
    const row = await db.query.media.findFirst({ where: eq(media.id, params.id) });
    if (!row) {
      set.status = 404;
      return { error: "NOT_FOUND" };
    }
    await requireBoardAccess(userId!, row.boardId, "view");
    if (row.status !== "ready" || !row.displayKey) return { status: row.status };
    return {
      status: row.status,
      displayUrl: presignGet(row.displayKey),
      thumbUrl: row.thumbKey ? presignGet(row.thumbKey) : null,
    };
  })
  // Download the untouched original. Edit-gated: a read-only guest must never obtain a raw SVG
  // that may carry scripts (§6e).
  .get("/media/:id/original", async ({ userId, params, set }) => {
    const row = await db.query.media.findFirst({ where: eq(media.id, params.id) });
    if (!row) {
      set.status = 404;
      return { error: "NOT_FOUND" };
    }
    await requireBoardAccess(userId!, row.boardId, "edit");
    return { originalUrl: presignGet(row.originalKey) };
  });
