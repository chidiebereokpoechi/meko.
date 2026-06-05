# Meko

Self-hostable realtime collaborative canvas. Board state is a [Yjs](https://yjs.dev) CRDT
persisted to Postgres and synchronised across multiple WebSocket nodes via Redis pub/sub.

Design: [meko-plan-v4.md](meko-plan-v4.md). Working agreement + invariants: [CLAUDE.md](CLAUDE.md).

## Status

**Phase 1 — collab spike (done).** Multi-node Yjs convergence, WS ticket auth, doc size gate,
Postgres-backed persistence + compaction, `SKIP LOCKED` job worker, security headers/CSP/CORS,
health probes, structured logging. Verified by `test/multi-node.test.ts` (two real nodes, a
client on node A converges with a client on node B). Phases 2–8 per the plan are not yet built.

## Quickstart (local dev)

```bash
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
```

## Production

`deploy/docker-compose.yml` brings up db, pgbouncer, redis, migrate (one-shot), app, worker,
nginx (TLS termination), and pg-backup. Set `JWT_SECRET`, `MEKO_ALLOWED_ORIGINS`, `MEKO_BASE_URL`
and provide TLS certs in `deploy/certs/`. See [docs/restore.md](docs/restore.md) for backups.
