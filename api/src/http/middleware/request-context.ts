import crypto from "node:crypto";
import { Elysia } from "elysia";
import { runWithContext, ctxLog, type LogContext } from "@/lib/logger.ts";

// Establish per-request log context (§3g): requestId propagated as X-Request-ID, plus timing.
// Elysia runs each request as its own async chain, so we open the ALS scope in onRequest and
// keep a handle to read/extend it (userId etc.) from later hooks.
export const requestContext = new Elysia({ name: "request-context" })
  .derive({ as: "global" }, ({ request, set }) => {
    const requestId = request.headers.get("x-request-id") ?? `req_${crypto.randomBytes(12).toString("hex")}`;
    set.headers["x-request-id"] = requestId;
    const ctx: LogContext = { requestId, userId: null, workspaceId: null, boardId: null };
    return { logCtx: ctx, startedAt: performance.now() };
  })
  .onAfterHandle({ as: "global" }, ({ request, set, logCtx, startedAt }) => {
    const durationMs = Math.round(performance.now() - startedAt);
    runWithContext(logCtx, () =>
      ctxLog().info(
        { action: "http.request", method: request.method, path: new URL(request.url).pathname, status: set.status ?? 200, durationMs },
        "request",
      ),
    );
  });
