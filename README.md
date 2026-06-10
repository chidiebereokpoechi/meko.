# meko.

Self-hostable realtime collaborative canvas. Board state is a [Yjs](https://yjs.dev) CRDT
persisted to Postgres and synchronised across multiple WebSocket nodes via Redis pub/sub.

Design: [meko-plan-v4.md](meko-plan-v4.md). Working agreement + invariants: [CLAUDE.md](CLAUDE.md).

## Status

**All v4 phases (1–8) implemented.** Frontend covers every public API endpoint (boards CRUD,
search/⌘K, sharing/invites, comments, exports, media incl. original download) — see the
"Frontend status" section in [CLAUDE.md](CLAUDE.md) for the feature inventory and the canvas
performance architecture.

1. Collab spike — multi-node Yjs over Redis pub/sub, WS ticket auth, doc size gate, Postgres
   persistence + compaction, `SKIP LOCKED` worker, security headers/CSP/CORS, health, logging.
2. Canvas core — element model (Zod), permissions, cursor pagination, board/workspace/comment CRUD.
3. Auth hardening — argon2id signup/login, refresh rotation, Redis sliding-window rate limits.
4. Media — S3/RustFS upload, SVG→PNG / raster→WebP transcode, presign, derivatives.
5. Links — SSRF-safe unfurling (per-hop re-check, metadata/private-IP block), OG parse, cache.
6. Sharing — tokenised share links, workspace invites, audit log, dead-letter ops endpoint, cleanup.
7. Exports — internal render + isolated non-root Chromium sidecar (network-locked, host-rules).
8. Polish — multi-node + persistence/retention tests, perf benchmark (`bun run bench`).

`bun test` runs the suite (live S3 + Chromium render are opt-in/skipped). `bun run bench` is the
performance regression gate.

## Repository layout

- **`api/`** — Bun + Elysia backend (HTTP + WS, workers, deploy infra). See [CLAUDE.md](CLAUDE.md).
- **`web/`** — Vite + React canvas client. See [web/DESIGN.md](web/DESIGN.md).

## Quickstart (local dev)

```bash
# --- backend ---
cd api
bun install
cp .env.example .env                      # then point at the dev ports below

# Data services on non-standard host ports (avoid clashing with a local pg/redis):
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.dev.yml up -d db pgbouncer redis
#   POSTGRES_DIRECT_URL → localhost:55432   (db, bypasses PgBouncer — migrations/session locks)
#   DATABASE_URL        → localhost:56432   (pgbouncer, app queries)
#   REDIS_URL           → localhost:56379

bun run db:generate     # emit SQL from schema.ts
bun run db:migrate      # apply via POSTGRES_DIRECT_URL + autovacuum tuning
bun run dev             # HTTP + WS on :3000
bun run worker          # job worker (compaction etc.)
bun test                # multi-node convergence

# --- frontend (separate terminal) ---
cd web && bun install && bun run dev      # http://localhost:5173
```

## Production

`api/deploy/docker-compose.yml` brings up db, pgbouncer, redis, migrate (one-shot), app, worker,
nginx (TLS termination), and pg-backup. Set `JWT_SECRET`, `MEKO_ALLOWED_ORIGINS`, `MEKO_BASE_URL`
and provide TLS certs in `api/deploy/certs/`. See [api/docs/restore.md](api/docs/restore.md) for
backups. Build `web/` to static assets and serve them from the same nginx origin.
