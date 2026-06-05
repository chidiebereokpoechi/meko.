import crypto from "node:crypto";
import { Elysia } from "elysia";
import { config } from "@/config.ts";
import { log } from "@/lib/logger.ts";
import { closeDb } from "@/db/client.ts";
import { closeRedis } from "@/lib/redis.ts";
import { cors } from "@/http/middleware/cors.ts";
import { securityHeaders } from "@/http/middleware/security-headers.ts";
import { requestContext } from "@/http/middleware/request-context.ts";
import { timeoutResponse } from "@/http/middleware/timeout.ts";
import { health } from "@/http/routes/health.ts";
import { auth } from "@/http/routes/auth.ts";
import { redeemWsTicket } from "@/auth/ws-ticket.ts";
import { roomManager, type LocalClient } from "@/realtime/room.ts";

const allowedOrigins = new Set(config.MEKO_ALLOWED_ORIGINS);

// Per-connection state. A socket is unauthenticated until it sends {type:"auth",ticket} (§5g).
interface WsData {
  id: string;
  boardId: string;
  userId: string | null;
  authTimer: ReturnType<typeof setTimeout> | null;
}

roomManager.start();

// WS server-side state keyed by the live socket object.
const sockets = new WeakMap<object, WsData>();

const app = new Elysia()
  .onError(({ error, set, request }) => {
    const mapped = timeoutResponse(error, new URL(request.url).pathname);
    if (mapped) {
      set.status = mapped.status;
      return mapped.body;
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
          // TODO(phase-6): board-access permission check for userId on state.boardId.
          state.userId = userId;
          if (state.authTimer) clearTimeout(state.authTimer);
          state.authTimer = null;
          await roomManager.join(state.boardId, makeClient(ws, state));
        }
        return;
      }

      // Binary Yjs update — only accepted after authentication.
      if (!state.userId) {
        ws.close(4401, "unauthenticated");
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
