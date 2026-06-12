import { randomUUID } from "node:crypto";
import { redis } from "@/lib/redis.ts";
import { securityEvent } from "@/lib/logger.ts";

// Sliding-window rate limiting backed by a Redis sorted set (§12a/12m). Each allowed request adds a
// timestamped member; the window is trimmed on every call, so the count is the true number of
// requests in the trailing window — not a coarse fixed bucket that resets on a boundary.
//
// CRITICAL: a rejected request must NOT be recorded. If over-limit requests still added a member
// (and bumped the TTL), the over-limit state would perpetuate itself — a client that keeps retrying,
// or many users behind one NAT'd IP sharing the `rl:ip:*` bucket, would keep the window permanently
// full and never recover. So the check-then-add is atomic (one Lua script) and the ZADD is skipped
// once the window is full; the window can only drain as old entries age past the trailing window.
//
// Authenticated routes key on userId (can't be rotated without making an account); anonymous
// routes (login/signup) key on IP. Counter loss on a Redis restart is acceptable (§16).

// KEYS[1]=key  ARGV[1]=nowMs  ARGV[2]=windowMs  ARGV[3]=limit  ARGV[4]=member
// Returns the in-window count after this request if allowed, or -1 if it was rejected (not recorded).
const SLIDING_WINDOW = `
local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now - windowMs)
local count = redis.call('ZCARD', KEYS[1])
if count >= limit then
  redis.call('PEXPIRE', KEYS[1], windowMs)
  return -1
end
redis.call('ZADD', KEYS[1], now, ARGV[4])
redis.call('PEXPIRE', KEYS[1], windowMs)
return count + 1
`;

export class RateLimitError extends Error {
  constructor(public readonly retryAfterSec: number) {
    super("RATE_LIMITED");
  }
}

export async function enforceRateLimit(key: string, limit: number, windowSec: number): Promise<void> {
  const windowMs = windowSec * 1000;
  const nowMs = Date.now();
  // Member must be unique per request, else same-millisecond requests collapse into one entry.
  const member = `${nowMs}-${randomUUID()}`;

  const result = (await redis.eval(SLIDING_WINDOW, 1, key, String(nowMs), String(windowMs), String(limit), member)) as number;
  if (result === -1) {
    securityEvent("rate_limit.hit", { key, limit });
    throw new RateLimitError(windowSec);
  }
}

// Best-effort client IP: first hop of X-Forwarded-For (set by nginx), else the connecting peer.
export function clientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}
