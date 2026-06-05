CREATE TABLE IF NOT EXISTS "unfurls" (
	"url" text PRIMARY KEY NOT NULL,
	"title" text,
	"description" text,
	"image_url" text,
	"resolved_ip" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
