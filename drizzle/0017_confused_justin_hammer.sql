CREATE TABLE "page_record_links" (
	"page_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	CONSTRAINT "page_record_links_page_id_record_id_pk" PRIMARY KEY("page_id","record_id")
);
--> statement-breakpoint
ALTER TABLE "page_record_links" ADD CONSTRAINT "page_record_links_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_record_links" ADD CONSTRAINT "page_record_links_record_id_database_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."database_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_record_links_record_id_idx" ON "page_record_links" USING btree ("record_id");