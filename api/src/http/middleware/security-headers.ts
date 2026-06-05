import crypto from "node:crypto";
import { Elysia } from "elysia";
import { config, isProd } from "@/config.ts";

// Build the CSP (§12k). A fresh nonce per request lets us drop 'unsafe-inline' from script-src.
// 'unsafe-eval' is intentionally absent. style-src keeps 'unsafe-inline' for the canvas renderer
// (mitigated by hex-validated colours, §4b) — tracked as an open question to remove later.
function buildCsp(nonce: string): string {
  const wss = config.MEKO_ALLOWED_ORIGINS.map((o) => o.replace(/^http/, "ws")).join(" ");
  return [
    "default-src 'none'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self'",
    `connect-src 'self' ${wss}`.trim(),
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "upgrade-insecure-requests",
  ].join("; ");
}

// §12j + §12k. HSTS is only meaningful over TLS — set it when the original request was HTTPS
// (direct or via a trusted proxy's X-Forwarded-Proto) so we don't advertise it over plaintext.
// Hooks are declared global so they apply to sibling route plugins, not just routes defined on
// this instance (Elysia encapsulates plugin hooks as 'local' by default).
export const securityHeaders = new Elysia({ name: "security-headers" })
  .derive({ as: "global" }, () => ({ cspNonce: crypto.randomBytes(16).toString("base64") }))
  .onAfterHandle({ as: "global" }, ({ set, cspNonce, request }) => {
    set.headers["x-content-type-options"] = "nosniff";
    set.headers["x-frame-options"] = "DENY";
    set.headers["referrer-policy"] = "strict-origin-when-cross-origin";
    set.headers["permissions-policy"] = "camera=(), microphone=(), geolocation=(), payment=()";
    set.headers["content-security-policy"] = buildCsp(cspNonce);

    const proto = request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
    if (isProd && proto === "https") {
      set.headers["strict-transport-security"] = "max-age=63072000; includeSubDomains; preload";
    }
  });
