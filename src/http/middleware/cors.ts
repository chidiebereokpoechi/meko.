import { Elysia } from "elysia";
import { config } from "@/config.ts";

// Explicit CORS (§12l). Never `Access-Control-Allow-Origin: *` with credentials. Reflect the
// origin only if it is allow-listed, and Vary on Origin so a CDN can't poison the cache.
const allowed = new Set(config.MEKO_ALLOWED_ORIGINS);

export const cors = new Elysia({ name: "cors" })
  .onRequest(({ request, set }) => {
    const origin = request.headers.get("origin") ?? "";
    if (allowed.has(origin)) {
      set.headers["access-control-allow-origin"] = origin;
      set.headers["access-control-allow-credentials"] = "true";
      set.headers["vary"] = "Origin";
    }
    set.headers["access-control-allow-methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS";
    set.headers["access-control-allow-headers"] = "Authorization, Content-Type, X-Request-ID, Idempotency-Key";
    set.headers["access-control-max-age"] = "86400";

    if (request.method === "OPTIONS") {
      set.status = 204;
      return "";
    }
  });
