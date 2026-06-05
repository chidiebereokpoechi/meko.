import { Elysia, t } from "elysia";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client.ts";
import { boardPermissions, boards, invites, members, shareLinks } from "@/db/schema.ts";
import { requireAuth } from "@/auth/middleware.ts";
import { requireBoardAccess, requireWorkspaceRole } from "@/lib/permissions.ts";
import { enforceRateLimit } from "@/lib/rate-limit.ts";
import { randomToken, sha256Hex } from "@/lib/token.ts";
import { audit } from "@/lib/audit.ts";

const HOUR = 3_600_000;
const DAY = 86_400_000;

export const shareRoutes = new Elysia({ prefix: "/api" })
  .use(requireAuth)
  // --- Share links (board-scoped) ---
  .post(
    "/boards/:id/share",
    async ({ userId, params, body }) => {
      await requireBoardAccess(userId!, params.id, "edit");
      const raw = randomToken();
      const expiresAt = body.expiresInHours ? new Date(Date.now() + body.expiresInHours * HOUR) : null;
      const [link] = await db
        .insert(shareLinks)
        .values({ boardId: params.id, tokenHash: sha256Hex(raw), level: body.level ?? "view", createdBy: userId!, expiresAt })
        .returning({ id: shareLinks.id, level: shareLinks.level, expiresAt: shareLinks.expiresAt });
      await audit("share.created", { userId, resource: `board:${params.id}`, detail: { linkId: link!.id, level: link!.level } });
      // Raw token returned exactly once.
      return { ...link, token: raw };
    },
    { body: t.Object({ level: t.Optional(t.Union([t.Literal("view"), t.Literal("edit")])), expiresInHours: t.Optional(t.Number({ minimum: 1, maximum: 8760 })) }) },
  )
  .get("/boards/:id/share", async ({ userId, params }) => {
    await requireBoardAccess(userId!, params.id, "edit");
    return db
      .select({ id: shareLinks.id, level: shareLinks.level, expiresAt: shareLinks.expiresAt, revokedAt: shareLinks.revokedAt, createdAt: shareLinks.createdAt })
      .from(shareLinks)
      .where(eq(shareLinks.boardId, params.id))
      .orderBy(desc(shareLinks.createdAt));
  })
  .post("/boards/:id/share/:linkId/revoke", async ({ userId, params, set }) => {
    await requireBoardAccess(userId!, params.id, "edit");
    const [row] = await db
      .update(shareLinks)
      .set({ revokedAt: new Date() })
      .where(and(eq(shareLinks.id, params.linkId), eq(shareLinks.boardId, params.id)))
      .returning({ id: shareLinks.id });
    if (!row) {
      set.status = 404;
      return { error: "NOT_FOUND" };
    }
    await audit("share.revoked", { userId, resource: `board:${params.id}`, detail: { linkId: params.linkId } });
    return { ok: true };
  })
  // Redeem a share link while signed in: grants the redeemer a board permission.
  .post(
    "/share/accept",
    async ({ userId, body, set }) => {
      const link = await db.query.shareLinks.findFirst({ where: eq(shareLinks.tokenHash, sha256Hex(body.token)) });
      if (!link || link.revokedAt || (link.expiresAt && link.expiresAt < new Date())) {
        set.status = 404;
        return { error: "INVALID_SHARE_LINK" };
      }
      await db
        .insert(boardPermissions)
        .values({ boardId: link.boardId, userId: userId!, level: link.level })
        .onConflictDoUpdate({ target: [boardPermissions.boardId, boardPermissions.userId], set: { level: link.level } });
      await audit("share.accepted", { userId, resource: `board:${link.boardId}`, detail: { level: link.level } });
      return { boardId: link.boardId, level: link.level };
    },
    { body: t.Object({ token: t.String({ minLength: 1, maxLength: 200 }) }) },
  )
  // --- Workspace invites ---
  .post(
    "/workspaces/:id/invites",
    async ({ userId, params, body }) => {
      await requireWorkspaceRole(userId!, params.id, ["owner", "admin"]);
      await enforceRateLimit(`rl:user:${userId}:invites`, 20, DAY / 1000);
      const raw = randomToken();
      const [inv] = await db
        .insert(invites)
        .values({ workspaceId: params.id, email: body.email, role: body.role ?? "editor", tokenHash: sha256Hex(raw), invitedBy: userId!, expiresAt: new Date(Date.now() + 7 * DAY) })
        .returning({ id: invites.id, email: invites.email, role: invites.role });
      await audit("invite.created", { workspaceId: params.id, userId, detail: { email: body.email, role: inv!.role } });
      return { ...inv, token: raw };
    },
    { body: t.Object({ email: t.String({ format: "email", maxLength: 320 }), role: t.Optional(t.Union([t.Literal("admin"), t.Literal("editor"), t.Literal("viewer")])) }) },
  )
  // Accept an invite while signed in: adds the redeemer as a workspace member.
  .post(
    "/invites/accept",
    async ({ userId, body, set }) => {
      const inv = await db.query.invites.findFirst({ where: eq(invites.tokenHash, sha256Hex(body.token)) });
      if (!inv || inv.acceptedAt || inv.expiresAt < new Date()) {
        set.status = 404;
        return { error: "INVALID_INVITE" };
      }
      await db
        .insert(members)
        .values({ workspaceId: inv.workspaceId, userId: userId!, role: inv.role })
        .onConflictDoUpdate({ target: [members.workspaceId, members.userId], set: { role: inv.role } });
      await db.update(invites).set({ acceptedAt: new Date() }).where(eq(invites.id, inv.id));
      await audit("invite.accepted", { workspaceId: inv.workspaceId, userId, detail: { role: inv.role } });
      return { workspaceId: inv.workspaceId, role: inv.role };
    },
    { body: t.Object({ token: t.String({ minLength: 1, maxLength: 200 }) }) },
  );
