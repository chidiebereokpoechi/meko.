import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { config } from "@/config.ts";
import * as schema from "@/db/schema.ts";

// Pooled client — routes through PgBouncer (transaction mode). Use for all app queries.
const pool = new pg.Pool({ connectionString: config.DATABASE_URL });
export const db = drizzle(pool, { schema });

// Direct client — bypasses PgBouncer (db:5432). Required for session-level advisory locks
// and LISTEN/NOTIFY, which break under PgBouncer transaction pooling (§3d/3h). Lazily
// created so app paths that never need it don't open a direct connection.
let _directPool: pg.Pool | null = null;
export function directDb() {
  _directPool ??= new pg.Pool({ connectionString: config.POSTGRES_DIRECT_URL });
  return drizzle(_directPool, { schema });
}

export async function closeDb() {
  await pool.end();
  if (_directPool) await _directPool.end();
}
