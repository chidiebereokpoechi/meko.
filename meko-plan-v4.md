# meko. — planning & architecture (v4)

> **Legend:** ✅ addition/improvement · ⚠️ concern addressed · 🔴 critical risk · 🆕 new in v4
>
> v4 does not repeat prose that is unchanged and correct from v3. It annotates, extends, and
> corrects. Read alongside v3.

---

## Summary of v4 changes

| #   | Area                                                    | Severity | Issue                                                                                                            |
| --- | ------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------- |
| A   | PgBouncer + advisory lock conflict                      | 🔴       | Session-level advisory lock in §12h is broken when routed through PgBouncer transaction mode                     |
| B   | WebSocket CSRF fix not specified                        | 🔴       | v3 identifies the problem (item D) but never provides a concrete fix                                             |
| C   | Client-side token storage                               | 🔴       | No spec for where access tokens live on the client; localStorage = XSS game-over                                 |
| D   | Multi-node Yjs divergence                               | 🔴       | Two WS nodes handling the same board have divergent in-memory Y.Doc; Redis pub/sub mentioned but never specified |
| E   | Missing Content Security Policy                         | ⚠️       | No CSP header; XSS on a canvas app with user-supplied content is catastrophic                                    |
| F   | `javascript:` scheme in link elements                   | ⚠️       | URL validation must explicitly block `javascript:`, `data:`, `vbscript:` before unfurl and before rendering      |
| G   | Job queue `SELECT FOR UPDATE` hotspot                   | ⚠️       | Missing `SKIP LOCKED`; worker contention serialises all job claims under load                                    |
| H   | PgBouncer breaks `pg_advisory_lock` in migration runner | ⚠️       | Duplicate of A but specifically: migrator must connect to `db:5432` not `pgbouncer:6432`                         |
| I   | SVG served as `<img>` is not fully safe                 | ⚠️       | Some browsers execute scripts in same-origin SVGs loaded via `<img>`; must transcode or sandbox                  |
| J   | Missing health check endpoints                          | 🆕       | No `/healthz` / `/readyz` for load balancer probes and rolling deploys                                           |
| K   | Missing structured logging                              | 🆕       | No logging strategy; correlating security incidents without structured logs is impossible                        |
| L   | Missing autovacuum tuning                               | 🆕       | High-churn tables (`jobs`, `yjs_updates`, `refresh_tokens`) will bloat without custom `autovacuum` settings      |
| M   | Missing database backup strategy                        | 🆕       | No backup/restore spec for self-hosted deployments                                                               |
| N   | Missing cursor-based pagination                         | 🆕       | No pagination spec; a large workspace returns all boards/elements in one query                                   |
| O   | Missing HTTPS/TLS spec                                  | 🆕       | No TLS termination or HTTP-to-HTTPS redirect strategy                                                            |
| P   | CORS policy not specified                               | 🆕       | No explicit CORS config; defaults vary by framework and allow credential-carrying cross-origin requests          |
| Q   | Missing security headers                                | 🆕       | HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy — none specified              |
| R   | Chromium export sidecar runs as root                    | 🆕       | Default Docker image runs Chromium as root; needs non-root user + network egress policy                          |
| S   | Missing global API request timeout                      | 🆕       | Long-running requests exhaust the DB connection pool with no timeout backstop                                    |
| T   | Missing Yjs document size limit                         | 🆕       | No max Y.Doc size; a board with millions of elements exhausts server memory                                      |
| U   | Missing job dead-letter queue                           | 🆕       | After `max_attempts`, failed jobs sit silently; no alerting or operator visibility                               |
| V   | Missing yjs_snapshots retention logic                   | 🆕       | "Keep N most recent via trigger or post-compaction cleanup" — implementation never given                         |
| W   | Rate limiting by user ID for authed routes              | 🆕       | IP-only rate limiting is evaded via IP rotation; authenticated routes must also rate-limit by user ID            |
| X   | Missing Yjs time-based compaction                       | 🆕       | Boards that always have ≥1 client connected never compact; need a time-based trigger                             |
| Y   | Refresh token rotation on every use                     | ⚠️       | v3 only rotates on reuse detection; rotation must happen on every valid refresh                                  |
| Z   | Missing circuit breaker for S3/email                    | 🆕       | No resilience pattern for external service failure cascading into the job queue                                  |

---

## 3. Architecture overview (v4 additions)

### 3d. 🔴 PgBouncer transaction mode breaks session-level advisory locks

**This is a silent data integrity bug introduced by the interaction between v3 §3b and §12h.**

PgBouncer in `transaction` pool mode assigns a different backend connection for each transaction.
`pg_advisory_lock` (session-level) is tied to the lifetime of a PostgreSQL _session_, not a
transaction. When called through PgBouncer, the session disappears at transaction end, so:

- The retry loop in §12h calls `pg_try_advisory_lock` on what appear to be successive attempts —
  but each attempt runs on a _different backend session_. The lock acquired on attempt 1 is held
  on backend session 42; attempt 2 runs on backend session 71, which sees no existing lock and
  acquires it, giving two concurrent migrators.
- The `pg_advisory_unlock` in the `finally` block also runs on an arbitrary session and may
  silently no-op (Postgres returns `false` from `pg_advisory_unlock` when the lock isn't held
  by the current session, but the code doesn't check the return value).

**Fix: the migration runner must bypass PgBouncer entirely.**

```ts
// migrate.ts — use a direct Postgres connection, never the pooled URL
const migrationDb = drizzle(
  new Pool({ connectionString: process.env.POSTGRES_DIRECT_URL }), // db:5432, not pgbouncer:6432
);
```

Add `POSTGRES_DIRECT_URL=postgres://user:pass@db:5432/meko` alongside `DATABASE_URL` (which
points at PgBouncer). The migrator uses `POSTGRES_DIRECT_URL`; the application uses `DATABASE_URL`.

**Same rule applies to any code using `pg_advisory_lock` (session-level).** The compaction code
in §5c correctly uses `pg_try_advisory_xact_lock` (transaction-scoped), which _does_ work with
PgBouncer transaction mode because the lock is automatically released at transaction end, matching
PgBouncer's connection lifecycle exactly. No change needed there.

| Lock type                                        | Works with PgBouncer transaction mode?         |
| ------------------------------------------------ | ---------------------------------------------- |
| `pg_try_advisory_xact_lock` (transaction-scoped) | ✅ Yes — released at COMMIT/ROLLBACK           |
| `pg_advisory_lock` (session-scoped)              | 🔴 No — session ends after each transaction    |
| `LISTEN/NOTIFY`                                  | 🔴 No — must use a dedicated direct connection |

### 3e. 🔴 Multi-node Yjs room synchronisation

v3 mentions Redis pub/sub for multi-node coordination without specifying the protocol.
Two WebSocket servers handling clients of the **same board** will diverge silently: Node A's
in-memory `Y.Doc` will not reflect Node B's updates, so clients on different nodes see
different states.

**Required: every Yjs update must be broadcast to all nodes for the same board.**

```
Client A (on Node 1) ──write──▶ Node 1 applies to local Y.Doc
                                  │
                                  ▼
                          PUBLISH "room:{boardId}" on Redis
                                  │
                          ┌───────┴───────┐
                          ▼               ▼
                        Node 1          Node 2
                  (skip; own msg)   applies to local Y.Doc
                                    broadcasts to its clients
```

Implementation using Bun's Redis client:

```ts
// room-sync.ts
const pub = new Redis(process.env.REDIS_URL);
const sub = new Redis(process.env.REDIS_URL);

export async function broadcastUpdate(
  boardId: string,
  update: Uint8Array,
  sourceNodeId: string,
) {
  await pub.publish(
    `room:${boardId}`,
    JSON.stringify({
      nodeId: sourceNodeId,
      update: Buffer.from(update).toString("base64"),
    }),
  );
}

sub.subscribe("room:*"); // pattern subscribe
sub.on("pmessage", (_pattern, channel, raw) => {
  const { nodeId, update } = JSON.parse(raw);
  if (nodeId === LOCAL_NODE_ID) return; // skip own broadcasts
  const boardId = channel.replace("room:", "");
  const room = rooms.get(boardId);
  if (!room) return; // no local clients for this board; ignore
  Y.applyUpdate(room.doc, Buffer.from(update, "base64"));
  room.broadcastToLocalClients(update);
});
```

**Startup state sync:** when Node 2 receives its first client for a board already active on
Node 1, Node 2 must initialise its `Y.Doc` from the database (latest snapshot + subsequent
`yjs_updates` rows) — **not** from Redis, which is ephemeral. Redis is the _incremental update
bus_, not the source of truth. This is already implied by §5c but must be explicit.

**Consequence for the job queue:** with Redis now a hard dependency for multi-node operation,
revisit the Phase 1 decision to use Postgres-only. Add Redis to Phase 1; the pub/sub bus and
the rate-limit store (§12i in v3) share the same Redis instance.

### 3f. 🆕 Health check endpoints

Every HTTP server must expose two endpoints for orchestration and load-balancer integration:

```ts
// GET /healthz — liveness probe
// Returns 200 if the process is alive. Never checks external dependencies.
server.get("/healthz", () => new Response("ok", { status: 200 }));

// GET /readyz — readiness probe
// Returns 200 only if the process is ready to serve traffic.
// Returns 503 if DB or Redis are unreachable.
server.get("/readyz", async () => {
  try {
    await db.execute(sql`SELECT 1`);
    await redis.ping();
    return new Response("ok", { status: 200 });
  } catch (err) {
    log.error({ err }, "readiness check failed");
    return new Response("not ready", { status: 503 });
  }
});
```

- Liveness (`/healthz`) is called by the orchestrator to decide whether to restart the container.
  It must never fail due to an external dependency — a slow DB doesn't mean the process needs
  to be killed.
- Readiness (`/readyz`) is called to decide whether to route traffic. During startup (before
  migrations complete, before the DB pool is warm) it returns 503.
- Add a startup probe in Docker Compose / Kubernetes with an initial delay of 5 s to avoid
  killing a container that's still running migrations.

### 3g. 🆕 Structured logging

Without structured logs, correlating a security incident across WebSocket connections,
job queue workers, and HTTP requests is manual and error-prone.

**Use `pino` (or Bun's native logger if mature) with a fixed log schema:**

```ts
// lib/logger.ts
import pino from "pino";

export const log = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "meko-api", version: process.env.APP_VERSION },
  // Redact sensitive fields before they reach the log sink
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "body.password",
    "body.token",
  ],
});

// Every request context must carry: requestId, userId, workspaceId, boardId
// Attach via AsyncLocalStorage so child loggers inherit context automatically
```

Every log line must include:

| Field         | Example                                                      |
| ------------- | ------------------------------------------------------------ |
| `requestId`   | `"req_01j..."` (nanoid, propagated as `X-Request-ID` header) |
| `userId`      | UUID or `null` for anonymous                                 |
| `workspaceId` | UUID or `null`                                               |
| `boardId`     | UUID or `null`                                               |
| `action`      | `"ws.update"`, `"job.claimed"`, `"auth.refresh"`             |
| `durationMs`  | numeric                                                      |
| `status`      | HTTP status or `"ok"` / `"error"`                            |

**Security events that must always be logged at `warn` or above:**

- Rate limit hit
- CSRF rejection
- JWT validation failure (with reason: expired/invalid/wrong-issuer)
- Refresh token reuse detected (family invalidated)
- SSRF block
- Permission denied (with role, action, resource)
- Export token issued / used

---

## 4. Element types (v4 additions)

### 4d. 🆕 `javascript:` and `data:` scheme injection

v3 §4b closes the `style` JSONB with regex-validated hex colours. It does not close the
`url` / `href` field on link, file, and embed elements.

A `javascript:alert(1)` stored as an element URL and clicked by another user is stored XSS.

**Validate all URL fields with an allowlist of safe schemes:**

```ts
const SafeUrl = z
  .string()
  .url()
  .refine(
    (u) => {
      const scheme = new URL(u).protocol;
      return ["http:", "https:"].includes(scheme);
    },
    { message: "Only http and https URLs are allowed" },
  );

// Apply to: link.url, embed.src, file.downloadUrl, unfurl.url
```

Additionally, when rendering link elements in the canvas, always set
`rel="noopener noreferrer"` and never render `href` as a raw HTML attribute without
going through the same Zod schema first.

### 4e. 🆕 Yjs document size limit

No maximum Yjs document size is specified. A board with millions of text/image elements
(or a malicious client sending many large updates) will exhaust server memory because
`Y.Doc` is fully in-memory.

Add a size gate before applying any inbound update:

```ts
const MAX_YJS_DOC_BYTES = 50 * 1024 * 1024; // 50 MB per board

// After applying the update to a scratch doc copy (to get the projected size):
const projectedSize = Y.encodeStateAsUpdate(scratchDoc).byteLength;
if (projectedSize > MAX_YJS_DOC_BYTES) {
  ws.send(
    JSON.stringify({
      type: "error",
      code: "doc_too_large",
      message: "Board size limit reached",
    }),
  );
  return; // do not apply
}
```

Expose `MEKO_MAX_BOARD_BYTES` as a configurable env var so self-hosters can adjust to their
hardware. Log a `warn` at 80% of the limit so operators have advance notice.

---

## 5. Real-time collaboration (v4 additions)

### 5g. 🔴 WebSocket CSRF — concrete fix

v3 item D correctly identifies that double-submit CSRF does not protect the WebSocket upgrade.
A WebSocket upgrade triggered from a third-party page will carry the victim's cookies; the
`Origin` header is the only CSRF control that browsers enforce on upgrades.

**v3 never provides the fix. Here it is:**

**Step 1: Validate the `Origin` header on every WebSocket upgrade request.**

```ts
server.on("upgrade", (req, socket, head) => {
  const origin = req.headers["origin"] ?? "";
  const allowedOrigins = (process.env.MEKO_ALLOWED_ORIGINS ?? "").split(",");

  if (!allowedOrigins.includes(origin)) {
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return;
  }
  // proceed to upgrade
});
```

Set `MEKO_ALLOWED_ORIGINS=https://meko.example.com` in production.
For self-hosted instances, the installer writes this value at setup time.

**Step 2: Replace `?token=` with a short-lived single-use WS ticket.**

The current design passes the JWT in the URL query string, which appears in server logs
and in browser history. Use a ticket exchange instead:

```
1. Client (already authenticated) calls:
   POST /api/ws-ticket  →  { ticket: "random-32-bytes-hex", expiresIn: 10 }
   Server stores (ticket → userId) in Redis with TTL = 10 s.

2. Client opens WebSocket:
   ws://host/boards/{boardId}  (no token in URL)

3. Client sends first message:
   { type: "auth", ticket: "..." }

4. Server redeems ticket from Redis (DELETE + check TTL), gets userId,
   performs board-access check, and marks the connection authenticated.
   If no auth message arrives within 5 s, close the connection.
```

This also removes the need for the `Sec-WebSocket-Protocol` token hack (not supported in
all environments) and works correctly behind all reverse proxies.

### 5h. 🆕 Yjs time-based compaction

v3 §5c fires compaction only on `last-client-leave`. Boards that always have at least one
connected client (e.g. a team's main board open in a persistent tab) accumulate `yjs_updates`
rows indefinitely.

Add a scheduled compaction pass that runs every hour regardless of room state:

```ts
// Compact any board whose yjs_updates row count exceeds 500
// or whose oldest update is > 1 hour old, regardless of connected clients.
async function periodicCompaction() {
  const staleBoards = await db.execute(sql`
    SELECT board_id, COUNT(*) as update_count
    FROM yjs_updates
    GROUP BY board_id
    HAVING COUNT(*) > 500
       OR MIN(created_at) < now() - interval '1 hour'
  `);
  for (const { board_id } of staleBoards.rows) {
    await enqueueCompaction(board_id); // uses the advisory-locked compaction from §5c
  }
}

setInterval(periodicCompaction, 60 * 60 * 1000); // every hour
```

This bounds `yjs_updates` table growth regardless of room activity.

### 5i. 🆕 yjs_snapshots retention

v3 §5c says "keep only the N most recent snapshots per board via a trigger or post-compaction
cleanup" but never implements it. Here is the post-compaction cleanup:

```ts
// After INSERT INTO yjs_snapshots succeeds in the compaction transaction:
await tx.execute(sql`
  DELETE FROM yjs_snapshots
  WHERE board_id = ${boardId}
    AND id NOT IN (
      SELECT id FROM yjs_snapshots
      WHERE board_id = ${boardId}
      ORDER BY id DESC
      LIMIT 3
    )
`);
```

Keep the 3 most recent snapshots per board (configurable via `MEKO_SNAPSHOT_RETENTION`).
The oldest snapshot is the fallback if the latest is corrupt — having exactly 1 snapshot
per board (the old PRIMARY KEY design) provided no fallback.

---

## 6. Media pipeline (v4 additions)

### 6e. 🆕 SVG transcoding at upload time

v3 §6d and Phase plan item 4 say: "SVG option (a): always `<img>`, never inline."

This is not fully safe. In browsers where the SVG origin matches the server's origin
(the common case for self-hosted deployments), SVG loaded via `<img>` **can** execute
scripts in some versions of WebKit. External SVGs fetched from third-party URLs in link
elements can trigger SSRF on redirect.

**Required: transcode SVG → rasterised PNG on upload for display purposes.**

```
Upload pipeline:
  SVG file uploaded → MIME-type check (image/svg+xml allowed)
                    → Sharp: rasterise to PNG at 2x resolution (retina)
                    → Store PNG as the "display" derivative
                    → Store original SVG separately for "download original" only
                    → Element's `src` always resolves to the PNG derivative
```

The original SVG is stored but only accessible via a download-only presigned URL that
requires board-edit permission, not board-view permission. This prevents a read-only guest
from obtaining an SVG with embedded scripts.

If lossless SVG display is a product requirement, serve SVGs in an `<iframe sandbox="allow-scripts allow-same-origin">` with a `Content-Security-Policy: default-src 'none'`
response header on that iframe's origin — isolated from the main app origin.

---

## 7. Links & unfurling (v4 additions)

_(No changes to §7a–7d, all correct. One addition:)_

### 7e. 🆕 Unfurl re-validation on render

An unfurl is captured at insertion time. Between insertion and the next board open (potentially
days later), the URL's resolved IP may have changed due to DNS TTL rotation — the classic
DNS rebinding attack vector at read time rather than write time.

**Fix:** Store the resolved IP at unfurl time alongside the unfurl result. On board load, do
not re-resolve, but if the URL is later re-unfurled (manual refresh), re-apply `ssrfSafeUrl`
against the current DNS resolution.

Additionally, never store `file://`, `ftp://`, or any scheme other than `http:` and `https:` in
the `unfurl_url` column — apply the `SafeUrl` validator (§4d) at the DB write path, not just
at the API entry point.

---

## 8. Exports (v4 additions)

### 8b. 🆕 Chromium sidecar isolation

The Chromium export sidecar is a high-risk component: it renders arbitrary board content
(user-supplied images, text, links) in a real browser context. Without isolation:

- A malicious board element (SVG, link, embed) could cause Chromium to make requests to
  internal services (Postgres, Redis, internal API routes, EC2 metadata endpoints).
- Chromium running as root in Docker can escape the container via kernel exploits more easily.

**Required mitigations:**

1. **Run Chromium as a non-root user:**

```dockerfile
# export-sidecar/Dockerfile
RUN groupadd -r chromium && useradd -r -g chromium -G audio,video chromium \
    && mkdir -p /home/chromium && chown -R chromium:chromium /home/chromium
USER chromium
```

2. **Restrict Chromium's outbound network to the internal API only:**

```yaml
# docker-compose.yml
export-sidecar:
  networks:
    - export-internal # can reach meko-api only
  # NOT on the db or redis network
```

3. **The export renderer must only access one internal endpoint:**
   `GET /api/internal/export-render/{jobId}` — pre-fetches all board data server-side and
   returns a self-contained HTML document. Chromium never calls S3, Postgres, or Redis
   directly. All data passes through the API's permission check.

4. **Set Chromium's `--host-rules` flag to block all non-API hosts:**

```ts
const browser = await puppeteer.launch({
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    `--host-rules=MAP * 0.0.0.0, EXCLUDE meko-api`, // block all except meko-api
    "--disable-dev-shm-usage",
  ],
});
```

---

## 9. Sharing, permissions, auth (v4 additions)

### 9g. 🔴 Client-side token storage

v3 specifies the refresh token _server-side_ schema but says nothing about where tokens live
on the client. This is the most common source of token theft.

**Required:**

| Token                                  | Client storage                                  | Rationale                                                             |
| -------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------- |
| Access token (short-lived JWT, 15 min) | JavaScript memory only (module-scoped variable) | Never in `localStorage` or `sessionStorage` — both are XSS-accessible |
| Refresh token (long-lived, opaque)     | `HttpOnly; Secure; SameSite=Strict` cookie      | Inaccessible to JavaScript; survives page reload                      |

```ts
// auth/tokens.ts — access token lives in module scope only
let _accessToken: string | null = null;

export function setAccessToken(token: string) {
  _accessToken = token;
}
export function getAccessToken() {
  return _accessToken;
}
export function clearAccessToken() {
  _accessToken = null;
}

// On page load: call POST /api/auth/refresh automatically
// (the HttpOnly cookie is sent automatically by the browser)
// If it succeeds, populate _accessToken in memory.
// If it fails (no cookie, expired), redirect to /login.
```

The `POST /api/auth/refresh` endpoint must:

- Read the refresh token from the `HttpOnly` cookie (never from the request body or a header).
- Issue a new access token in the response body.
- Issue a new refresh token by **rotating** the cookie (new `Set-Cookie`).
- Rotation must happen on **every** valid refresh call — not only on reuse detection.
  Rotating on every use means a stolen token can only be used once before it's
  invalidated by the legitimate user's next refresh.

### 9h. 🆕 Refresh token rotation on every valid use

v3 §9e specifies rotation only on reuse detection (when `used_at` is already set).
This leaves a window: a stolen token is valid until the legitimate user happens to refresh.
That window can be days for users who don't close their browser.

**Rotate on every valid refresh:**

```ts
async function handleRefresh(rawToken: string, db: Db) {
  const hash = sha256(rawToken);
  const record = await db.query.refreshTokens.findFirst({
    where: eq(refreshTokens.tokenHash, hash),
  });

  if (!record || record.revokedAt || record.expiresAt < new Date()) {
    throw new AuthError("INVALID_REFRESH_TOKEN");
  }

  if (record.usedAt) {
    // Reuse detected: invalidate entire family
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.familyId, record.familyId));
    throw new AuthError("TOKEN_REUSE_FAMILY_REVOKED");
  }

  // Mark current token as used
  await db
    .update(refreshTokens)
    .set({ usedAt: new Date() })
    .where(eq(refreshTokens.id, record.id));

  // Issue a new token in the same family (rotation)
  const newRawToken = crypto.randomBytes(32).toString("hex");
  await db.insert(refreshTokens).values({
    familyId: record.familyId,
    userId: record.userId,
    tokenHash: sha256(newRawToken),
    deviceHint: record.deviceHint,
    ipHint: record.ipHint,
    expiresAt: addDays(new Date(), 30),
  });

  return { newRawToken, userId: record.userId };
}
```

The new token is set as a `Set-Cookie: refresh_token=...; HttpOnly; Secure; SameSite=Strict; Path=/api/auth; Max-Age=2592000` response header — `Path=/api/auth` limits the cookie to the auth endpoints, reducing its attack surface.

---

## 11. Self-hosting & deployment (v4 additions)

### 11b. 🆕 TLS / HTTPS enforcement

No TLS termination strategy is specified. HTTP in production means tokens, cookies, and
Yjs updates are transmitted in plaintext.

**Recommended: nginx reverse proxy with TLS termination as a compose sidecar.**

```yaml
# docker-compose.yml (production)
nginx:
  image: nginx:alpine
  volumes:
    - ./nginx.conf:/etc/nginx/nginx.conf:ro
    - ./certs:/etc/nginx/certs:ro # or certbot/acme.sh volume
  ports:
    - "80:80"
    - "443:443"
  depends_on: [app]
```

```nginx
# nginx.conf
server {
  listen 80;
  return 301 https://$host$request_uri;  # hard redirect, no downgrade
}

server {
  listen 443 ssl http2;
  ssl_certificate     /etc/nginx/certs/fullchain.pem;
  ssl_certificate_key /etc/nginx/certs/privkey.pem;
  ssl_protocols TLSv1.2 TLSv1.3;
  ssl_prefer_server_ciphers on;
  add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;

  location /  { proxy_pass http://app:3000; }
  location /ws { proxy_pass http://app:3000; proxy_http_version 1.1;
                 proxy_set_header Upgrade $http_upgrade;
                 proxy_set_header Connection "Upgrade"; }
}
```

For cloud deployments, TLS is terminated at the load balancer (ALB/Cloudflare). In that case,
add `X-Forwarded-Proto: https` trust and ensure the app responds with `HSTS` only when the
original request was HTTPS (check `req.headers["x-forwarded-proto"] === "https"`).

For self-hosters without a domain: ship an `mkcert`-based dev TLS option and document it.
The installer should warn loudly if `MEKO_BASE_URL` starts with `http://` in a non-localhost context.

### 11c. 🆕 Database backup strategy

Self-hosted deployments have no backup unless explicitly configured. A single corrupt Postgres
volume means permanent data loss.

**Ship a backup compose service using `pg_dump`:**

```yaml
# docker-compose.yml
pg-backup:
  image: postgres:16-alpine
  entrypoint: >
    sh -c "while true; do
      PGPASSWORD=$$POSTGRES_PASSWORD pg_dump -h db -U meko meko
        | gzip > /backups/meko_$$(date +%Y%m%d_%H%M%S).sql.gz
      && find /backups -name '*.sql.gz' -mtime +7 -delete;
      sleep 86400;
    done"
  environment:
    POSTGRES_PASSWORD_FILE: /run/secrets/postgres_password
  volumes:
    - ./backups:/backups
  secrets:
    - postgres_password
  depends_on: [db]
```

Document a restore procedure in `docs/restore.md`. Add a `make restore BACKUP=<file>` target.

For cloud deployments, use RDS automated snapshots (daily + point-in-time recovery) or
a managed backup service. Document the RPO/RTO target in the architecture doc.

---

## 12. Security hardening (v4 additions)

### 12j. 🆕 Security response headers

No security headers are specified anywhere. Add a middleware that sets all of these on every
HTTP response:

```ts
// middleware/security-headers.ts
export function securityHeaders(res: Response): Response {
  const headers = new Headers(res.headers);

  // Prevent MIME-type sniffing
  headers.set("X-Content-Type-Options", "nosniff");

  // Prevent embedding in iframes (clickjacking)
  headers.set("X-Frame-Options", "DENY");

  // Force HTTPS (only set when serving over TLS)
  headers.set(
    "Strict-Transport-Security",
    "max-age=63072000; includeSubDomains; preload",
  );

  // Limit referrer leakage (prevents board IDs leaking via Referer)
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  // Disable browser features not needed by the app
  headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=()",
  );

  // Content Security Policy — see §12k
  headers.set("Content-Security-Policy", buildCsp());

  return new Response(res.body, { status: res.status, headers });
}
```

### 12k. 🆕 Content Security Policy

No CSP header is defined. XSS on a canvas app that renders user-supplied content (text,
images, link embeds) is catastrophic: an attacker can exfiltrate all board data, impersonate
the user, and pivot to other boards the user can access.

**Strict CSP for the main application:**

```
Content-Security-Policy:
  default-src 'none';
  script-src 'self' 'nonce-{per-request-nonce}';
  style-src 'self' 'unsafe-inline';    ← canvas needs inline styles; mitigated by §4b
  img-src 'self' data: blob: https:;  ← blob: for canvas toDataURL()
  font-src 'self';
  connect-src 'self' wss://meko.example.com;
  media-src 'self' blob:;
  worker-src 'self' blob:;
  frame-src 'none';
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  upgrade-insecure-requests;
```

Key decisions:

- `script-src 'nonce-{nonce}'` instead of `'unsafe-inline'` — every `<script>` tag must carry
  a matching nonce generated fresh per request.
- `'unsafe-eval'` is intentionally **absent** — if Yjs or the renderer requires eval, use
  a build step to pre-compile it away. eval-based gadgets are a common XSS escalation path.
- `frame-src 'none'` — no iframes except the SVG sandbox (§6e), which runs on a separate
  subdomain (`sandbox.meko.example.com`) with its own, more restrictive CSP.
- Start with `Content-Security-Policy-Report-Only` in staging, send violation reports to
  `/api/csp-report`, and graduate to enforced CSP only after a week with zero violations.

### 12l. 🆕 CORS policy

No CORS configuration is specified. Bun/Hono/Express default behaviors differ; without an
explicit policy, preflight rejections and credential-carrying cross-origin requests may be
silently allowed.

```ts
// middleware/cors.ts
const ALLOWED_ORIGINS = new Set(
  (process.env.MEKO_ALLOWED_ORIGINS ?? "").split(",").filter(Boolean),
);

export function corsMiddleware(req: Request): Headers {
  const origin = req.headers.get("origin") ?? "";
  const headers = new Headers();

  if (ALLOWED_ORIGINS.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true"); // required for cookie-based auth
    headers.set("Vary", "Origin"); // must vary on Origin to avoid cache poisoning
  }
  // Never set Access-Control-Allow-Origin: * when credentials are involved

  headers.set(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  );
  headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, X-Request-ID, Idempotency-Key",
  );
  headers.set("Access-Control-Max-Age", "86400");

  return headers;
}
```

**Never use `Access-Control-Allow-Origin: *` with `Access-Control-Allow-Credentials: true`.**
Browsers block this combination, but a misconfigured proxy or CDN that rewrites the header can
silently re-enable it. Be explicit.

### 12m. 🆕 Rate limiting by user ID on authenticated routes

v3 §12a and §12i specify IP-based rate limiting. IP-based limiting is trivially evaded by
attackers using rotating IPs (cloud functions, residential proxies). For authenticated routes,
the user ID is a better rate-limit key because it cannot be rotated without account creation.

**Use compound keys:**

```ts
// For authenticated routes: rate-limit on userId + route
const authKey = `rl:user:${userId}:${routeGroup}`;
// For unauthenticated routes (login, signup): rate-limit on IP
const anonKey = `rl:ip:${ip}:${routeGroup}`;
```

Apply the sliding window (v3 §12a) per `authKey` with a looser limit (e.g. 600 req/min for
normal API traffic) and a tighter limit on sensitive operations (e.g. 5 export requests/hour
per user, 10 invite emails/day per user).

**Specific high-value rate limits to add:**

| Route group                | Key           | Limit        |
| -------------------------- | ------------- | ------------ |
| `POST /api/auth/*`         | IP            | 10 req/min   |
| `POST /api/exports`        | userId        | 5 req/hour   |
| `POST /api/uploads`        | userId        | 50 req/hour  |
| `POST /api/invites`        | userId        | 20 req/day   |
| `GET /api/*/export-render` | internal only | IP allowlist |

### 12n. 🆕 Job dead-letter queue

v3 §12f specifies a `max_attempts` field but never specifies what happens when a job exhausts
all attempts. Failed jobs accumulate silently; operators have no visibility.

**Add a dead-letter queue via a status column + alerting:**

```sql
-- Extend the jobs table status enum:
-- pending | running | done | failed | dead
-- 'dead' = exhausted all attempts, needs operator attention
```

```ts
// Worker, on job failure:
if (job.attempts >= job.maxAttempts) {
  await db
    .update(jobs)
    .set({ status: "dead", error: err.message, updatedAt: new Date() })
    .where(eq(jobs.id, job.id));
  // Alert: emit a metric or write to a `dead_letter_alerts` table
  // that the ops dashboard polls
  log.error(
    { jobId: job.id, type: job.type, error: err.message },
    "Job dead-lettered",
  );
} else {
  // exponential backoff requeue
  const backoff = Math.min(30, 2 ** job.attempts) * 1000;
  await db
    .update(jobs)
    .set({
      status: "pending",
      claimedAt: null,
      claimExpiresAt: null,
      attempts: job.attempts + 1,
      updatedAt: new Date(),
    })
    .where(eq(jobs.id, job.id));
  await sleep(backoff);
}
```

Expose `/api/internal/jobs/dead` (internal only, no public access) for the ops dashboard.
Add a Prometheus gauge `meko_dead_jobs_total{type}` and alert if it exceeds 0 for export or
audit job types.

### 12o. 🆕 Job queue `SKIP LOCKED`

v3 §12f's jobs table is claimed by workers using a query equivalent to:

```sql
SELECT * FROM jobs WHERE status = 'pending' ORDER BY priority DESC, created_at
LIMIT 1 FOR UPDATE;
```

Without `SKIP LOCKED`, all workers block waiting for each other on the same row, serialising
all job claims. Under any meaningful load this becomes a queue bottleneck.

**Fix:**

```sql
SELECT * FROM jobs
WHERE status = 'pending'
ORDER BY priority DESC, created_at
LIMIT 1
FOR UPDATE SKIP LOCKED;  -- ← this line is load-bearing
```

`SKIP LOCKED` causes each worker to skip rows already locked by another worker and claim the
next available one. Workers no longer block each other. This is the standard pattern for
Postgres-based job queues (used by Que, Delayed::Job, etc.).

Also add the claim as an atomic UPDATE to avoid the SELECT + UPDATE two-step:

```sql
UPDATE jobs
SET status = 'running',
    claimed_at = now(),
    claim_expires_at = now() + interval '5 minutes',
    attempts = attempts + 1
WHERE id = (
  SELECT id FROM jobs
  WHERE status = 'pending'
  ORDER BY priority DESC, created_at
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
RETURNING *;
```

### 12p. 🆕 Global API request timeout

Without a request timeout, a slow query (e.g. a pathological Yjs merge against a huge
`yjs_updates` set) holds a DB connection open until the client gives up. Under load, this
exhausts the PgBouncer pool and cascades into a full outage.

```ts
// Apply to every route handler:
const ROUTE_TIMEOUT_MS = 30_000;

export function withTimeout<T>(fn: () => Promise<T>): Promise<T> {
  return Promise.race([
    fn(),
    sleep(ROUTE_TIMEOUT_MS).then(() => {
      throw new ApiError(503, "REQUEST_TIMEOUT", "Request took too long");
    }),
  ]);
}
```

Set per-route timeouts where appropriate:

- Standard API routes: 10 s
- Export job start: 30 s
- Media upload pre-sign: 5 s
- `/readyz`: 3 s

Also configure nginx's `proxy_read_timeout` to be slightly higher than the app's internal
timeout (e.g. 35 s) so the API can return a clean error response rather than nginx returning
a 502.

---

## 13. Database tuning (new section)

### 13a. 🆕 Autovacuum tuning for high-churn tables

Postgres autovacuum fires when dead tuple ratio exceeds `autovacuum_vacuum_scale_factor` (default: 20%).
For a `jobs` table with 1 M rows, this means 200 K dead tuples accumulate before vacuum runs.
High UPDATE/DELETE rates on `jobs`, `yjs_updates`, and `refresh_tokens` will cause table bloat
and index bloat that degrades query performance.

**Override autovacuum settings on these tables specifically:**

```sql
-- Apply to each high-churn table
ALTER TABLE jobs SET (
  autovacuum_vacuum_scale_factor = 0.01,    -- 1% (vs 20% default)
  autovacuum_analyze_scale_factor = 0.01,
  autovacuum_vacuum_cost_delay = 2           -- ms; faster vacuum at cost of I/O
);

ALTER TABLE yjs_updates SET (
  autovacuum_vacuum_scale_factor = 0.01,
  autovacuum_analyze_scale_factor = 0.01
);

ALTER TABLE refresh_tokens SET (
  autovacuum_vacuum_scale_factor = 0.02
);
```

Monitor with:

```sql
SELECT relname, n_dead_tup, n_live_tup,
       round(n_dead_tup::numeric / NULLIF(n_live_tup,0) * 100, 1) AS dead_pct,
       last_autovacuum
FROM pg_stat_user_tables
WHERE relname IN ('jobs', 'yjs_updates', 'refresh_tokens', 'audit_log')
ORDER BY dead_pct DESC;
```

Alert if `dead_pct > 10` for any of these tables.

### 13b. 🆕 Index completeness audit

The following indexes are implied by query patterns but not explicitly specified in v2 or v3:

```sql
-- Board list by workspace (GET /api/workspaces/:id/boards)
CREATE INDEX ON boards (workspace_id, updated_at DESC);

-- Member lookup by workspace + user (permission check hot path)
CREATE INDEX ON members (workspace_id, user_id);

-- Board-level permission lookup
CREATE INDEX ON board_permissions (board_id, user_id);

-- Comment list (GET /api/boards/:id/comments)
CREATE INDEX ON comments (board_id, created_at DESC);

-- Audit log by workspace + time range
CREATE INDEX ON audit_log (workspace_id, created_at DESC);

-- Refresh token cleanup (expired tokens)
CREATE INDEX ON refresh_tokens (expires_at) WHERE revoked_at IS NULL;

-- Idempotency key cleanup (expired keys)
CREATE INDEX ON idempotency_keys (expires_at);

-- Jobs reaper (find expired claims)
-- Already specified in v3: CREATE INDEX ON jobs (claim_expires_at) WHERE status = 'running';
-- Add covering index for the worker claim query:
CREATE INDEX ON jobs (priority DESC, created_at) WHERE status = 'pending';
```

Add all indexes in migration files, and add a comment explaining the query they serve.

### 13c. 🆕 Cursor-based pagination for list endpoints

No pagination strategy is specified. Without it, `GET /api/workspaces/:id/boards` returns all
boards for a large workspace in one query, which can be thousands of rows.

**Use cursor-based pagination everywhere (not offset/limit):**

```ts
// Query pattern (boards example):
const boards = await db.query.boards.findMany({
  where: and(
    eq(boards.workspaceId, workspaceId),
    cursor ? lt(boards.updatedAt, cursor) : undefined  // cursor is the last seen updatedAt
  ),
  orderBy: desc(boards.updatedAt),
  limit: 50,
});

// Response:
{
  data: [...boards],
  nextCursor: boards.length === 50
    ? boards[boards.length - 1].updatedAt.toISOString()
    : null
}
```

Apply to: boards list, elements list (for non-realtime access), comments, audit log,
members list, shared links list, job list (ops).

**Never use `OFFSET` for pagination.** Offset pagination requires a full index scan to the
offset position and produces inconsistent results under concurrent writes.

---

## 14. Testing strategy (v4 additions)

### 14d. 🆕 Multi-node integration tests

v3's testing strategy covers single-node correctness. Multi-node Yjs divergence (§3e) is
the class of bug least likely to be caught by unit tests.

Add a multi-node integration test suite that spins up two WS server instances sharing Redis
and Postgres:

```ts
// test/multi-node.test.ts
it("updates converge across two nodes", async () => {
  const [node1, node2] = await startTestNodes(2);
  const client1 = await connectToBoard(node1, boardId);
  const client2 = await connectToBoard(node2, boardId); // different node

  await client1.sendUpdate({ type: "note", text: "hello" });
  await waitForPropagation(); // wait for Redis pub/sub delivery

  const state2 = await client2.getDocState();
  expect(state2).toContain("hello"); // Node 2 must see Node 1's update
});
```

Also test:

- Client on Node 1 disconnects → reconnects to Node 2 → converges to same state.
- Node 1 restarts mid-edit → clients reconnect to Node 2 → no data loss.

### 14e. 🆕 Performance regression tests

Add a lightweight performance benchmark that runs in CI to catch regressions before they ship:

- WS message throughput: 1 client, 100 updates/s sustained for 10 s → p95 latency < 50 ms.
- Board load (reconnect): join a board with 10 K elements → state sync in < 2 s.
- Job queue throughput: 1000 `thumb` jobs enqueued + processed → complete in < 60 s.

Use `k6` or a custom Bun benchmark script. Fail the CI step if any metric regresses by >20%
from the baseline stored in the repo.

---

## 15. Phase plan (v4 revision)

Changes from v3: Redis added to Phase 1 (required for multi-node); security headers and
CSP in Phase 2; pagination in Phase 2; backup in Phase 3.

1. **Collab spike.** All of v3 Phase 1, plus: **Redis for pub/sub (§3e)**, **WS ticket
   exchange (§5g)**, **Yjs document size limit (§4e)**, **`SKIP LOCKED` in job worker (§12o)**.
   Prove multi-node convergence from day one with the §14d integration test.

2. **Canvas core + element model.** All of v3 Phase 2, plus: **`javascript:` scheme guard
   (§4d)**, **security headers middleware (§12j)**, **CSP Report-Only (§12k)**, **CORS policy
   (§12l)**, **global request timeout (§12p)**, **health check endpoints (§3f)**,
   **structured logging (§3g)**, **cursor-based pagination (§13c)**, **index migrations (§13b)**.

3. **Auth hardening.** All of v3 Phase 3, plus: **client-side token storage spec (§9g)**,
   **rotate refresh token on every valid use (§9h)**, **refresh token cookie `Secure; Path=`
   flags**, **rate limiting by user ID (§12m)**, **TLS/nginx config (§11b)**, **autovacuum
   tuning (§13a)**. Promote CSP to enforced (§12k).

4. **Media.** All of v3 Phase 4, plus: **SVG transcoding to PNG (§6e)**, presigned URL proxy
   routing (v3 §6d).

5. **Links & rich elements.** All of v3 Phase 5, plus: **unfurl re-validation strategy (§7e)**.

6. **Sharing & permissions.** All of v3 Phase 6, plus: **DB backup service (§11c)**,
   **dead-letter queue + alerting (§12n)**, **idempotency key cleanup job (v3 open question)**.

7. **Exports.** All of v3 Phase 7, plus: **Chromium non-root + network isolation (§8b)**,
   **export sidecar network policy**.

8. **Polish.** All of v3 Phase 8, plus: **multi-node integration tests (§14d)**, **performance
   regression benchmarks (§14e)**, **yjs time-based compaction (§5h)**, **snapshot retention
   logic (§5i)**.

---

## 16. Open questions (v4 additions)

Carrying v3's open questions unchanged. New:

- **Redis persistence model:** Should Redis be configured with `appendonly yes` (AOF)? Redis
  is used for pub/sub (ephemeral is fine) and for the WS ticket store (TTL 10 s, loss is
  acceptable — client retries). For the rate-limit store, Redis restart clears all counters,
  which is acceptable. AOF is unnecessary — Redis can be `--save ""` (no persistence) and
  the system degrades gracefully. Document this explicitly.

- **Multi-node Yjs: who runs compaction?** When 5 nodes are running, all 5 may observe the
  periodic compaction trigger (§5h) at the same time. The advisory lock (v3 §5c) handles this
  correctly — only one wins. But all 5 still wake up and attempt `pg_try_advisory_xact_lock`.
  At scale, this is noisy. Consider: elect one "compaction leader" node (lowest pod ordinal in
  K8s, or a Redis-based lease) to run the periodic compaction scheduler.

- **CSP and `unsafe-inline` for styles:** The canvas renderer applies inline styles heavily
  (element position, size, color). Eliminating `'unsafe-inline'` from `style-src` requires
  migrating to CSS custom properties or a CSS-in-JS approach that generates `<style>` tags
  with a nonce. Evaluate at Phase 2; defer the migration if it blocks the milestone.

- **Audit log partitioning:** For large workspaces, `audit_log` will have millions of rows
  within months. Postgres table partitioning by `created_at` (monthly range partitions) + a
  partition pruning strategy (drop partitions older than `MEKO_AUDIT_RETENTION_DAYS`) is more
  efficient than a nightly `DELETE`. Evaluate at Phase 6.

---

## Learnings carried forward (v4 additions)

- **PgBouncer transaction mode silently breaks session-level advisory locks.** Every use of
  `pg_advisory_lock` must be audited against whether it runs through PgBouncer. Use
  `pg_try_advisory_xact_lock` wherever possible; use a direct connection as a last resort.
- **WebSocket auth must not rely on URL parameters.** Tokens in URLs appear in logs, browser
  history, and proxy access logs. Use the ticket exchange pattern (§5g).
- **Rotate refresh tokens on every use, not just on reuse.** Reuse detection alone leaves a
  theft window. Rotation-on-every-use closes it.
- **Multi-node state synchronisation must be designed upfront.** Adding Redis pub/sub after
  the fact requires touching every room, every persistence path, and every reconnect handler.
  It is not an incremental addition — it is a rewrite.
- **Security headers are not optional polish.** CSP, HSTS, and CORS policies belong in Phase 1
  or 2, not in a "hardening" phase after launch. Retrofitting CSP is painful because it
  surfaces every inline script, every CDN asset, and every eval call at once.
- **Job queues need `SKIP LOCKED`.** Without it, worker concurrency provides no throughput
  benefit; all workers queue-jump for the same row. This is one line of SQL and must be in
  the initial implementation.
