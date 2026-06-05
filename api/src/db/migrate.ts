import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import pg from "pg";
import { config } from "@/config.ts";

// The migrator MUST use a direct Postgres connection, never the pooled URL. Drizzle's migrator
// takes a session-level advisory lock; through PgBouncer transaction mode that lock would land
// on a different backend per attempt, allowing two concurrent migrators (§3d/3h).
async function main() {
  if (config.POSTGRES_DIRECT_URL.includes("6432")) {
    throw new Error("POSTGRES_DIRECT_URL points at PgBouncer (6432). Migrations must use db:5432 (§3d).");
  }

  const pool = new pg.Pool({ connectionString: config.POSTGRES_DIRECT_URL, max: 1 });
  const migrationDb = drizzle(pool);

  console.log("[migrate] applying generated migrations…");
  await migrate(migrationDb, { migrationsFolder: "./drizzle" });

  console.log("[migrate] applying tuning.sql (autovacuum overrides)…");
  const tuning = readFileSync(fileURLToPath(new URL("./tuning.sql", import.meta.url)), "utf8");
  await migrationDb.execute(sql.raw(tuning));

  console.log("[migrate] done.");
  await pool.end();
}

main().catch((err) => {
  console.error("[migrate] failed:", err);
  process.exit(1);
});
