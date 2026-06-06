ALTER TABLE "users" ADD COLUMN "oidc_sub" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_oidc_sub_idx" ON "users" USING btree ("oidc_sub");