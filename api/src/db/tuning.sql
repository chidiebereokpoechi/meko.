-- Autovacuum overrides for high-churn tables (§13a). Applied by src/db/migrate.ts after the
-- generated Drizzle migrations. Idempotent: ALTER TABLE SET is safe to re-run.

ALTER TABLE jobs SET (
  autovacuum_vacuum_scale_factor = 0.01,
  autovacuum_analyze_scale_factor = 0.01,
  autovacuum_vacuum_cost_delay = 2
);

ALTER TABLE yjs_updates SET (
  autovacuum_vacuum_scale_factor = 0.01,
  autovacuum_analyze_scale_factor = 0.01
);

ALTER TABLE refresh_tokens SET (
  autovacuum_vacuum_scale_factor = 0.02
);
