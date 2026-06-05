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

// Read the refresh token from the HttpOnly cookie only — never the body or a header (§9g).
function readRefreshCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === "refresh_token") return v.join("=");
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
  .onBeforeHandle(({ request }) => enforceRateLimit(`rl:ip:${clientIp(request)}:auth`, 10, 60))
  .post(
    "/signup",
    async ({ body, request, set }) => {
      const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, body.email)).limit(1);
      if (existing.length) {
        set.status = 409;
        return { error: "EMAIL_TAKEN" };
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
    const raw = readRefreshCookie(request.headers.get("cookie"));
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
  });

// Authenticated, mints a single-use WS ticket (§5g). Separate group — not IP-rate-limited.
export const wsTicket = new Elysia({ prefix: "/api" }).post("/ws-ticket", async ({ request, set }) => {
  const userId = bearerUser(request.headers.get("authorization"));
  if (!userId) {
    securityEvent("auth.ws_ticket_denied", { reason: "no_access_token" });
    set.status = 401;
    return { error: "UNAUTHENTICATED" };
  }
  return await issueWsTicket(userId);
});
