import { Elysia } from "elysia";
import { sql } from "drizzle-orm";
import { db } from "@/db/client.ts";
import { redis } from "@/lib/redis.ts";
import { ctxLog } from "@/lib/logger.ts";
import { withTimeout } from "@/http/middleware/timeout.ts";

export const health = new Elysia()
  // Liveness (§3f): is the process alive? Never touches external deps — a slow DB must not get
  // the container killed.
  .get("/healthz", () => "ok")
  // Readiness (§3f): should we route traffic here? 503 until DB + Redis are reachable.
  .get("/readyz", async ({ set }) => {
    try {
      await withTimeout(() => Promise.all([db.execute(sql`SELECT 1`), redis.ping()]), 3000);
      return "ok";
    } catch (err) {
      ctxLog().error({ err, action: "readyz.fail" }, "readiness check failed");
      set.status = 503;
      return "not ready";
    }
  });
