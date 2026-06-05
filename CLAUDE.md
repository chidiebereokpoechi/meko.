# CLAUDE.md

Guidance for Claude Code (and humans) working in this repo.

## What Meko is

Meko is a self-hostable **realtime collaborative canvas** (think whiteboard / infinite
canvas with notes, images, links, embeds). Multiple users edit the same board live; state
is a Yjs CRDT persisted to Postgres. It must run correctly across **multiple WebSocket
nodes** behind a load balancer.

The authoritative design lives in [meko-plan-v4.md](meko-plan-v4.md). v4 is a set of
annotations/corrections layered on an earlier v3 plan (v3 text not in this repo). When the
two would conflict, **v4 wins**. Section references below (e.g. §3e) point into v4.

## Stack

| Concern        | Choice                                                        |
|----------------|---------------------------------------------------------------|
| Runtime        | **Bun** (TypeScript, ESM, `.ts` imports)                      |
| HTTP + WS      | **Elysia** (Bun-native; `.ws()` carries the Yjs socket)       |
| Realtime       | **Yjs** over native WebSocket, multi-node via Redis pub/sub   |
| DB             | **Postgres 16** via **Drizzle ORM**, pooled by **PgBouncer**  |
| Cache/bus      | **Redis** (ioredis) — pub/sub, WS tickets, rate-limit store   |
| Validation     | **Zod**                                                       |
| Logging        | **pino** + `AsyncLocalStorage` request context               |
| Media          | S3-compatible object store, Sharp for transcode (Phase 4)     |
| Export         | Chromium sidecar (Puppeteer), network-isolated (Phase 7)      |
| TLS            | nginx reverse proxy sidecar                                   |

## Layout

```
src/
  index.ts            Elysia app: HTTP routes + .ws("/boards/:id") (origin check + ticket auth)
  config.ts           env parsing (Zod), single source of truth
  db/
    schema.ts         Drizzle tables + indexes + autovacuum overrides
    client.ts         pooled (DATABASE_URL) + direct (POSTGRES_DIRECT_URL) clients
    migrate.ts        migration runner — DIRECT URL only (§3d)
  lib/
    logger.ts         pino + request-context ALS (§3g)
    redis.ts          shared ioredis connections
  http/
    middleware/       security-headers, cors, request-context, timeout (Elysia plugins/helpers)
    routes/           health, auth (+ ws-ticket), ...
  auth/
    tokens.ts         access-token-in-memory contract + refresh rotation (§9g/9h)
    ws-ticket.ts      single-use WS ticket exchange (§5g)
  realtime/
    room.ts           per-board Y.Doc + local client fanout, size gate (§4e)
    room-sync.ts      Redis pub/sub bus across nodes (§3e)
    persistence.ts    snapshot/update load + compaction + retention (§5c/5h/5i)
  worker/
    index.ts          job worker loop
    queue.ts          SKIP LOCKED claim + dead-letter + backoff (§12o/12n)
deploy/
  docker-compose.yml  db, pgbouncer, redis, app, nginx, pg-backup, export-sidecar
  nginx.conf          TLS termination + WS upgrade proxy (§11b)
```

## Non-negotiable invariants

These are the load-bearing correctness/security rules from v4. Do not regress them.

1. **Migrations & session-level locks bypass PgBouncer.** The migrator and anything using
   `pg_advisory_lock` (session-scoped) or `LISTEN/NOTIFY` must connect via
   `POSTGRES_DIRECT_URL` (db:5432), never `DATABASE_URL` (pgbouncer:6432). Transaction-scoped
   `pg_try_advisory_xact_lock` is safe through PgBouncer. (§3d/3h)
2. **Every Yjs update is broadcast to all nodes** over Redis `room:{boardId}`. A node skips
   its own messages and ignores boards it has no local clients for. Redis is the *incremental
   bus*; Postgres (snapshot + `yjs_updates`) is the source of truth. On first client for a
   board, hydrate the `Y.Doc` from the DB, never from Redis. (§3e)
3. **WebSocket auth: validate `Origin` on upgrade + single-use Redis ticket.** No JWT in the
   URL query string. Client opens WS, sends `{type:"auth",ticket}` within 5s, server redeems
   (DELETE) the ticket from Redis. (§5g)
4. **Token storage.** Access token (15min JWT) lives in client JS memory only — never
   localStorage/sessionStorage. Refresh token is an opaque value in an
   `HttpOnly; Secure; SameSite=Strict; Path=/api/auth` cookie. (§9g)
5. **Rotate the refresh token on every valid refresh**, not only on reuse detection. Reuse of
   an already-used token revokes the whole family. (§9h)
6. **Validate all URL fields** (link.url, embed.src, file.downloadUrl, unfurl.url) against an
   `http:`/`https:` allowlist at the DB write path — block `javascript:`/`data:`/`vbscript:`/
   `file:`/`ftp:`. (§4d/7e)
7. **Yjs doc size gate** before applying any inbound update; reject over `MEKO_MAX_BOARD_BYTES`
   (default 50MB), warn at 80%. (§4e)
8. **Job claim uses `FOR UPDATE SKIP LOCKED`** as a single atomic `UPDATE ... WHERE id = (SELECT
   ... SKIP LOCKED)`. Exhausted jobs go to status `dead` (dead-letter), not silent failure. (§12o/12n)
9. **Security headers + CSP + explicit CORS on every response.** Never
   `Access-Control-Allow-Origin: *` with credentials. (§12j/12k/12l)
10. **Global request timeout** so a slow query can't pin a DB connection and exhaust the pool. (§12p)

## Conventions

- Read config from `src/config.ts` only; never `process.env` elsewhere.
- All structured logs go through `lib/logger.ts`; security events (rate-limit hit, CSRF
  reject, JWT failure, token reuse, SSRF block, permission denied) log at `warn`+.
- List endpoints use **cursor-based** pagination (cursor = last seen sort key); never `OFFSET`. (§13c)
- Rate-limit authenticated routes by `userId`, unauthenticated by IP. (§12m)
- Every new high-churn table gets autovacuum overrides + the indexes that serve its hot
  queries, defined in `schema.ts`. (§13a/13b)

## Commands

```bash
bun install
cp .env.example .env          # then edit secrets
docker compose -f deploy/docker-compose.yml up -d db pgbouncer redis
bun run db:generate           # emit SQL from schema.ts
bun run db:migrate            # apply via POSTGRES_DIRECT_URL
bun run dev                   # app (HTTP + WS) with watch
bun run worker                # job worker
bun run typecheck
bun test
```

## Phase status

Building per v4 §15.

- **Phase 1 (collab spike) — done.** Redis pub/sub multi-node Yjs convergence, WS ticket
  exchange, doc size limit, `SKIP LOCKED` worker, security headers/CSP/CORS, health, logging.
- **Phase 2 (canvas core + element model) — done.** Element Zod model (`src/elements/schema.ts`,
  hex-only style §4b, http(s)-only URL fields §4d), bearer auth guard (`src/auth/middleware.ts`),
  permissions (`src/lib/permissions.ts` — workspace role + board view/edit), cursor pagination
  (`src/lib/pagination.ts` §13c), REST CRUD for workspaces/boards/comments, and the WS
  board-access check (viewers join read-only; edit-gated updates).

- **Phase 3 (auth hardening) — done.** Signup/login with argon2id passwords
  (`src/auth/password.ts`), session bootstrap (access token in body + rotating refresh cookie),
  Redis sliding-window rate limiter (`src/lib/rate-limit.ts` §12m) — `/api/auth/*` capped at
  10/min per IP. Refresh rotation-on-every-use + family revocation already in place (§9h). CSP
  is enforced (not report-only).

- **Phase 4 (media) — done.** S3-compatible storage via Bun's native `S3Client`
  (`src/lib/storage.ts`) with split internal/public endpoints — data ops over the internal host,
  presigned URLs signed for the public host (SigV4 binds the host). Upload flow: presign PUT
  (edit access + 50/hr/user) → client PUT → `complete` enqueues `process-upload`. Worker
  (`src/media/process.ts`) re-sniffs bytes (`src/media/transcode.ts`, never trusts the declared
  type), rasterises SVG→PNG and re-encodes rasters→WebP via Sharp (strips embedded scripts, §6e),
  emits display + thumbnail derivatives. `media` row tracks status; element `src` resolves to the
  display derivative; the raw original is edit-gated (a read-only guest can't fetch a scriptable SVG).

Later phases (links, sharing, exports, polish) are tracked in the plan and not yet built.
When you implement a phase item, check it against the invariant it maps to above. Authenticated
API tests can still forge an access token via `mintAccessToken`, or go through `/api/auth/signup`.
