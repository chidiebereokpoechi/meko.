CREATE TYPE "public"."export_format" AS ENUM('png', 'pdf');--> statement-breakpoint
CREATE TYPE "public"."export_status" AS ENUM('pending', 'running', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"format" "export_format" NOT NULL,
	"status" "export_status" DEFAULT 'pending' NOT NULL,
	"result_key" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "exports" ADD CONSTRAINT "exports_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "exports" ADD CONSTRAINT "exports_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "exports_board_idx" ON "exports" USING btree ("board_id","created_at" DESC NULLS LAST);