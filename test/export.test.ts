import { afterAll, beforeAll, expect, test } from "bun:test";
import * as Y from "yjs";
import { buildExportHtml, extractElements } from "@/export/html.ts";
import { directDb } from "@/db/client.ts";
import { boards, members, users, workspaces } from "@/db/schema.ts";
import { appendUpdate } from "@/realtime/persistence.ts";
import { claimJob, enqueue } from "@/worker/queue.ts";
import { mintAccessToken } from "@/auth/tokens.ts";

const PORT = 3601;
const BASE = `http://localhost:${PORT}`;
const INTERNAL = "export-internal-token-xyz";
let node: ReturnType<typeof Bun.spawn>;
let ownerTok: string, strangerTok: string;
let boardId: string;

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

// --- Pure unit tests (no node) ---

test("buildExportHtml escapes user text — no live markup reaches Chromium (§8b)", () => {
  const html = buildExportHtml("My <board>", [
    { id: "n1", type: "note", x: 0, y: 0, w: 100, h: 50, text: "<script>alert(1)</script>" } as any,
  ]);
  expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  expect(html).not.toContain("<script>alert(1)");
  expect(html).toContain("My &lt;board&gt;");
});

test("extractElements keeps valid elements, drops invalid", () => {
  const doc = new Y.Doc();
  const m = doc.getMap("elements");
  m.set("a", { id: "a", type: "note", x: 1, y: 2, w: 3, h: 4, text: "ok" });
  m.set("b", { id: "b", type: "bogus", x: 0, y: 0, w: 1, h: 1 }); // invalid type
  m.set("c", { id: "c", type: "link", x: 0, y: 0, w: 1, h: 1, url: "javascript:1" }); // unsafe url
  const els = extractElements(doc);
  expect(els.length).toBe(1);
  expect(els[0]!.id).toBe("a");
});

// --- DB + HTTP tests ---

beforeAll(async () => {
  const db = directDb();
  const mk = async (n: string) => (await db.insert(users).values({ email: `${n}${Date.now()}@x.test`, displayName: n }).returning())[0]!;
  const owner = await mk("eowner");
  const stranger = await mk("estranger");
  ownerTok = mintAccessToken(owner.id);
  strangerTok = mintAccessToken(stranger.id);
  const [ws] = await db.insert(workspaces).values({ name: "E", ownerId: owner.id }).returning();
  await db.insert(members).values({ workspaceId: ws!.id, userId: owner.id, role: "owner" });
  const [board] = await db.insert(boards).values({ workspaceId: ws!.id, title: "Board <x>" }).returning();
  boardId = board!.id;

  // Seed the board's Yjs doc with a note so the render endpoint has content.
  const doc = new Y.Doc();
  doc.getMap("elements").set("n1", { id: "n1", type: "note", x: 10, y: 10, w: 120, h: 60, text: "hi & <bye>" });
  await appendUpdate(boardId, Y.encodeStateAsUpdate(doc));

  node = Bun.spawn(["bun", "run", "src/index.ts"], {
    env: { ...process.env, PORT: String(PORT), NODE_ID: "export-test", LOG_LEVEL: "warn", MEKO_ALLOWED_ORIGINS: "http://localhost", MEKO_INTERNAL_TOKEN: INTERNAL },
    stdout: "inherit",
    stderr: "inherit",
  });
  await waitHealthy();
});

afterAll(() => node?.kill());

test("claim type-filter partitions export vs general work (§8b)", async () => {
  await enqueue("compact", { boardId });
  await enqueue("export", { exportId: "00000000-0000-0000-0000-000000000000" });

  const general = await claimJob({ notType: "export" });
  expect(general?.type).not.toBe("export");

  const exportJob = await claimJob({ type: "export" });
  expect(exportJob?.type).toBe("export");
});

test("export requires view access; creates a pending export", async () => {
  const stranger = await fetch(`${BASE}/api/boards/${boardId}/exports`, { method: "POST", headers: H(strangerTok), body: JSON.stringify({ format: "png" }) });
  expect(stranger.status).toBe(403);

  const res = await fetch(`${BASE}/api/boards/${boardId}/exports`, { method: "POST", headers: H(ownerTok), body: JSON.stringify({ format: "png" }) });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.id).toBeString();
  expect(body.status).toBe("pending");
});

test("internal export-render is token-gated and returns escaped self-contained HTML", async () => {
  const created = await (await fetch(`${BASE}/api/boards/${boardId}/exports`, { method: "POST", headers: H(ownerTok), body: JSON.stringify({ format: "png" }) })).json();

  // No token → invisible.
  expect((await fetch(`${BASE}/api/internal/export-render/${created.id}`)).status).toBe(404);

  const ok = await fetch(`${BASE}/api/internal/export-render/${created.id}`, { headers: { "x-internal-token": INTERNAL } });
  expect(ok.status).toBe(200);
  expect(ok.headers.get("content-type")).toContain("text/html");
  const html = await ok.text();
  expect(html).toContain("hi &amp; &lt;bye&gt;"); // note text, escaped
  expect(html).toContain("Board &lt;x&gt;"); // board title, escaped
  expect(html).not.toContain("<bye>");
});
