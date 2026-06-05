import { redis } from "@/lib/redis.ts";
import { securityEvent } from "@/lib/logger.ts";

// Sliding-window rate limiting backed by a Redis sorted set (§12a/12m). Each request adds a
// timestamped member; the window is trimmed on every call, so the count is the true number of
// requests in the trailing window — not a coarse fixed bucket that resets on a boundary.
//
// Authenticated routes key on userId (can't be rotated without making an account); anonymous
// routes (login/signup) key on IP. Counter loss on a Redis restart is acceptable (§16).

export class RateLimitError extends Error {
  constructor(public readonly retryAfterSec: number) {
    super("RATE_LIMITED");
  }
}

export async function enforceRateLimit(key: string, limit: number, windowSec: number): Promise<void> {
  const windowMs = windowSec * 1000;
  const nowMs = Date.now();
  const member = `${nowMs}-${Math.floor(nowMs * 1000) % 1000}`;

  const results = await redis
    .multi()
    .zremrangebyscore(key, 0, nowMs - windowMs) // drop entries older than the window
    .zadd(key, nowMs, member)
    .zcard(key)
    .pexpire(key, windowMs)
    .exec();

  // results[2] is [err, count] from ZCARD.
  const count = Number(results?.[2]?.[1] ?? 0);
  if (count > limit) {
    securityEvent("rate_limit.hit", { key, count, limit });
    throw new RateLimitError(windowSec);
  }
}

// Best-effort client IP: first hop of X-Forwarded-For (set by nginx), else the connecting peer.
export function clientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}
