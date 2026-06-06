import { afterAll, beforeAll, expect, test } from "bun:test";
import crypto from "node:crypto";

// OIDC login routes driven against a FAKE in-test IdP (no Authentik needed) — exercises the real
// /api/auth/oidc/login + /callback routes, src/auth/oidc.ts (discovery, JWKS, RS256 verify, PKCE
// exchange) and JIT provisioning end to end. A live Authentik round trip stays out of CI.

const NODE_PORT = 3302;
const IDP_PORT = 3399;
const BASE = `http://localhost:${NODE_PORT}`;
const ISSUER = `http://localhost:${IDP_PORT}`;
const WEB = "http://localhost:5999";
const CLIENT_ID = "meko-test";

// RSA signing key for the fake IdP; its public half is published as JWKS.
const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const KID = "test-key-1";
const jwk = { ...(publicKey.export({ format: "jwk" }) as Record<string, unknown>), kid: KID, alg: "RS256", use: "sig" };

const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64url");
// Mint an RS256 id_token the way Authentik would, so oidc.ts verifies it for real.
function signIdToken(claims: Record<string, unknown>): string {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: KID }));
  const payload = b64url(JSON.stringify(claims));
  const sig = crypto.sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), privateKey).toString("base64url");
  return `${header}.${payload}.${sig}`;
}

let idp: ReturnType<typeof Bun.serve>;
let node: ReturnType<typeof Bun.spawn>;

beforeAll(async () => {
  // Fake IdP: discovery + JWKS + token endpoint. The `code` the test sends to /callback encodes the
  // claims (incl. the nonce read from the authorize redirect) so /token can echo a matching token.
  idp = Bun.serve({
    port: IDP_PORT,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/.well-known/openid-configuration")
        return Response.json({
          issuer: ISSUER,
          authorization_endpoint: `${ISSUER}/authorize`,
          token_endpoint: `${ISSUER}/token`,
          jwks_uri: `${ISSUER}/jwks`,
        });
      if (url.pathname === "/jwks") return Response.json({ keys: [jwk] });
      if (url.pathname === "/token") {
        const body = new URLSearchParams(await req.text());
        const code = JSON.parse(Buffer.from(body.get("code") ?? "", "base64url").toString());
        const now = Math.floor(Date.now() / 1000);
        const id_token = signIdToken({ iss: ISSUER, aud: CLIENT_ID, iat: now, exp: now + 300, ...code });
        return Response.json({ id_token, access_token: "x", token_type: "Bearer" });
      }
      return new Response("not found", { status: 404 });
    },
  });

  node = Bun.spawn(["bun", "run", "src/index.ts"], {
    env: {
      ...process.env,
      PORT: String(NODE_PORT),
      NODE_ID: "oidc",
      LOG_LEVEL: "warn",
      MEKO_ALLOWED_ORIGINS: "http://localhost",
      OIDC_ISSUER: ISSUER,
      OIDC_CLIENT_ID: CLIENT_ID,
      OIDC_CLIENT_SECRET: "test-secret",
      OIDC_REDIRECT_URI: `${BASE}/api/auth/oidc/callback`,
      MEKO_WEB_URL: WEB,
    },
    stdout: "inherit",
    stderr: "inherit",
  });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/healthz`)).ok) break;
    } catch {}
    await Bun.sleep(250);
  }
});

afterAll(() => {
  node?.kill();
  idp?.stop(true);
});

const ip = (n: string) => ({ "x-forwarded-for": n });

// Drive /login (without following redirects), returning the authorize params + the tx cookie.
async function startLogin(xff: string) {
  const res = await fetch(`${BASE}/api/auth/oidc/login`, { headers: ip(xff), redirect: "manual" });
  expect(res.status).toBe(302);
  const loc = new URL(res.headers.get("location")!);
  expect(loc.origin + loc.pathname).toBe(`${ISSUER}/authorize`);
  expect(loc.searchParams.get("code_challenge_method")).toBe("S256");
  const txCookie = (res.headers.get("set-cookie") ?? "").split(";")[0]!;
  return { state: loc.searchParams.get("state")!, nonce: loc.searchParams.get("nonce")!, txCookie };
}

test("happy path: login → callback provisions user, issues meko refresh cookie, redirects to web", async () => {
  const { state, nonce, txCookie } = await startLogin("11.0.0.1");
  const email = `oidc_${Date.now()}@x.test`;
  const code = b64url(JSON.stringify({ sub: `sub-${Date.now()}`, email, email_verified: true, name: "OIDC User", nonce }));

  const res = await fetch(`${BASE}/api/auth/oidc/callback?code=${code}&state=${state}`, {
    headers: { ...ip("11.0.0.1"), cookie: txCookie },
    redirect: "manual",
  });
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe(WEB);
  const setCookie = res.headers.get("set-cookie") ?? "";
  expect(setCookie).toContain("refresh_token=");
  expect(setCookie).toContain("HttpOnly");
});

test("state mismatch is rejected → redirect with auth_error", async () => {
  const { nonce, txCookie } = await startLogin("11.0.0.2");
  const code = b64url(JSON.stringify({ sub: "s2", email: "s2@x.test", email_verified: true, nonce }));
  const res = await fetch(`${BASE}/api/auth/oidc/callback?code=${code}&state=WRONG`, {
    headers: { ...ip("11.0.0.2"), cookie: txCookie },
    redirect: "manual",
  });
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe(`${WEB}/?auth_error=state_mismatch`);
});

test("missing tx cookie is rejected", async () => {
  const { state } = await startLogin("11.0.0.3");
  const res = await fetch(`${BASE}/api/auth/oidc/callback?code=abc&state=${state}`, {
    headers: ip("11.0.0.3"),
    redirect: "manual",
  });
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe(`${WEB}/?auth_error=missing_params`);
});

test("returning user (same sub) reuses the same account", async () => {
  const sub = `sub-stable-${Date.now()}`;
  const email = `stable_${Date.now()}@x.test`;
  const run = async (xff: string) => {
    const { state, nonce, txCookie } = await startLogin(xff);
    const code = b64url(JSON.stringify({ sub, email, email_verified: true, name: "Stable", nonce }));
    const res = await fetch(`${BASE}/api/auth/oidc/callback?code=${code}&state=${state}`, {
      headers: { ...ip(xff), cookie: txCookie },
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(WEB);
  };
  await run("11.0.0.4");
  await run("11.0.0.5"); // second login, same sub — must not error on the unique(oidc_sub) index
});
