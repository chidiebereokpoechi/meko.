import Redis from "ioredis";
import { config } from "@/config.ts";

// Shared connections. ioredis multiplexes commands on one connection, but a connection in
// subscriber mode can only run subscribe commands — so pub/sub get their own (§3e).
export const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: false });

export const redisPub = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
export const redisSub = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });

export async function closeRedis() {
  await Promise.allSettled([redis.quit(), redisPub.quit(), redisSub.quit()]);
}
