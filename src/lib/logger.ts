import { AsyncLocalStorage } from "node:async_hooks";
import pino from "pino";
import { config } from "@/config.ts";

// Fixed log schema (§3g). Sensitive fields are redacted before they reach any sink.
export const log = pino({
  level: config.LOG_LEVEL,
  base: { service: "meko-api", version: config.APP_VERSION, nodeId: config.NODE_ID },
  redact: ["req.headers.authorization", "req.headers.cookie", "body.password", "body.token", "ticket"],
});

// Every request/connection carries: requestId, userId, workspaceId, boardId.
// Stored in ALS so child loggers inherit context without threading it through every call.
export interface LogContext {
  requestId?: string;
  userId?: string | null;
  workspaceId?: string | null;
  boardId?: string | null;
}

const als = new AsyncLocalStorage<LogContext>();

export function runWithContext<T>(ctx: LogContext, fn: () => T): T {
  return als.run(ctx, fn);
}

export function getContext(): LogContext {
  return als.getStore() ?? {};
}

// Logger bound to the current ALS context. Use this in handlers instead of bare `log`.
export function ctxLog() {
  return log.child(getContext());
}

// Security events must always be logged at warn+ (§3g). Use a stable `action` tag.
export function securityEvent(action: string, detail: Record<string, unknown> = {}) {
  ctxLog().warn({ action, ...detail }, `security: ${action}`);
}
