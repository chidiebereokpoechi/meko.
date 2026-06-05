import { afterAll, beforeAll, expect, test } from "bun:test";
import * as Y from "yjs";
import { directDb } from "@/db/client.ts";
import { boards, members, users, workspaces } from "@/db/schema.ts";
import { mintAccessToken } from "@/auth/tokens.ts";

// §14d: prove multi-node convergence. Two app processes share Redis + Postgres; an update made
// by a client on node A must reach a client connected to node B via the Redis pub/sub bus (§3e).

const BASE_ENV = { ...process.env, MEKO_ALLOWED_ORIGINS: "http://localhost", NODE_ENV: "development" };
let nodeA: ReturnType<typeof Bun.spawn>;
let nodeB: ReturnType<typeof Bun.spawn>;
let boardId: string;
let token: string;

function spawnNode(port: number, nodeId: string) {
  return Bun.spawn(["bun", "run", "src/index.ts"], {
    env: { ...BASE_ENV, PORT: String(port), NODE_ID: nodeId, LOG_LEVEL: "warn" },
    stdout: "inherit",
    stderr: "inherit",
  });
}

async function waitHealthy(port: number) {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`http://localhost:${port}/healthz`)).ok) return;
    } catch {}
    await Bun.sleep(250);
  }
  throw new Error(`node on :${port} never became healthy`);
}

// Connect, authenticate via a freshly minted ticket, return the live socket + an inbound queue.
async function connect(port: number): Promise<{ ws: WebSocket; doc: Y.Doc }> {
  const ticketRes = await fetch(`http://localhost:${port}/api/ws-ticket`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  const { ticket } = (await ticketRes.json()) as { ticket: string };

  const doc = new Y.Doc();
  const ws = new WebSocket(`ws://localhost:${port}/boards/${boardId}`, {
    headers: { origin: "http://localhost" },
  } as any);
  ws.binaryType = "arraybuffer";

  ws.onmessage = (ev) => {
    if (ev.data instanceof ArrayBuffer) Y.applyUpdate(doc, new Uint8Array(ev.data), "remote");
  };

  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "auth", ticket }));
      resolve();
    };
    ws.onerror = () => reject(new Error("ws error"));
  });

  // Outbound: ship local doc changes (not the ones we applied from remote) to the server.
  doc.on("update", (update: Uint8Array, origin: unknown) => {
    if (origin !== "remote") ws.send(update);
  });

  await Bun.sleep(200); // allow join + initial state sync
  return { ws, doc };
}

beforeAll(async () => {
  const db = directDb();
  const [u] = await db.insert(users).values({ email: `t${Date.now()}@x.test`, displayName: "T" }).returning();
  const [w] = await db.insert(workspaces).values({ name: "W", ownerId: u!.id }).returning();
  await db.insert(members).values({ workspaceId: w!.id, userId: u!.id, role: "owner" });
  const [b] = await db.insert(boards).values({ workspaceId: w!.id, title: "B" }).returning();
  boardId = b!.id;
  token = mintAccessToken(u!.id);

  nodeA = spawnNode(3101, "node-a");
  nodeB = spawnNode(3102, "node-b");
  await Promise.all([waitHealthy(3101), waitHealthy(3102)]);
});

afterAll(() => {
  nodeA?.kill();
  nodeB?.kill();
});

test("updates converge across two nodes", async () => {
  const a = await connect(3101);
  const b = await connect(3102); // different node

  a.doc.getMap("root").set("greeting", "hello-from-A");
  await Bun.sleep(800); // Redis pub/sub delivery + apply

  expect(b.doc.getMap("root").get("greeting")).toBe("hello-from-A");

  // Reverse direction too.
  b.doc.getMap("root").set("reply", "hi-from-B");
  await Bun.sleep(800);
  expect(a.doc.getMap("root").get("reply")).toBe("hi-from-B");

  a.ws.close();
  b.ws.close();
}, 20_000);

// §14d: after all clients leave (room dropped + compacted), a fresh client must rebuild the board
// from the DB — proving Postgres, not in-memory state, is the source of truth.
test("a fresh client loads persisted state from the DB", async () => {
  await Bun.sleep(800); // allow leave → compaction
  const c = await connect(3102); // join sends initial state hydrated via loadDoc
  await Bun.sleep(400);
  expect(c.doc.getMap("root").get("greeting")).toBe("hello-from-A");
  expect(c.doc.getMap("root").get("reply")).toBe("hi-from-B");
  c.ws.close();
}, 20_000);
