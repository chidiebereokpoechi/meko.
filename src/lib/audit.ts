import { db } from "@/db/client.ts";
import { auditLog } from "@/db/schema.ts";
import { ctxLog } from "@/lib/logger.ts";

// Append-only audit trail for sensitive actions (membership, sharing, deletion). Best-effort:
// a failure to write the audit row must not fail the action itself, but is logged.
export async function audit(
  action: string,
  opts: { workspaceId?: string | null; userId?: string | null; resource?: string; detail?: Record<string, unknown> },
): Promise<void> {
  try {
    await db.insert(auditLog).values({
      action,
      workspaceId: opts.workspaceId ?? null,
      userId: opts.userId ?? null,
      resource: opts.resource ?? null,
      detail: opts.detail ?? null,
    });
  } catch (err) {
    ctxLog().error({ err, action: "audit.write_fail", auditAction: action }, "failed to write audit row");
  }
}
