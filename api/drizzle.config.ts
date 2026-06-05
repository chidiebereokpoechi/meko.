import type { Config } from "drizzle-kit";

// drizzle-kit generates DDL only; the runtime migrator (src/db/migrate.ts) applies it
// over POSTGRES_DIRECT_URL to bypass PgBouncer (§3d).
export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.POSTGRES_DIRECT_URL ?? "postgres://meko:meko@localhost:5432/meko",
  },
} satisfies Config;
