import { afterAll, beforeAll, expect, test } from "bun:test";

// Auth hardening: signup/login, bad credentials, refresh rotation + reuse detection, IP rate limit.
const PORT = 3301;
const BASE = `http://localhost:${PORT}`;
let node: ReturnType<typeof Bun.spawn>;

// Distinct X-Forwarded-For per test so the IP rate-limit windows never collide across tests or
// reruns within the 60s TTL.
const hdr = (ip: string) => ({ "content-type": "application/json", "x-forwarded-for": ip });
const email = () => `u${Date.now()}_${Math.floor(performance.now() * 1000) % 100000}@x.test`;

function cookieFrom(res: Response): string | null {
  const sc = res.headers.get("set-cookie");
  return sc ? sc.split(";")[0]! : null; // "refresh_token=..."
}

async function waitHealthy() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/healthz`)).ok) return;
    } catch {}
    await Bun.sleep(250);
  }
  throw new Error("node never healthy");
}

beforeAll(async () => {
  node = Bun.spawn(["bun", "run", "src/index.ts"], {
    env: { ...process.env, PORT: String(PORT), NODE_ID: "auth", LOG_LEVEL: "warn", MEKO_ALLOWED_ORIGINS: "http://localhost", MEKO_SIGNUP_MODE: "open", MEKO_BOOTSTRAP_EMAILS: "" },
    stdout: "inherit",
    stderr: "inherit",
  });
  await waitHealthy();
});

afterAll(() => node?.kill());

test("signup issues access token + refresh cookie", async () => {
  const res = await fetch(`${BASE}/api/auth/signup`, {
    method: "POST",
    headers: hdr("10.0.0.1"),
    body: JSON.stringify({ email: email(), password: "supersecret", displayName: "U" }),
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.accessToken).toBeString();
  const cookie = cookieFrom(res);
  expect(cookie).toStartWith("refresh_token=");
  // Cookie must be HttpOnly + SameSite=Strict + scoped to /api/auth (§9g).
  const raw = res.headers.get("set-cookie") ?? "";
  expect(raw).toContain("HttpOnly");
  expect(raw).toContain("SameSite=Strict");
  expect(raw).toContain("Path=/api/auth");
});

test("GET /api/auth/me returns the bearer's identity (401 without a token)", async () => {
  const e = email();
  const signup = await fetch(`${BASE}/api/auth/signup`, { method: "POST", headers: hdr("10.0.0.7"), body: JSON.stringify({ email: e, password: "supersecret", displayName: "Mimi" }) });
  const { accessToken } = await signup.json();

  const me = await fetch(`${BASE}/api/auth/me`, { headers: { authorization: `Bearer ${accessToken}` } });
  expect(me.status).toBe(200);
  const body = await me.json();
  expect(body.email).toBe(e);
  expect(body.displayName).toBe("Mimi");
  expect(body.id).toBeString();

  const anon = await fetch(`${BASE}/api/auth/me`);
  expect(anon.status).toBe(401);
});

test("login with wrong password is 401", async () => {
  const e = email();
  await fetch(`${BASE}/api/auth/signup`, { method: "POST", headers: hdr("10.0.0.2"), body: JSON.stringify({ email: e, password: "rightpassword", displayName: "U" }) });
  const res = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: hdr("10.0.0.2"), body: JSON.stringify({ email: e, password: "wrongpassword" }) });
  expect(res.status).toBe(401);
});

test("refresh rotates the token; reusing the old one revokes the family (§9h)", async () => {
  const signup = await fetch(`${BASE}/api/auth/signup`, { method: "POST", headers: hdr("10.0.0.3"), body: JSON.stringify({ email: email(), password: "supersecret", displayName: "U" }) });
  const cookie1 = cookieFrom(signup)!;

  // First refresh: succeeds and rotates to a new cookie.
  const r1 = await fetch(`${BASE}/api/auth/refresh`, { method: "POST", headers: { cookie: cookie1, "x-forwarded-for": "10.0.0.3" } });
  expect(r1.status).toBe(200);
  const cookie2 = cookieFrom(r1)!;
  expect(cookie2).not.toBe(cookie1);

  // Reusing cookie1 (already rotated) is detected as theft → 401 + family revoked.
  const reuse = await fetch(`${BASE}/api/auth/refresh`, { method: "POST", headers: { cookie: cookie1, "x-forwarded-for": "10.0.0.3" } });
  expect(reuse.status).toBe(401);

  // The legitimate rotated token is now also dead (whole family revoked).
  const r2 = await fetch(`${BASE}/api/auth/refresh`, { method: "POST", headers: { cookie: cookie2, "x-forwarded-for": "10.0.0.3" } });
  expect(r2.status).toBe(401);
});

test("auth routes are IP rate-limited at 10/min (§12m)", async () => {
  // 11 rapid logins from the same IP; the 11th must be 429. (login is cheap on a missing user.)
  const e = email();
  let got429 = false;
  for (let i = 0; i < 12; i++) {
    const res = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: hdr("10.9.9.9"), body: JSON.stringify({ email: e, password: "x" }) });
    if (res.status === 429) {
      expect(res.headers.get("retry-after")).toBe("60");
      got429 = true;
      break;
    }
  }
  expect(got429).toBe(true);
});
