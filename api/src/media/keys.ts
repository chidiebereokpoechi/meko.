// Object key layout. Derivatives live beside the raw upload under a per-board prefix so a board
// delete can prune the whole prefix.
export const rawKey = (boardId: string, mediaId: string) => `boards/${boardId}/raw/${mediaId}`;
export const displayKey = (boardId: string, mediaId: string, ext: string) => `boards/${boardId}/display/${mediaId}.${ext}`;
export const thumbKey = (boardId: string, mediaId: string) => `boards/${boardId}/thumb/${mediaId}.webp`;

// Content types accepted at presign time. The worker still re-sniffs the actual bytes (§6e).
export const ALLOWED_UPLOAD_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
]);
