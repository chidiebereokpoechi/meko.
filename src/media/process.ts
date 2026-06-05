import { eq } from "drizzle-orm";
import { db } from "@/db/client.ts";
import { media } from "@/db/schema.ts";
import { config } from "@/config.ts";
import { ctxLog } from "@/lib/logger.ts";
import { getBytes, putBytes } from "@/lib/storage.ts";
import { displayKey, thumbKey } from "@/media/keys.ts";
import { sniff, transcode } from "@/media/transcode.ts";

const DISPLAY_EXT: Record<string, string> = { "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

// Worker job: download the raw upload, verify it's a real image by sniffing bytes (§6e), then
// re-encode into sanitised display + thumbnail derivatives. The original is kept untouched but is
// only reachable through the edit-gated /original route.
export async function processUpload(mediaId: string): Promise<void> {
  const row = await db.query.media.findFirst({ where: eq(media.id, mediaId) });
  if (!row) return;

  try {
    const raw = await getBytes(row.originalKey);
    if (raw.byteLength > config.MEKO_MAX_UPLOAD_BYTES) throw new Error("upload exceeds size limit");

    const kind = sniff(raw);
    if (kind === "unknown") throw new Error("not a recognised image");

    const { display, thumb } = await transcode(raw, kind);
    const dKey = displayKey(row.boardId, mediaId, DISPLAY_EXT[display.contentType] ?? "webp");
    const tKey = thumbKey(row.boardId, mediaId);

    await putBytes(dKey, display.bytes, display.contentType);
    await putBytes(tKey, thumb.bytes, thumb.contentType);

    await db
      .update(media)
      .set({ status: "ready", displayKey: dKey, thumbKey: tKey, bytes: raw.byteLength })
      .where(eq(media.id, mediaId));
    ctxLog().info({ action: "media.ready", mediaId, kind }, "media processed");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(media).set({ status: "failed", error: message }).where(eq(media.id, mediaId));
    ctxLog().warn({ action: "media.failed", mediaId, error: message }, "media processing failed");
    throw err; // surface to the queue for retry/dead-letter
  }
}
