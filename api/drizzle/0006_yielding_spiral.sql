ALTER TABLE "boards" ADD COLUMN "parent_board_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "boards" ADD CONSTRAINT "boards_parent_board_id_boards_id_fk" FOREIGN KEY ("parent_board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "boards_parent_idx" ON "boards" USING btree ("parent_board_id");