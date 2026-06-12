import { Elysia, t } from "elysia";
import { eq } from "drizzle-orm";
import { db } from "@/db/client.ts";
import { users } from "@/db/schema.ts";
import {
  AuthError,
  clearRefreshCookie,
  issueRefreshFamily,
  mintAccessToken,
  refreshCookie,
  rotateRefreshToken,
} from "@/auth/tokens.ts";
import { hashPassword, verifyPassword } from "@/auth/password.ts";
import { issueWsTicket } from "@/auth/ws-ticket.ts";
import { bearerUser } from "@/auth/middleware.ts";
import { clientIp, enforceRateLimit } from "@/lib/rate-limit.ts";
import { securityEvent } from "@/lib/logger.ts";
import { config, oidcEnabled, oidcProviders, oidcProviderById } from "@/config.ts";
import { redis } from "@/lib/redis.ts";
import { buildAuthorizeUrl, completeLogin, pkcePair, randomToken } from "@/auth/oidc.ts";
import { provisionOidcUser, OidcLinkError } from "@/auth/provision.ts";
import { SignupClosedError, canCreateAccount } from "@/auth/signup-policy.ts";

// Read a named cookie value from a Cookie header — never the body or a non-cookie header (§9g).
function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

// Establish a session: short-lived access token in the body (client keeps it in memory, §9g) +
// rotating refresh token in an HttpOnly cookie.
async function startSession(userId: string, request: Request, set: { headers: Record<string, string | number> }) {
  const ip = clientIp(request);
  const raw = await issueRefreshFamily(userId, request.headers.get("user-agent") ?? undefined, ip);
  set.headers["set-cookie"] = refreshCookie(raw);
  return { accessToken: mintAccessToken(userId) };
}

// Credential routes. IP-rate-limited to 10/min (§12m) — IP, not user, because the caller is not
// yet authenticated and an attacker controls any submitted identifier.
export const auth = new Elysia({ prefix: "/api/auth" })
  .onBeforeHandle(({ request }) => {
    const path = new URL(request.url).pathname;
    // The OIDC callback is an IdP-driven redirect, not an attacker-controlled credential submission
    // (it needs a valid tx cookie + matching state + a real IdP code, and failures are logged) —
    // exempt it so a normal login round trip doesn't burn the credential bucket.
    if (path === "/api/auth/oidc/callback") return;
    const ip = clientIp(request);
    // Starting a login redirect is cheap and self-limited by the IdP; give it a looser, separate
    // bucket so repeated sign-in attempts don't lock out password login (and vice versa).
    if (path === "/api/auth/oidc/login") return enforceRateLimit(`rl:ip:${ip}:oidc`, 30, 60);
    // Credential submission (password login/signup) is the brute-force surface — keep it bounded
    // per IP, but high enough that a shared/NAT'd egress IP carrying many real users won't trip it.
    if (path === "/api/auth/login" || path === "/api/auth/signup")
      return enforceRateLimit(`rl:ip:${ip}:auth`, 30, 60);
    // Everything else under /api/auth (refresh, logout, me, oidc/providers, ws-ticket) isn't a
    // credential guess — it requires a valid cookie/token or is read-only — yet it fires on every
    // app boot, token refresh, and board open. Many users behind one IP generate a lot of it, so it
    // gets its own much looser bucket and can't lock a shared IP out of signing in. (§12m)
    return enforceRateLimit(`rl:ip:${ip}:auth-session`, 120, 60);
  })
  .post(
    "/signup",
    async ({ body, request, set }) => {
      const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, body.email)).limit(1);
      if (existing.length) {
        set.status = 409;
        return { error: "EMAIL_TAKEN" };
      }
      // Account-creation policy (invite-only / bootstrap) — same gate as the OIDC path.
      if (!(await canCreateAccount(body.email))) {
        securityEvent("auth.signup_blocked", { email: body.email, via: "password" });
        set.status = 403;
        return { error: "SIGNUP_CLOSED" };
      }
      const [u] = await db
        .insert(users)
        .values({ email: body.email, displayName: body.displayName, passwordHash: await hashPassword(body.password) })
        .returning();
      return startSession(u!.id, request, set);
    },
    {
      body: t.Object({
        email: t.String({ format: "email", maxLength: 320 }),
        password: t.String({ minLength: 8, maxLength: 1024 }),
        displayName: t.String({ minLength: 1, maxLength: 200 }),
      }),
    },
  )
  .post(
    "/login",
    async ({ body, request, set }) => {
      const [u] = await db.select().from(users).where(eq(users.email, body.email)).limit(1);
      // Verify even when the user is missing? We short-circuit but log uniformly; the argon
      // verify cost dominates either way, so the timing signal is negligible.
      const ok = u?.passwordHash ? await verifyPassword(body.password, u.passwordHash) : false;
      if (!ok) {
        securityEvent("auth.login_failed", { email: body.email });
        set.status = 401;
        return { error: "INVALID_CREDENTIALS" };
      }
      return startSession(u!.id, request, set);
    },
    { body: t.Object({ email: t.String({ maxLength: 320 }), password: t.String({ maxLength: 1024 }) }) },
  )
  // Rotate on every valid use (§9h); issue a fresh access token.
  .post("/refresh", async ({ request, set }) => {
    const raw = readCookie(request.headers.get("cookie"), "refresh_token");
    if (!raw) {
      set.status = 401;
      return { error: "NO_REFRESH_TOKEN" };
    }
    try {
      const { newRawToken, userId } = await rotateRefreshToken(raw);
      set.headers["set-cookie"] = refreshCookie(newRawToken);
      return { accessToken: mintAccessToken(userId) };
    } catch (err) {
      if (err instanceof AuthError) {
        set.status = 401;
        set.headers["set-cookie"] = clearRefreshCookie;
        return { error: err.message };
      }
      throw err;
    }
  })
  .post("/logout", ({ set }) => {
    set.headers["set-cookie"] = clearRefreshCookie;
    return { ok: true };
  })
  // --- OIDC login via external IdP (Authentik). GET routes = browser navigations. ---
  // Step 1: stash a CSRF state + nonce + PKCE verifier in Redis, carry the tx id in a short-lived
  // Lax cookie (Lax so it survives the top-level redirect back from the IdP), 302 to the IdP.
  .get("/oidc/login", async ({ query, set }) => {
    if (!oidcEnabled) return oidcDisabled(set);
    // Pick the requested provider; default to the first configured one (back-compat with the old
    // single-button URL). An unknown id falls through to the default rather than erroring.
    const provider = oidcProviderById(String(query.provider ?? "")) ?? oidcProviders[0]!;
    const tx = randomToken();
    const state = randomToken();
    const nonce = randomToken();
    const { verifier, challenge } = pkcePair();
    // Where to land after login (e.g. /invite/<token>). Sanitised to a same-site relative path to
    // prevent the callback being turned into an open redirect.
    const ret = safeReturnPath(query.return);
    await redis.set(txKey(tx), JSON.stringify({ provider: provider.id, state, nonce, verifier, ret }), "EX", OIDC_TX_TTL);
    set.headers["set-cookie"] = txCookie(tx);
    redirect(set, await buildAuthorizeUrl(provider, { state, nonce, codeChallenge: challenge }));
  })
  // Which OIDC providers are wired, so the login screen renders only the configured buttons.
  .get("/oidc/providers", () => ({ providers: oidcProviders.map((p) => ({ id: p.id, label: p.label })) }))
  // Step 2: validate state, exchange the code, verify the id_token, JIT-provision the meko user,
  // then issue meko's OWN session (rotating refresh cookie, §9h) and 302 to the web app. The SPA's
  // boot refresh() mints the access token — the IdP is not contacted again.
  .get("/oidc/callback", async ({ request, query, set }) => {
    if (!oidcEnabled) return oidcDisabled(set);
    const tx = readCookie(request.headers.get("cookie"), "oidc_tx");
    const clearTx = "oidc_tx=; HttpOnly; Secure; SameSite=Lax; Path=/api/auth; Max-Age=0";
    // Return path is recovered from the tx (already sanitised at /login). Errors land back on it too,
    // so e.g. an invite page shows the failure in context rather than bouncing to the root.
    let ret = "/";
    const fail = (reason: string) => {
      securityEvent("auth.oidc_login_failed", { reason });
      set.headers["set-cookie"] = clearTx;
      const sep = ret.includes("?") ? "&" : "?";
      redirect(set, `${config.MEKO_WEB_URL}${ret}${sep}auth_error=${reason}`);
    };

    if (query.error) return fail(String(query.error));
    if (!tx || !query.code || !query.state) return fail("missing_params");

    const raw = await redis.getdel(txKey(tx));
    if (!raw) return fail("expired_tx");
    const { provider: providerId, state, nonce, verifier, ret: txRet } = JSON.parse(raw) as { provider?: string; state: string; nonce: string; verifier: string; ret?: string };
    ret = safeReturnPath(txRet);
    if (state !== query.state) return fail("state_mismatch");
    // Recover the provider chosen at /login (carried in the tx, not the URL). Default keeps txs
    // written before this field existed working.
    const provider = oidcProviderById(providerId ?? "") ?? oidcProviders[0];
    if (!provider) return fail("unknown_provider");

    try {
      const claims = await completeLogin(provider, String(query.code), verifier, nonce);
      const userId = await provisionOidcUser(claims);
      const refreshRaw = await issueRefreshFamily(userId, request.headers.get("user-agent") ?? undefined, clientIp(request));
      // Two Set-Cookie headers: clear the tx cookie + install the session refresh cookie.
      set.headers["set-cookie"] = [clearTx, refreshCookie(refreshRaw)];
      redirect(set, `${config.MEKO_WEB_URL}${ret}`);
    } catch (e) {
      if (e instanceof OidcLinkError) return fail("email_unverified");
      if (e instanceof SignupClosedError) return fail("signup_closed");
      return fail("verification_failed");
    }
  });

const OIDC_TX_TTL = 600; // 10 min to complete the round trip
const txKey = (tx: string) => `oidc:tx:${tx}`;
const txCookie = (tx: string) => `oidc_tx=${tx}; HttpOnly; Secure; SameSite=Lax; Path=/api/auth; Max-Age=${OIDC_TX_TTL}`;

// Constrain a post-login redirect target to a same-site relative path. Rejects absolute URLs,
// scheme-relative (`//host`), and backslash tricks so the callback can't be an open redirect.
function safeReturnPath(raw: unknown): string {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return "/";
  return raw;
}

function redirect(set: { status?: number | string; headers: Record<string, string | number | string[]> }, url: string) {
  set.status = 302;
  set.headers["location"] = url;
}
function oidcDisabled(set: { status?: number | string }) {
  set.status = 404;
  return { error: "NOT_FOUND" };
}

// Authenticated /api routes that should NOT sit under the IP rate-limiter (separate group): the
// WS-ticket mint (§5g) and the current-user lookup.
export const wsTicket = new Elysia({ prefix: "/api" })
  .post("/ws-ticket", async ({ request, set }) => {
    const userId = bearerUser(request.headers.get("authorization"));
    if (!userId) {
      securityEvent("auth.ws_ticket_denied", { reason: "no_access_token" });
      set.status = 401;
      return { error: "UNAUTHENTICATED" };
    }
    return await issueWsTicket(userId);
  })
  // Identity of the bearer — who am I logged in as. Used by the client to render the account chip.
  .get("/auth/me", async ({ request, set }) => {
    const userId = bearerUser(request.headers.get("authorization"));
    if (!userId) {
      set.status = 401;
      return { error: "UNAUTHENTICATED" };
    }
    const [u] = await db
      .select({ id: users.id, email: users.email, displayName: users.displayName })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!u) {
      set.status = 401;
      return { error: "UNAUTHENTICATED" };
    }
    return u;
  });
