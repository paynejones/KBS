CREATE TABLE "reading_highlights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"text" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reading_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"kind" text DEFAULT 'article' NOT NULL,
	"status" text DEFAULT 'to-read' NOT NULL,
	"author" text DEFAULT '' NOT NULL,
	"url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reading_highlights" ADD CONSTRAINT "reading_highlights_item_id_reading_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."reading_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_items" ADD CONSTRAINT "reading_items_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reading_highlights_item_created_idx" ON "reading_highlights" USING btree ("item_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reading_items_page_id_unique" ON "reading_items" USING btree ("page_id");--> statement-breakpoint
CREATE INDEX "reading_items_status_idx" ON "reading_items" USING btree ("status");--> statement-breakpoint
CREATE INDEX "reading_items_updated_at_idx" ON "reading_items" USING btree ("updated_at");