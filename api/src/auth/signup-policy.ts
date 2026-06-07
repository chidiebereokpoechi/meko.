import { and, gt, sql } from "drizzle-orm";
import { db } from "@/db/client.ts";
import { invites } from "@/db/schema.ts";
import { config } from "@/config.ts";

// Whether a brand-new account may be created for this email. Existing users are NOT subject to this
// — callers gate only the create path. In "invite" mode an account is allowed only when the email
// has a pending (unexpired) workspace invite, or is bootstrap-allowlisted. Shared by the OIDC
// provisioning path and the password /signup route so the policy can't be bypassed via either.
export async function canCreateAccount(email: string): Promise<boolean> {
  if (config.MEKO_SIGNUP_MODE === "open") return true;
  const e = email.toLowerCase();
  if (config.MEKO_BOOTSTRAP_EMAILS.map((x) => x.toLowerCase()).includes(e)) return true;
  const invite = await db.query.invites.findFirst({
    where: and(sql`lower(${invites.email}) = ${e}`, gt(invites.expiresAt, new Date())),
  });
  return !!invite;
}

export class SignupClosedError extends Error {}
