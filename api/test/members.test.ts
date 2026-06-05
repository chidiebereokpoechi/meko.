import { afterAll, beforeAll, expect, test } from "bun:test";
import { directDb } from "@/db/client.ts";
import { users } from "@/db/schema.ts";
import { mintAccessToken } from "@/auth/tokens.ts";

// Workspace member management: list, role change, removal, owner protection, pending-invite revoke.
const PORT = 3502;
const BASE = `http://localhost:${PORT}`;
let node: ReturnType<typeof Bun.spawn>;
let ownerTok: string, memberTok: string;
let ownerId: string, memberId: string;
let memberEmail: string;
let wsId: string;

const H = (tok: string) => ({ authorization: `Bearer ${tok}`, "content-type": "application/json" });
const req = (method: string, path: string, tok: string, body?: unknown) =>
  fetch(`${BASE}${path}`, { method, headers: H(tok), body: body ? JSON.stringify(body) : undefined });

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
  const member = await mk("member");
  ownerId = owner.id;
  memberId = member.id;
  memberEmail = member.email;
  ownerTok = mintAccessToken(owner.id);
  memberTok = mintAccessToken(member.id);

  node = Bun.spawn(["bun", "run", "src/index.ts"], {
    env: { ...process.env, PORT: String(PORT), NODE_ID: "members", LOG_LEVEL: "warn", MEKO_ALLOWED_ORIGINS: "http://localhost" },
    stdout: "inherit",
    stderr: "inherit",
  });
  await waitHealthy();

  const ws = await (await req("POST", "/api/workspaces", ownerTok, { name: "WS" })).json();
  wsId = ws.id;
  // member joins as editor via an invite.
  const inv = await (await req("POST", `/api/workspaces/${wsId}/invites`, ownerTok, { email: memberEmail, role: "editor" })).json();
  await req("POST", "/api/invites/accept", memberTok, { token: inv.token });
});

afterAll(() => node?.kill());

test("members list returns owner + member with identity", async () => {
  const list = await (await req("GET", `/api/workspaces/${wsId}/members`, ownerTok)).json();
  expect(list).toHaveLength(2);
  const owner = list.find((m: { userId: string }) => m.userId === ownerId);
  const member = list.find((m: { userId: string }) => m.userId === memberId);
  expect(owner.role).toBe("owner");
  expect(member.role).toBe("editor");
  expect(member.email).toBe(memberEmail);
});

test("owner changes a member's role; member cannot manage", async () => {
  expect((await req("PATCH", `/api/workspaces/${wsId}/members/${memberId}`, ownerTok, { role: "viewer" })).status).toBe(200);
  const list = await (await req("GET", `/api/workspaces/${wsId}/members`, ownerTok)).json();
  expect(list.find((m: { userId: string }) => m.userId === memberId).role).toBe("viewer");

  // Non-admin (now viewer) can't change roles.
  expect((await req("PATCH", `/api/workspaces/${wsId}/members/${ownerId}`, memberTok, { role: "viewer" })).status).toBe(403);
});

test("owner role is immutable and owner cannot be removed", async () => {
  expect((await req("PATCH", `/api/workspaces/${wsId}/members/${ownerId}`, ownerTok, { role: "admin" })).status).toBe(403);
  expect((await req("DELETE", `/api/workspaces/${wsId}/members/${ownerId}`, ownerTok)).status).toBe(403);
});

test("pending invite can be listed and revoked", async () => {
  const inv = await (await req("POST", `/api/workspaces/${wsId}/invites`, ownerTok, { email: `pending${Date.now()}@x.test`, role: "viewer" })).json();
  let pending = await (await req("GET", `/api/workspaces/${wsId}/invites`, ownerTok)).json();
  expect(pending.some((p: { id: string }) => p.id === inv.id)).toBe(true);

  expect((await req("DELETE", `/api/workspaces/${wsId}/invites/${inv.id}`, ownerTok)).status).toBe(200);
  pending = await (await req("GET", `/api/workspaces/${wsId}/invites`, ownerTok)).json();
  expect(pending.some((p: { id: string }) => p.id === inv.id)).toBe(false);
});

test("owner removes a member", async () => {
  expect((await req("DELETE", `/api/workspaces/${wsId}/members/${memberId}`, ownerTok)).status).toBe(200);
  const list = await (await req("GET", `/api/workspaces/${wsId}/members`, ownerTok)).json();
  expect(list.some((m: { userId: string }) => m.userId === memberId)).toBe(false);
  // Removed member loses access.
  expect((await req("GET", `/api/workspaces/${wsId}/members`, memberTok)).status).toBe(403);
});
