import { api } from "./api.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Phase-4 upload flow: presign a PUT, upload the bytes straight to object storage (no auth header
// — the presigned URL carries its own signature), signal completion, then poll until the worker
// has transcoded the derivatives. Returns the durable mediaId + a fresh display URL.
export async function uploadImage(boardId: string, file: File): Promise<{ mediaId: string; displayUrl: string }> {
  const { mediaId, uploadUrl } = await api<{ mediaId: string; uploadUrl: string }>(
    `/api/boards/${boardId}/uploads`,
    { method: "POST", body: JSON.stringify({ contentType: file.type }) },
  );

  const put = await fetch(uploadUrl, { method: "PUT", body: file, headers: { "content-type": file.type } });
  if (!put.ok) throw new Error(`upload failed (${put.status}) — check object-store CORS for browser PUT`);

  await api(`/api/media/${mediaId}/complete`, { method: "POST" });

  for (let i = 0; i < 30; i++) {
    const m = await api<{ status: string; displayUrl?: string }>(`/api/media/${mediaId}`);
    if (m.status === "ready" && m.displayUrl) return { mediaId, displayUrl: m.displayUrl };
    if (m.status === "failed") throw new Error("media processing failed");
    await sleep(500);
  }
  throw new Error("media processing timed out");
}

// Import an external image URL into meko storage (server-side fetch + transcode). Returns the new
// mediaId; the display derivative is produced asynchronously (resolve it like any uploaded media).
export async function importImage(
  boardId: string,
  url: string,
): Promise<string> {
  const { mediaId } = await api<{ mediaId: string }>(
    `/api/boards/${boardId}/media/import`,
    { method: "POST", body: JSON.stringify({ url }) },
  );
  return mediaId;
}

// Re-resolve a fresh presigned display URL for a stored mediaId (the URL baked into an element
// expires). Returns null if not ready / not found.
export async function resolveMedia(mediaId: string): Promise<string | null> {
  try {
    const m = await api<{ status: string; displayUrl?: string }>(`/api/media/${mediaId}`);
    return m.status === "ready" ? (m.displayUrl ?? null) : null;
  } catch {
    return null;
  }
}
