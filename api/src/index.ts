import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { db } from "@/db/client.ts";
import { users } from "@/db/schema.ts";
import { config } from "@/config.ts";
import { log } from "@/lib/logger.ts";
import { closeDb } from "@/db/client.ts";
import { closeRedis } from "@/lib/redis.ts";
import { cors } from "@/http/middleware/cors.ts";
import { securityHeaders } from "@/http/middleware/security-headers.ts";
import { requestContext } from "@/http/middleware/request-context.ts";
import { timeoutResponse } from "@/http/middleware/timeout.ts";
import { health } from "@/http/routes/health.ts";
import { auth, wsTicket } from "@/http/routes/auth.ts";
import { workspaceRoutes } from "@/http/routes/workspaces.ts";
import { boardRoutes } from "@/http/routes/boards.ts";
import { mediaRoutes } from "@/http/routes/media.ts";
import { linkRoutes } from "@/http/routes/links.ts";
import { shareRoutes } from "@/http/routes/sharing.ts";
import { exportRoutes } from "@/http/routes/exports.ts";
import { internalRoutes } from "@/http/routes/internal.ts";
import { SsrfError } from "@/lib/ssrf.ts";
import { redeemWsTicket } from "@/auth/ws-ticket.ts";
import { boardAccess, ForbiddenError } from "@/lib/permissions.ts";
import { RateLimitError } from "@/lib/rate-limit.ts";
import { securityEvent } from "@/lib/logger.ts";
import { roomManager, type LocalClient } from "@/realtime/room.ts";

const allowedOrigins = new Set(config.MEKO_ALLOWED_ORIGINS);

// Per-connection state. A socket is unauthenticated until it sends {type:"auth",ticket} (§5g).
interface WsData {
  id: string;
  boardId: string;
  userId: string | null;
  canEdit: boolean;
  name: string;
  color: string;
  authTimer: ReturnType<typeof setTimeout> | null;
}

// Deterministic per-user cursor colour from the userId — server-owned so a client can't spoof
// another user's identity or colour. 12 distinct, legible hues.
const PRESENCE_COLORS = [
  "#6e24ff", "#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6",
  "#0ea5e9", "#3b82f6", "#8b5cf6", "#ec4899", "#f43f5e", "#10b981",
];
function colorForUser(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return PRESENCE_COLORS[h % PRESENCE_COLORS.length]!;
}

roomManager.start();

// WS server-side state keyed by the live socket object.
const sockets = new WeakMap<object, WsData>();

const app = new Elysia()
  .onError(({ code, error, set, request }) => {
    const mapped = timeoutResponse(error, new URL(request.url).pathname);
    if (mapped) {
      set.status = mapped.status;
      return mapped.body;
    }
    if (error instanceof ForbiddenError) {
      set.status = 403;
      return { error: "FORBIDDEN" };
    }
    if (error instanceof RateLimitError) {
      set.status = 429;
      set.headers["retry-after"] = String(error.retryAfterSec);
      return { error: "RATE_LIMITED" };
    }
    if (error instanceof SsrfError) {
      set.status = 422;
      return { error: "UNFURL_BLOCKED" };
    }
    // Let Elysia's built-in error classes keep their status (422 validation, 404, parse errors).
    if (code === "VALIDATION") {
      set.status = 422;
      return { error: "VALIDATION" };
    }
    if (code === "NOT_FOUND") {
      set.status = 404;
      return { error: "NOT_FOUND" };
    }
    log.error({ err: error, action: "http.error" }, "unhandled error");
    set.status = 500;
    return { error: "INTERNAL" };
  })
  .use(cors)
  .use(securityHeaders)
  .use(requestContext)
  .use(health)
  .use(auth)
  .use(wsTicket)
  .use(workspaceRoutes)
  .use(boardRoutes)
  .use(mediaRoutes)
  .use(linkRoutes)
  .use(shareRoutes)
  .use(exportRoutes)
  .use(internalRoutes)
  // WebSocket board endpoint. Origin is validated at the upgrade; auth is by ticket message.
  .ws("/boards/:boardId", {
    // §5g step 1: reject cross-origin upgrades — the only CSRF control browsers enforce on WS.
    beforeHandle({ request, set }) {
      const origin = request.headers.get("origin") ?? "";
      if (!allowedOrigins.has(origin)) {
        set.status = 403;
        return "forbidden origin";
      }
    },
    open(ws) {
      const boardId = (ws.data as { params: { boardId: string } }).params.boardId;
      const state: WsData = {
        id: crypto.randomUUID(),
        boardId,
        userId: null,
        canEdit: false,
        name: "",
        color: "#6e24ff",
        // §5g step 4: close if no auth message arrives within 5s.
        authTimer: setTimeout(() => ws.close(4401, "auth timeout"), 5000),
      };
      // Key by the stable underlying Bun socket — Elysia hands a fresh ElysiaWS wrapper per call,
      // so the wrapper itself can't be used as a Map key across open/message/close.
      sockets.set(ws.raw, state);
    },
    async message(ws, raw) {
      const state = sockets.get(ws.raw);
      if (!state) return;

      // Control frames are JSON (auth); board data frames are binary Yjs updates.
      if (typeof raw === "string" || (raw && typeof raw === "object" && "type" in (raw as object))) {
        const msg = typeof raw === "string" ? safeJson(raw) : (raw as { type?: string; ticket?: string });
        if (msg?.type === "auth") {
          if (state.userId) return; // already authed
          const userId = await redeemWsTicket(msg.ticket ?? "");
          if (!userId) {
            ws.close(4401, "invalid ticket");
            return;
          }
          // Board-access check: no membership/grant ⇒ refuse the socket. Viewers may join but
          // cannot push updates (edit-gated below).
          const access = await boardAccess(userId, state.boardId);
          if (!access) {
            securityEvent("ws.board_denied", { userId, boardId: state.boardId });
            ws.close(4403, "forbidden");
            return;
          }
          state.userId = userId;
          state.canEdit = access === "edit";
          // Server owns presence identity: name from the DB, colour derived from the userId.
          const [u] = await db.select({ displayName: users.displayName }).from(users).where(eq(users.id, userId)).limit(1);
          state.name = u?.displayName ?? "Someone";
          state.color = colorForUser(userId);
          if (state.authTimer) clearTimeout(state.authTimer);
          state.authTimer = null;
          const client = makeClient(ws, state);
          await roomManager.join(state.boardId, client);
          // Tell the client its own identity (to exclude itself from presence) and whether it may
          // edit — the client enforces read-only locally; the server already rejects viewer updates.
          client.sendText(JSON.stringify({ type: "hello", userId, canEdit: state.canEdit }));
          return;
        }
        if (msg?.type === "presence") {
          if (!state.userId) return; // presence only after auth
          const cur = (msg as { cursor?: { x?: unknown; y?: unknown } }).cursor;
          if (!cur || typeof cur.x !== "number" || typeof cur.y !== "number") return;
          roomManager.relayPresence(
            state.boardId,
            { type: "presence", clientId: state.id, userId: state.userId, name: state.name, color: state.color, cursor: { x: cur.x, y: cur.y } },
            state.id,
          );
        }
        return;
      }

      // Binary Yjs update — only accepted after authentication.
      if (!state.userId) {
        ws.close(4401, "unauthenticated");
        return;
      }
      // Viewers receive updates but cannot make them (§9).
      if (!state.canEdit) {
        securityEvent("ws.edit_denied", { userId: state.userId, boardId: state.boardId });
        return;
      }
      const update = toUint8(raw);
      if (update) await roomManager.applyLocalUpdate(state.boardId, update, state.id);
    },
    close(ws) {
      const state = sockets.get(ws.raw);
      if (!state) return;
      if (state.authTimer) clearTimeout(state.authTimer);
      if (state.userId) roomManager.leave(state.boardId, state.id);
      sockets.delete(ws.raw);
    },
  })
  .listen(config.PORT);

// Send through the underlying Bun socket: Elysia's ws.send() serializes non-string payloads as
// JSON, which would corrupt binary Yjs updates. raw.send(Uint8Array) emits a real binary frame.
function makeClient(ws: { raw: { send: (d: Uint8Array | string) => void } }, state: WsData): LocalClient {
  return {
    id: state.id,
    sendBinary: (data) => ws.raw.send(data),
    sendText: (data) => ws.raw.send(data),
    sendError: (code, message) => ws.raw.send(JSON.stringify({ type: "error", code, message })),
  };
}

function safeJson(s: string): { type?: string; ticket?: string } | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function toUint8(raw: unknown): Uint8Array | null {
  if (raw instanceof Uint8Array) return raw;
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  if (Buffer.isBuffer(raw)) return new Uint8Array(raw);
  return null;
}

log.info({ action: "server.start", port: config.PORT, nodeId: config.NODE_ID }, `meko listening on :${config.PORT}`);

async function shutdown() {
  app.stop();
  await Promise.allSettled([closeDb(), closeRedis()]);
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
