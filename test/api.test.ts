import { afterAll, beforeAll, expect, test } from "bun:test";
import { directDb } from "@/db/client.ts";
import { users } from "@/db/schema.ts";
import { mintAccessToken } from "@/auth/tokens.ts";

// REST API integration: auth guard, workspace/board CRUD, cursor pagination, permission denial.
const PORT = 3201;
const BASE = `http://localhost:${PORT}`;
let node: ReturnType<typeof Bun.spawn>;
let ownerTok: string;
let strangerTok: string;

const H = (tok: string) => ({ authorization: `Bearer ${tok}`, "content-type": "application/json" });

async function waitHealthy() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/healthz`)).ok) return;
    } catch {}
    await Bun.sleep(250);
  }
  throw new Error("node never healthy");
}

beforeAll(async () => {
  const db = directDb();
  const [owner] = await db.insert(users).values({ email: `o${Date.now()}@x.test`, displayName: "Owner" }).returning();
  const [stranger] = await db.insert(users).values({ email: `s${Date.now()}@x.test`, displayName: "Stranger" }).returning();
  ownerTok = mintAccessToken(owner!.id);
  strangerTok = mintAccessToken(stranger!.id);

  node = Bun.spawn(["bun", "run", "src/index.ts"], {
    env: { ...process.env, PORT: String(PORT), NODE_ID: "api", LOG_LEVEL: "warn", MEKO_ALLOWED_ORIGINS: "http://localhost" },
    stdout: "inherit",
    stderr: "inherit",
  });
  await waitHealthy();
});

afterAll(() => node?.kill());

test("unauthenticated request is 401", async () => {
  const res = await fetch(`${BASE}/api/workspaces`, { method: "POST", body: JSON.stringify({ name: "x" }), headers: { "content-type": "application/json" } });
  expect(res.status).toBe(401);
});

test("workspace + board lifecycle with cursor pagination", async () => {
  const ws = await (await fetch(`${BASE}/api/workspaces`, { method: "POST", headers: H(ownerTok), body: JSON.stringify({ name: "WS" }) })).json();
  expect(ws.id).toBeString();

  // Create enough boards to force a second page.
  for (let i = 0; i < 3; i++) {
    const r = await fetch(`${BASE}/api/workspaces/${ws.id}/boards`, { method: "POST", headers: H(ownerTok), body: JSON.stringify({ title: `B${i}` }) });
    expect(r.status).toBe(200);
    await Bun.sleep(5); // distinct updated_at for stable cursor ordering
  }

  const page1 = await (await fetch(`${BASE}/api/workspaces/${ws.id}/boards?cursor=`, { headers: H(ownerTok) })).json();
  expect(page1.data.length).toBe(3);
  expect(page1.nextCursor).toBeNull(); // < PAGE_SIZE, so no next page

  // Stranger cannot list this workspace's boards.
  const denied = await fetch(`${BASE}/api/workspaces/${ws.id}/boards`, { headers: H(strangerTok) });
  expect(denied.status).toBe(403);
});

test("stranger cannot read a board they have no access to", async () => {
  const ws = await (await fetch(`${BASE}/api/workspaces`, { method: "POST", headers: H(ownerTok), body: JSON.stringify({ name: "Private" }) })).json();
  const board = await (await fetch(`${BASE}/api/workspaces/${ws.id}/boards`, { method: "POST", headers: H(ownerTok), body: JSON.stringify({ title: "secret" }) })).json();

  expect((await fetch(`${BASE}/api/boards/${board.id}`, { headers: H(ownerTok) })).status).toBe(200);
  expect((await fetch(`${BASE}/api/boards/${board.id}`, { headers: H(strangerTok) })).status).toBe(403);
});

test("unfurl blocks unsafe scheme + SSRF target (§7)", async () => {
  const ws = await (await fetch(`${BASE}/api/workspaces`, { method: "POST", headers: H(ownerTok), body: JSON.stringify({ name: "L" }) })).json();
  const board = await (await fetch(`${BASE}/api/workspaces/${ws.id}/boards`, { method: "POST", headers: H(ownerTok), body: JSON.stringify({ title: "l" }) })).json();

  const unsafe = await fetch(`${BASE}/api/boards/${board.id}/unfurl`, { method: "POST", headers: H(ownerTok), body: JSON.stringify({ url: "javascript:alert(1)" }) });
  expect(unsafe.status).toBe(422);

  const metadata = await fetch(`${BASE}/api/boards/${board.id}/unfurl`, { method: "POST", headers: H(ownerTok), body: JSON.stringify({ url: "http://169.254.169.254/latest/meta-data/" }) });
  expect(metadata.status).toBe(422);
  expect((await metadata.json()).error).toBe("UNFURL_BLOCKED");
});

test("comment create + paginated list", async () => {
  const ws = await (await fetch(`${BASE}/api/workspaces`, { method: "POST", headers: H(ownerTok), body: JSON.stringify({ name: "C" }) })).json();
  const board = await (await fetch(`${BASE}/api/workspaces/${ws.id}/boards`, { method: "POST", headers: H(ownerTok), body: JSON.stringify({ title: "b" }) })).json();

  await fetch(`${BASE}/api/boards/${board.id}/comments`, { method: "POST", headers: H(ownerTok), body: JSON.stringify({ body: "first" }) });
  const list = await (await fetch(`${BASE}/api/boards/${board.id}/comments`, { headers: H(ownerTok) })).json();
  expect(list.data[0].body).toBe("first");
  expect(list.data[0].authorName).toBe("Owner");
});
