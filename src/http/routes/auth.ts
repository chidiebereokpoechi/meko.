import { Elysia } from "elysia";
import {
  AuthError,
  clearRefreshCookie,
  mintAccessToken,
  refreshCookie,
  rotateRefreshToken,
  verifyAccessToken,
} from "@/auth/tokens.ts";
import { issueWsTicket } from "@/auth/ws-ticket.ts";
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

// Extract + verify the bearer access token (in-memory on the client, sent as Authorization).
function bearerUser(authHeader: string | null): string | null {
  if (!authHeader?.startsWith("Bearer ")) return null;
  return verifyAccessToken(authHeader.slice(7))?.sub ?? null;
}

export const auth = new Elysia({ prefix: "/api" })
  // POST /api/auth/refresh — rotate on every valid use (§9h); issue a fresh access token.
  .post("/auth/refresh", async ({ request, set }) => {
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
  // POST /api/auth/logout — clear the cookie. (Family revocation handled elsewhere.)
  .post("/auth/logout", ({ set }) => {
    set.headers["set-cookie"] = clearRefreshCookie;
    return { ok: true };
  })
  // POST /api/ws-ticket — authenticated; mints a single-use WS ticket (§5g).
  .post("/ws-ticket", async ({ request, set }) => {
    const userId = bearerUser(request.headers.get("authorization"));
    if (!userId) {
      securityEvent("auth.ws_ticket_denied", { reason: "no_access_token" });
      set.status = 401;
      return { error: "UNAUTHENTICATED" };
    }
    return await issueWsTicket(userId);
  });
