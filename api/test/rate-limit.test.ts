import { afterAll, expect, test } from "bun:test";
import { redis } from "@/lib/redis.ts";
import { enforceRateLimit, RateLimitError } from "@/lib/rate-limit.ts";

// Regression: a rejected request must NOT be recorded. If over-limit requests still added a member
// (and bumped the TTL), the over-limit state would perpetuate itself — a retrying client, or many
// users behind one NAT'd IP, would keep the window full forever and never recover.
const key = `rl:test:${crypto.randomUUID()}`;
afterAll(async () => {
  await redis.del(key);
});

test("rejected requests are not recorded (no self-perpetuating lockout)", async () => {
  const limit = 3;
  // The first `limit` requests are allowed.
  for (let i = 0; i < limit; i++) await enforceRateLimit(key, limit, 60);

  // Several more are rejected — and keep getting rejected (a hammering client).
  let rejected = 0;
  for (let i = 0; i < 5; i++) {
    try {
      await enforceRateLimit(key, limit, 60);
    } catch (e) {
      if (e instanceof RateLimitError) rejected++;
    }
  }
  expect(rejected).toBe(5);

  // The rejected calls added nothing: only the `limit` allowed requests sit in the window. (Under
  // the old behaviour this would be limit + 5, and the window would never drain.)
  expect(await redis.zcard(key)).toBe(limit);
});
