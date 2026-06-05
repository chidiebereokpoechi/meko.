import { redisPub, redisSub } from "@/lib/redis.ts";
import { config } from "@/config.ts";
import { ctxLog } from "@/lib/logger.ts";

// Cross-node Yjs bus (§3e). Every local update is published on room:{boardId}; every node
// applies remote updates to its own in-memory Y.Doc and fans them out to its local clients.
// Redis is the incremental bus only — NOT the source of truth (that's Postgres).

const channel = (boardId: string) => `room:${boardId}`;

interface Envelope {
  nodeId: string;
  update: string; // base64
}

export async function publishUpdate(boardId: string, update: Uint8Array): Promise<void> {
  const env: Envelope = { nodeId: config.NODE_ID, update: Buffer.from(update).toString("base64") };
  await redisPub.publish(channel(boardId), JSON.stringify(env));
}

// Start the single pattern subscriber for this node. onRemote fires only for updates that did
// NOT originate here, and only the board id + bytes are handed back.
export function startRoomSubscriber(onRemote: (boardId: string, update: Uint8Array) => void): void {
  redisSub.psubscribe("room:*", (err) => {
    if (err) ctxLog().error({ err, action: "roomsync.psubscribe_fail" }, "failed to psubscribe");
  });

  redisSub.on("pmessage", (_pattern, chan, raw) => {
    let env: Envelope;
    try {
      env = JSON.parse(raw);
    } catch {
      return;
    }
    if (env.nodeId === config.NODE_ID) return; // skip our own broadcast
    const boardId = chan.slice("room:".length);
    onRemote(boardId, new Uint8Array(Buffer.from(env.update, "base64")));
  });
}
