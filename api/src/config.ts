import { z } from "zod";

// Single source of truth for environment. Read config from here, never process.env elsewhere.

const csv = (raw: string) =>
  raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_VERSION: z.string().default("0.0.0"),
  PORT: z.coerce.number().int().positive().default(3000),
  // Stable per-node identity used to skip a node's own pub/sub broadcasts (§3e).
  NODE_ID: z.string().min(1).default("node-1"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  MEKO_BASE_URL: z.string().url().default("http://localhost:3000"),

  // App connects through PgBouncer; migrator/session locks use the direct URL (§3d).
  DATABASE_URL: z.string().min(1),
  POSTGRES_DIRECT_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 bytes"),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  WS_TICKET_TTL_SECONDS: z.coerce.number().int().positive().default(10),

  // Used for both CORS and WebSocket Origin validation (§5g/§12l).
  MEKO_ALLOWED_ORIGINS: z.string().default("").transform(csv),

  // OIDC login via an external IdP (Authentik). All optional — OIDC is disabled unless issuer +
  // client id + secret are all set (see `oidcEnabled`). The IdP authenticates the user; meko still
  // issues its own session (rotating refresh cookie) and remains the session-of-record.
  OIDC_ISSUER: z.string().default(""), // discovery: {issuer}/.well-known/openid-configuration
  OIDC_CLIENT_ID: z.string().default(""),
  OIDC_CLIENT_SECRET: z.string().default(""),
  OIDC_REDIRECT_URI: z.string().default(""), // {MEKO_BASE_URL}/api/auth/oidc/callback
  // Where the OIDC callback sends the browser after a successful login (the SPA origin).
  MEKO_WEB_URL: z.string().url().default("http://localhost:5173"),

  MEKO_MAX_BOARD_BYTES: z.coerce.number().int().positive().default(50 * 1024 * 1024),
  MEKO_SNAPSHOT_RETENTION: z.coerce.number().int().positive().default(3),
  ROUTE_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

  // Object storage (S3-compatible, e.g. RustFS/MinIO). Empty endpoint disables media.
  // S3_ENDPOINT is the fallback for both roles. Split them when the app reaches storage over a
  // LAN address but the browser must fetch presigned URLs over a public host: presigned URLs are
  // signed for S3_ENDPOINT_PUBLIC (SigV4 binds the host), data ops use S3_ENDPOINT_INTERNAL.
  S3_ENDPOINT: z.string().default(""),
  S3_ENDPOINT_INTERNAL: z.string().default(""),
  S3_ENDPOINT_PUBLIC: z.string().default(""),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().default("meko"),
  S3_ACCESS_KEY: z.string().default(""),
  S3_SECRET_KEY: z.string().default(""),
  MEKO_MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(25 * 1024 * 1024),

  // Shared secret gating internal-only ops endpoints (dead-letter inspection). Empty ⇒ endpoints
  // return 404, hiding their existence.
  MEKO_INTERNAL_TOKEN: z.string().default(""),

  // Export sidecar (§8b). API base the sidecar reaches for the render endpoint, the Chromium
  // binary path inside the sidecar image, and the only host Chromium is allowed to contact.
  MEKO_API_INTERNAL_URL: z.string().default("http://app:3000"),
  CHROMIUM_PATH: z.string().default("/usr/bin/chromium-browser"),
  EXPORT_ALLOWED_HOST: z.string().default("app"),
});

const parsed = Env.safeParse(process.env);
if (!parsed.success) {
  // Fail fast and loud — a misconfigured node must not boot half-wired.
  console.error("Invalid environment configuration:");
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join(".") || "(root)"}: ${issue.message}`);
  }
  process.exit(1);
}

export const config = Object.freeze(parsed.data);
export type Config = typeof config;

export const isProd = config.NODE_ENV === "production";

// OIDC is wired only when the issuer + confidential-client creds are all present. The login/callback
// routes 404 otherwise, so a half-configured node never exposes a broken auth path.
export const oidcEnabled = !!(config.OIDC_ISSUER && config.OIDC_CLIENT_ID && config.OIDC_CLIENT_SECRET);
if (oidcEnabled && !config.OIDC_REDIRECT_URI) {
  console.error("OIDC_ISSUER set but OIDC_REDIRECT_URI is empty — set it to {MEKO_BASE_URL}/api/auth/oidc/callback");
  process.exit(1);
}

// Resolve the two storage roles, each falling back to the single S3_ENDPOINT.
const s3Internal = config.S3_ENDPOINT_INTERNAL || config.S3_ENDPOINT;
export const s3Endpoints = Object.freeze({
  internal: s3Internal, // app → storage (put/get/delete + presign signing host when no public split)
  public: config.S3_ENDPOINT_PUBLIC || s3Internal, // host browsers fetch presigned URLs from
});

// Warn loudly if serving over plaintext in a non-localhost context (§11b).
if (isProd && config.MEKO_BASE_URL.startsWith("http://") && !config.MEKO_BASE_URL.includes("localhost")) {
  console.warn("[meko] MEKO_BASE_URL is http:// in production — tokens will travel in plaintext. Terminate TLS.");
}
