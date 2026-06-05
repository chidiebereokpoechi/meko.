import { Elysia } from "elysia";
import { verifyAccessToken } from "@/auth/tokens.ts";

export function bearerUser(authHeader: string | null): string | null {
  if (!authHeader?.startsWith("Bearer ")) return null;
  return verifyAccessToken(authHeader.slice(7))?.sub ?? null;
}

// Scoped guard: derives a non-null `userId` for routes mounted under it; 401s otherwise. Applied
// per route group via `.use(requireAuth)` so public routes (health, auth/refresh) stay open.
export const requireAuth = new Elysia({ name: "require-auth" })
  .derive({ as: "scoped" }, ({ request }) => ({ userId: bearerUser(request.headers.get("authorization")) }))
  .onBeforeHandle({ as: "scoped" }, ({ userId, set }) => {
    if (!userId) {
      set.status = 401;
      return { error: "UNAUTHENTICATED" };
    }
  });
