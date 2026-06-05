import { Elysia, t } from "elysia";
import { eq } from "drizzle-orm";
import { db } from "@/db/client.ts";
import { unfurls } from "@/db/schema.ts";
import { requireAuth } from "@/auth/middleware.ts";
import { requireBoardAccess } from "@/lib/permissions.ts";
import { enforceRateLimit } from "@/lib/rate-limit.ts";
import { isSafeUrl } from "@/lib/safe-url.ts";
import { unfurl } from "@/links/unfurl.ts";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export const linkRoutes = new Elysia({ prefix: "/api/boards" })
  .use(requireAuth)
  // Unfurl a link for a board. Edit access + 60/hour/user. Cached 24h unless ?refresh=1.
  .post(
    "/:id/unfurl",
    async ({ userId, params, body, query, set }) => {
      await requireBoardAccess(userId!, params.id, "edit");
      // SafeUrl gate at the write path, not just at fetch — blocks javascript:/data:/file: etc.
      if (!isSafeUrl(body.url)) {
        set.status = 422;
        return { error: "UNSAFE_URL" };
      }
      await enforceRateLimit(`rl:user:${userId}:unfurl`, 60, 3600);

      const cached = await db.query.unfurls.findFirst({ where: eq(unfurls.url, body.url) });
      const withinTtl = cached && Date.now() - cached.fetchedAt.getTime() < CACHE_TTL_MS;
      // Don't keep serving an empty unfurl (no title, no image) — retry so a transient miss or a
      // pre-fix cached blank gets refetched rather than pinned for the full TTL.
      const fresh = withinTtl && (!!cached!.title || !!cached!.imageUrl);
      if (cached && fresh && query.refresh !== "1") return cached;

      // unfurl() re-runs the SSRF check (and on every redirect hop); SsrfError → 422 via onError.
      const result = await unfurl(body.url);
      // Key the cache by the requested URL (the result URL may differ after redirects).
      const [row] = await db
        .insert(unfurls)
        .values({ url: body.url, title: result.title, description: result.description, imageUrl: result.imageUrl, resolvedIp: result.resolvedIp, fetchedAt: new Date() })
        .onConflictDoUpdate({
          target: unfurls.url,
          set: { title: result.title, description: result.description, imageUrl: result.imageUrl, resolvedIp: result.resolvedIp, fetchedAt: new Date() },
        })
        .returning();
      return row;
    },
    { body: t.Object({ url: t.String({ maxLength: 2048 }) }) },
  );
