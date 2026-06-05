import { config } from "@/config.ts";
import { ctxLog } from "@/lib/logger.ts";

export class TimeoutError extends Error {
  constructor(public readonly ms: number) {
    super("REQUEST_TIMEOUT");
  }
}

// Global request timeout backstop (§12p). A slow query must not pin a DB connection and exhaust
// the PgBouncer pool. Wrap a handler body; per-route callers pass a tighter ms where needed
// (standard 10s, export start 30s, presign 5s, /readyz 3s). nginx proxy_read_timeout should sit
// slightly above this so the app returns a clean error rather than nginx a 502.
export function withTimeout<T>(fn: () => Promise<T>, ms = config.ROUTE_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timed = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
  });
  return Promise.race([fn(), timed]).finally(() => clearTimeout(timer)) as Promise<T>;
}

// Map a thrown TimeoutError to a 503 in Elysia's onError; returns null for other errors.
export function timeoutResponse(err: unknown, path: string): { status: number; body: unknown } | null {
  if (err instanceof TimeoutError) {
    ctxLog().warn({ action: "http.timeout", path, ms: err.ms }, "request timed out");
    return { status: 503, body: { error: "REQUEST_TIMEOUT" } };
  }
  return null;
}
