import { eq } from "drizzle-orm";
import { db } from "@/db/client.ts";
import { users } from "@/db/schema.ts";
import { securityEvent } from "@/lib/logger.ts";
import type { OidcClaims } from "@/auth/oidc.ts";

// Just-in-time provisioning of a meko user from verified OIDC claims. The IdP's `sub` is the stable
// join key. Returns the meko userId; the caller then issues a normal meko session.
//
// Linking policy (security): an existing password account is linked to this `sub` ONLY when the IdP
// asserts the email is verified. Auto-linking an unverified email would let an attacker who controls
// a social account with someone else's email address take over that meko account.
export async function provisionOidcUser(claims: OidcClaims): Promise<string> {
  // 1. Returning social user — matched by stable sub.
  const bySub = await db.query.users.findFirst({ where: eq(users.oidcSub, claims.sub) });
  if (bySub) {
    if (claims.name && claims.name !== bySub.displayName) {
      await db.update(users).set({ displayName: claims.name }).where(eq(users.id, bySub.id));
    }
    return bySub.id;
  }

  // 2. Existing account with the same email — link only if the IdP verified the email.
  const byEmail = await db.query.users.findFirst({ where: eq(users.email, claims.email) });
  if (byEmail) {
    if (!claims.emailVerified) {
      securityEvent("auth.oidc_link_refused", { reason: "email_unverified", email: claims.email });
      throw new OidcLinkError("EMAIL_UNVERIFIED");
    }
    await db.update(users).set({ oidcSub: claims.sub }).where(eq(users.id, byEmail.id));
    securityEvent("auth.oidc_linked", { userId: byEmail.id });
    return byEmail.id;
  }

  // 3. Brand-new user. Guard the unique(oidc_sub) race: on a conflicting insert, re-read by sub.
  try {
    const [u] = await db
      .insert(users)
      .values({ email: claims.email, displayName: claims.name ?? claims.email, oidcSub: claims.sub, passwordHash: null })
      .returning({ id: users.id });
    return u!.id;
  } catch (err) {
    const raced = await db.query.users.findFirst({ where: eq(users.oidcSub, claims.sub) });
    if (raced) return raced.id;
    throw err;
  }
}

export class OidcLinkError extends Error {}
