import crypto from "node:crypto";

// Opaque bearer tokens for share links / invites. Only the hash is persisted; the raw token is
// shown to the creator once and is unrecoverable thereafter.
export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("hex");
}

export function sha256Hex(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}
