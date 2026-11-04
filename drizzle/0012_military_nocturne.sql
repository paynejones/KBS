ALTER TABLE "pages" ADD COLUMN "is_inbox" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "source_url" text;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "captured_at" timestamp with time zone;