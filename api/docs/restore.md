# Backup & restore (§11c)

Run these from the `api/` directory. The `pg-backup` compose service runs a daily `pg_dump`,
gzips it into `deploy/backups/`, and prunes dumps older than 7 days.

## Restore

```bash
# Stop the app + worker so nothing writes during restore.
docker compose -f deploy/docker-compose.yml stop app worker

# Restore a chosen dump into the running db container.
gunzip -c deploy/backups/meko_YYYYMMDD_HHMMSS.sql.gz \
  | docker compose -f deploy/docker-compose.yml exec -T db psql -U meko -d meko

docker compose -f deploy/docker-compose.yml start app worker
```

For cloud deployments, prefer the managed equivalent (e.g. RDS automated snapshots with
point-in-time recovery) and document your RPO/RTO target alongside this file.
