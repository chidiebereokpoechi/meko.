import crypto from "node:crypto";
import { config } from "@/config.ts";
import type { OidcProvider } from "@/config.ts";
import { securityEvent } from "@/lib/logger.ts";

// Minimal OIDC Authorization-Code + PKCE client for external IdPs (Authentik, Google). Hand-rolled
// with node:crypto + fetch to match meko's existing hand-rolled HS256 (auth/tokens.ts) — no
// jose/openid dependency. Every entry point takes the chosen OidcProvider; discovery/JWKS caches are
// keyed per provider. The IdP only authenticates; meko issues its own session afterwards (see routes).

export class OidcError extends Error {}

const b64url = (b: Buffer | Uint8Array) => Buffer.from(b).toString("base64url");
const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest();

// --- PKCE + nonce/state helpers ---

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("hex");
}

// PKCE S256: the verifier is a random secret; the challenge is its SHA-256, base64url-encoded.
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = b64url(crypto.randomBytes(32));
  return { verifier, challenge: b64url(sha256(verifier)) };
}

// --- Discovery + JWKS (cached) ---

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  end_session_endpoint?: string;
}

const discoveryCache = new Map<string, { doc: Discovery; at: number }>();
const DISCOVERY_TTL_MS = 60 * 60 * 1000; // 1h

export async function discover(provider: OidcProvider): Promise<Discovery> {
  const cached = discoveryCache.get(provider.id);
  if (cached && Date.now() - cached.at < DISCOVERY_TTL_MS) return cached.doc;
  const url = `${provider.issuer.replace(/\/$/, "")}/.well-known/openid-configuration`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new OidcError(`discovery failed: ${res.status}`);
  const doc = (await res.json()) as Discovery;
  if (!doc.authorization_endpoint || !doc.token_endpoint || !doc.jwks_uri) {
    throw new OidcError("discovery doc missing required endpoints");
  }
  discoveryCache.set(provider.id, { doc, at: Date.now() });
  return doc;
}

interface Jwk { kid: string; kty: string; alg?: string; use?: string; n?: string; e?: string }
const jwksCache = new Map<string, { keys: Jwk[]; at: number }>();
const JWKS_TTL_MS = 60 * 60 * 1000;

async function fetchJwks(provider: OidcProvider, force = false): Promise<Jwk[]> {
  const cached = jwksCache.get(provider.id);
  if (!force && cached && Date.now() - cached.at < JWKS_TTL_MS) return cached.keys;
  const { jwks_uri } = await discover(provider);
  const res = await fetch(jwks_uri, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new OidcError(`jwks fetch failed: ${res.status}`);
  const { keys } = (await res.json()) as { keys: Jwk[] };
  const fresh = keys ?? [];
  jwksCache.set(provider.id, { keys: fresh, at: Date.now() });
  return fresh;
}

// Find the signing key for a kid; on a miss, force-refresh once (handles IdP key rotation).
async function keyForKid(provider: OidcProvider, kid: string): Promise<crypto.KeyObject> {
  let jwk = (await fetchJwks(provider)).find((k) => k.kid === kid);
  if (!jwk) jwk = (await fetchJwks(provider, true)).find((k) => k.kid === kid);
  if (!jwk) throw new OidcError("no JWKS key for token kid");
  return crypto.createPublicKey({ key: jwk, format: "jwk" } as unknown as crypto.JsonWebKeyInput);
}

// --- Authorize URL ---

export async function buildAuthorizeUrl(provider: OidcProvider, args: { state: string; nonce: string; codeChallenge: string }): Promise<string> {
  const { authorization_endpoint } = await discover(provider);
  const q = new URLSearchParams({
    response_type: "code",
    client_id: provider.clientId,
    redirect_uri: config.OIDC_REDIRECT_URI,
    scope: "openid profile email",
    state: args.state,
    nonce: args.nonce,
    code_challenge: args.codeChallenge,
    code_challenge_method: "S256",
  });
  return `${authorization_endpoint}?${q.toString()}`;
}

// --- Code exchange ---

async function exchangeCode(provider: OidcProvider, code: string, codeVerifier: string): Promise<string> {
  const { token_endpoint } = await discover(provider);
  const basic = Buffer.from(`${provider.clientId}:${provider.clientSecret}`).toString("base64");
  const res = await fetch(token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${basic}` },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.OIDC_REDIRECT_URI,
      code_verifier: codeVerifier,
    }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    securityEvent("auth.oidc_token_exchange_failed", { status: res.status });
    throw new OidcError(`token exchange failed: ${res.status}`);
  }
  const tok = (await res.json()) as { id_token?: string };
  if (!tok.id_token) throw new OidcError("token response missing id_token");
  return tok.id_token;
}

// --- ID token verification ---

export interface OidcClaims {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
}

interface RawIdClaims {
  iss?: string; aud?: string | string[]; exp?: number; iat?: number; nonce?: string;
  sub?: string; email?: string; email_verified?: boolean; name?: string; preferred_username?: string;
}

// Verify the RS256 signature against the IdP JWKS, then validate iss/aud/exp/iat/nonce.
export async function verifyIdToken(provider: OidcProvider, idToken: string, expectedNonce: string): Promise<OidcClaims> {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new OidcError("malformed id_token");
  const [h, p, s] = parts as [string, string, string];

  let header: { alg?: string; kid?: string };
  let claims: RawIdClaims;
  try {
    header = JSON.parse(Buffer.from(h, "base64url").toString());
    claims = JSON.parse(Buffer.from(p, "base64url").toString());
  } catch {
    throw new OidcError("id_token not valid JSON");
  }
  if (header.alg !== "RS256") throw new OidcError(`unsupported id_token alg: ${header.alg}`);
  if (!header.kid) throw new OidcError("id_token missing kid");

  const key = await keyForKid(provider, header.kid);
  const ok = crypto.verify("RSA-SHA256", Buffer.from(`${h}.${p}`), key, Buffer.from(s, "base64url"));
  if (!ok) {
    securityEvent("auth.oidc_invalid", { reason: "bad_signature" });
    throw new OidcError("id_token signature invalid");
  }

  const { issuer } = await discover(provider);
  const now = Math.floor(Date.now() / 1000);
  const skew = 60;
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const fail = (reason: string) => {
    securityEvent("auth.oidc_invalid", { reason });
    throw new OidcError(`id_token ${reason}`);
  };

  if (claims.iss !== issuer) fail("wrong_issuer");
  if (!aud.includes(provider.clientId)) fail("wrong_audience");
  if (typeof claims.exp !== "number" || claims.exp + skew < now) fail("expired");
  if (typeof claims.iat !== "number" || claims.iat - skew > now) fail("future_iat");
  if (claims.nonce !== expectedNonce) fail("nonce_mismatch");
  if (!claims.sub) fail("missing_sub");
  if (!claims.email) fail("missing_email");

  return {
    sub: claims.sub!,
    email: claims.email!.toLowerCase(),
    emailVerified: claims.email_verified === true,
    name: claims.name ?? claims.preferred_username,
  };
}

// Full callback verification: exchange the code, then verify the returned id_token.
export async function completeLogin(provider: OidcProvider, code: string, codeVerifier: string, expectedNonce: string): Promise<OidcClaims> {
  const idToken = await exchangeCode(provider, code, codeVerifier);
  return verifyIdToken(provider, idToken, expectedNonce);
}
