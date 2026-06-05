import crypto from "node:crypto";
import { redis } from "@/lib/redis.ts";
import { config } from "@/config.ts";

// Single-use WebSocket ticket (§5g). The JWT never travels in the WS URL — it would leak into
// server logs and browser history. Instead an authenticated HTTP client mints a short-lived
// ticket, then sends it as the first WS message. The ticket is redeemed exactly once.

const key = (ticket: string) => `ws:ticket:${ticket}`;

export async function issueWsTicket(userId: string): Promise<{ ticket: string; expiresIn: number }> {
  const ticket = crypto.randomBytes(32).toString("hex");
  await redis.set(key(ticket), userId, "EX", config.WS_TICKET_TTL_SECONDS);
  return { ticket, expiresIn: config.WS_TICKET_TTL_SECONDS };
}

// Atomic redeem: GETDEL guarantees a ticket can be spent only once even under a race.
export async function redeemWsTicket(ticket: string): Promise<string | null> {
  if (!ticket || typeof ticket !== "string") return null;
  const userId = await redis.getdel(key(ticket));
  return userId;
}
