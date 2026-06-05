import { Elysia } from "elysia";
import crypto from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client.ts";
import { boardExports, boards, jobs } from "@/db/schema.ts";
import { config } from "@/config.ts";
import { loadDoc } from "@/realtime/persistence.ts";
import { buildExportHtml, extractElements } from "@/export/html.ts";
import { claimJob, completeJob, failJobById } from "@/worker/queue.ts";
import { putBytes } from "@/lib/storage.ts";

// Internal-only ops surface (§12n). Gated by a shared secret; when unset, every route 404s so the
// endpoint is invisible. In production this is additionally reachable only from inside the
// network (not proxied by nginx).
function authorized(request: Request): boolean {
  const token = config.MEKO_INTERNAL_TOKEN;
  if (!token) return false;
  const given = request.headers.get("x-internal-token") ?? "";
  return given.length === token.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(token));
}

export const internalRoutes = new Elysia({ prefix: "/api/internal" })
  .onBeforeHandle(({ request, set }) => {
    if (!authorized(request)) {
      set.status = 404;
      return { error: "NOT_FOUND" };
    }
  })
  // Dead-lettered jobs awaiting operator attention (§12n).
  .get("/jobs/dead", async () => {
    const rows = await db
      .select({ id: jobs.id, type: jobs.type, error: jobs.error, attempts: jobs.attempts, updatedAt: jobs.updatedAt })
      .from(jobs)
      .where(eq(jobs.status, "dead"))
      .orderBy(desc(jobs.updatedAt))
      .limit(200);
    return { count: rows.length, jobs: rows };
  })
  // Self-contained board HTML for the export sidecar (§8b). All data is assembled here, server
  // side, behind the internal-token gate — the sidecar's Chromium only ever talks to this route,
  // never to S3/Postgres/Redis or any external host.
  .get("/export-render/:exportId", async ({ params, set }) => {
    const exp = await db.query.boardExports.findFirst({ where: eq(boardExports.id, params.exportId) });
    if (!exp) {
      set.status = 404;
      return { error: "NOT_FOUND" };
    }
    const [board] = await db.select({ title: boards.title }).from(boards).where(eq(boards.id, exp.boardId)).limit(1);
    const doc = await loadDoc(exp.boardId);
    set.headers["content-type"] = "text/html; charset=utf-8";
    return buildExportHtml(board?.title ?? "Board", extractElements(doc));
  })
  // The sidecar claims one export job here (it has no DB access of its own, §8b).
  .post("/export-claim", async () => {
    const job = await claimJob({ type: "export" });
    if (!job) return { none: true };
    const { exportId } = job.payload as { exportId: string };
    const [row] = await db
      .update(boardExports)
      .set({ status: "running" })
      .where(eq(boardExports.id, exportId))
      .returning({ format: boardExports.format });
    return { jobId: job.id, exportId, format: row?.format };
  })
  // The sidecar posts the rendered bytes back; the API (not the sidecar) writes to S3 + DB.
  .post("/export-result/:exportId", async ({ params, query, request, set }) => {
    const jobId = query.jobId as string;
    const exp = await db.query.boardExports.findFirst({ where: eq(boardExports.id, params.exportId) });
    if (!exp || !jobId) {
      set.status = 404;
      return { error: "NOT_FOUND" };
    }
    if (query.status === "fail") {
      await db.update(boardExports).set({ status: "failed", error: String(query.error ?? "render failed") }).where(eq(boardExports.id, exp.id));
      await failJobById(jobId, new Error(String(query.error ?? "render failed")));
      return { ok: true };
    }
    const bytes = new Uint8Array(await request.arrayBuffer());
    const key = `boards/${exp.boardId}/exports/${exp.id}.${exp.format}`;
    await putBytes(key, bytes, exp.format === "pdf" ? "application/pdf" : "image/png");
    await db.update(boardExports).set({ status: "ready", resultKey: key }).where(eq(boardExports.id, exp.id));
    await completeJob(jobId);
    return { ok: true };
  });
