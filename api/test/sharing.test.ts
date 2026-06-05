import { afterAll, beforeAll, expect, test } from "bun:test";
import { directDb } from "@/db/client.ts";
import { users } from "@/db/schema.ts";
import { mintAccessToken } from "@/auth/tokens.ts";

// Sharing & permissions: share-link redeem/revoke, invite accept, internal dead-letter gating.
const PORT = 3501;
const BASE = `http://localhost:${PORT}`;
const INTERNAL = "test-internal-token-123456";
let node: ReturnType<typeof Bun.spawn>;
let ownerTok: string, guestTok: string, inviteeTok: string;
let inviteeEmail: string;
let wsId: string, boardId: string;

const H = (tok: string) => ({ authorization: `Bearer ${tok}`, "content-type": "application/json" });
const post = (path: string, tok: string, body?: unknown) =>
  fetch(`${BASE}${path}`, { method: "POST", headers: H(tok), body: body ? JSON.stringify(body) : undefined });

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
  const mk = async (name: string) => (await db.insert(users).values({ email: `${name}${Date.now()}@x.test`, displayName: name }).returning())[0]!;
  const owner = await mk("owner");
  const guest = await mk("guest");
  const invitee = await mk("invitee");
  ownerTok = mintAccessToken(owner.id);
  guestTok = mintAccessToken(guest.id);
  inviteeTok = mintAccessToken(invitee.id);
  inviteeEmail = invitee.email;

  node = Bun.spawn(["bun", "run", "src/index.ts"], {
    env: { ...process.env, PORT: String(PORT), NODE_ID: "sharing", LOG_LEVEL: "warn", MEKO_ALLOWED_ORIGINS: "http://localhost", MEKO_INTERNAL_TOKEN: INTERNAL },
    stdout: "inherit",
    stderr: "inherit",
  });
  await waitHealthy();

  const ws = await (await post("/api/workspaces", ownerTok, { name: "WS" })).json();
  wsId = ws.id;
  const board = await (await post(`/api/workspaces/${wsId}/boards`, ownerTok, { title: "B" })).json();
  boardId = board.id;
});

afterAll(() => node?.kill());

test("share link grants view access; revocation blocks re-accept", async () => {
  // Guest starts with no access.
  expect((await fetch(`${BASE}/api/boards/${boardId}`, { headers: H(guestTok) })).status).toBe(403);

  const link = await (await post(`/api/boards/${boardId}/share`, ownerTok, { level: "view" })).json();
  expect(link.token).toBeString();

  // Redeem → view access.
  const accept = await post("/api/share/accept", guestTok, { token: link.token });
  expect(accept.status).toBe(200);
  expect((await fetch(`${BASE}/api/boards/${boardId}`, { headers: H(guestTok) })).status).toBe(200);

  // View-only: cannot edit.
  expect((await fetch(`${BASE}/api/boards/${boardId}`, { method: "PATCH", headers: H(guestTok), body: JSON.stringify({ title: "x" }) })).status).toBe(403);

  // Revoke a specific link → its token no longer redeems.
  const link2 = await (await post(`/api/boards/${boardId}/share`, ownerTok, { level: "view" })).json();
  expect((await post(`/api/boards/${boardId}/share/${link2.id}/revoke`, ownerTok)).status).toBe(200);
  expect((await post("/api/share/accept", guestTok, { token: link2.token })).status).toBe(404);

  // The revoke endpoint also confirms the list view works.
  const list = await (await fetch(`${BASE}/api/boards/${boardId}/share`, { headers: H(ownerTok) })).json();
  expect(Array.isArray(list)).toBe(true);
});

test("invalid share token is 404", async () => {
  expect((await post("/api/share/accept", guestTok, { token: "deadbeef" })).status).toBe(404);
});

test("invite accept adds the redeemer as a workspace member", async () => {
  // Invitee can't create boards in the workspace yet.
  expect((await post(`/api/workspaces/${wsId}/boards`, inviteeTok, { title: "nope" })).status).toBe(403);

  const inv = await (await post(`/api/workspaces/${wsId}/invites`, ownerTok, { email: inviteeEmail, role: "editor" })).json();
  expect(inv.token).toBeString();

  expect((await post("/api/invites/accept", inviteeTok, { token: inv.token })).status).toBe(200);
  // Now an editor → can create boards.
  expect((await post(`/api/workspaces/${wsId}/boards`, inviteeTok, { title: "yes" })).status).toBe(200);
});

test("guest (non-admin) cannot invite", async () => {
  expect((await post(`/api/workspaces/${wsId}/invites`, guestTok, { email: "x@y.test", role: "editor" })).status).toBe(403);
});

test("internal dead-letter endpoint is gated by the internal token (§12n)", async () => {
  expect((await fetch(`${BASE}/api/internal/jobs/dead`)).status).toBe(404);
  const ok = await fetch(`${BASE}/api/internal/jobs/dead`, { headers: { "x-internal-token": INTERNAL } });
  expect(ok.status).toBe(200);
  expect(await ok.json()).toHaveProperty("count");
});
