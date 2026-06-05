import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db/client.ts";
import { refreshTokens } from "@/db/schema.ts";
import { config } from "@/config.ts";
import { securityEvent } from "@/lib/logger.ts";

// --- Access token (short-lived JWT, lives in client JS memory only — §9g) ---

interface AccessClaims {
  sub: string; // userId
  iss: "meko";
  iat: number;
  exp: number;
}

const b64url = (b: Buffer) => b.toString("base64url");

export function mintAccessToken(userId: string): string {
  const header = b64url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const iat = Math.floor(Date.now() / 1000);
  const payload: AccessClaims = { sub: userId, iss: "meko", iat, exp: iat + config.ACCESS_TOKEN_TTL_SECONDS };
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = b64url(crypto.createHmac("sha256", config.JWT_SECRET).update(`${header}.${body}`).digest());
  return `${header}.${body}.${sig}`;
}

export function verifyAccessToken(token: string): AccessClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts as [string, string, string];
  const expected = b64url(crypto.createHmac("sha256", config.JWT_SECRET).update(`${header}.${body}`).digest());
  // Constant-time compare to avoid signature timing oracles.
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    securityEvent("auth.jwt_invalid", { reason: "bad_signature" });
    return null;
  }
  let claims: AccessClaims;
  try {
    claims = JSON.parse(Buffer.from(body, "base64url").toString());
  } catch {
    return null;
  }
  if (claims.iss !== "meko") {
    securityEvent("auth.jwt_invalid", { reason: "wrong_issuer" });
    return null;
  }
  if (claims.exp < Math.floor(Date.now() / 1000)) {
    securityEvent("auth.jwt_invalid", { reason: "expired" });
    return null;
  }
  return claims;
}

// --- Refresh token (opaque, HttpOnly cookie — §9h) ---

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

export class AuthError extends Error {}

export interface RefreshResult {
  newRawToken: string;
  userId: string;
}

// Rotate on EVERY valid refresh, not only on reuse (§9h). A stolen token is then usable at
// most once before the legitimate user's next refresh invalidates the family.
export async function rotateRefreshToken(rawToken: string): Promise<RefreshResult> {
  const hash = sha256(rawToken);
  const record = await db.query.refreshTokens.findFirst({ where: eq(refreshTokens.tokenHash, hash) });

  if (!record || record.revokedAt || record.expiresAt < new Date()) {
    throw new AuthError("INVALID_REFRESH_TOKEN");
  }

  if (record.usedAt) {
    // Reuse of an already-rotated token => theft. Revoke the whole family.
    await db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.familyId, record.familyId));
    securityEvent("auth.refresh_reuse", { familyId: record.familyId, userId: record.userId });
    throw new AuthError("TOKEN_REUSE_FAMILY_REVOKED");
  }

  await db.update(refreshTokens).set({ usedAt: new Date() }).where(eq(refreshTokens.id, record.id));

  const newRawToken = crypto.randomBytes(32).toString("hex");
  await db.insert(refreshTokens).values({
    familyId: record.familyId,
    userId: record.userId,
    tokenHash: sha256(newRawToken),
    deviceHint: record.deviceHint,
    ipHint: record.ipHint,
    expiresAt: addDays(new Date(), config.REFRESH_TOKEN_TTL_DAYS),
  });

  return { newRawToken, userId: record.userId };
}

// Mint the first token of a new family (login / signup).
export async function issueRefreshFamily(userId: string, deviceHint?: string, ipHint?: string): Promise<string> {
  const familyId = crypto.randomUUID();
  const rawToken = crypto.randomBytes(32).toString("hex");
  await db.insert(refreshTokens).values({
    familyId,
    userId,
    tokenHash: sha256(rawToken),
    deviceHint,
    ipHint,
    expiresAt: addDays(new Date(), config.REFRESH_TOKEN_TTL_DAYS),
  });
  return rawToken;
}

// Set-Cookie value scoped to the auth endpoints only (§9h).
export function refreshCookie(rawToken: string): string {
  const maxAge = config.REFRESH_TOKEN_TTL_DAYS * 86_400;
  return `refresh_token=${rawToken}; HttpOnly; Secure; SameSite=Strict; Path=/api/auth; Max-Age=${maxAge}`;
}

export const clearRefreshCookie = "refresh_token=; HttpOnly; Secure; SameSite=Strict; Path=/api/auth; Max-Age=0";
