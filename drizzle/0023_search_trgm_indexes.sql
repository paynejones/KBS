CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX "database_records_title_trgm_idx" ON "database_records" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "database_records_values_trgm_idx" ON "database_records" USING gin (("values"::text) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "pages_title_trgm_idx" ON "pages" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "pages_content_trgm_idx" ON "pages" USING gin ("content" gin_trgm_ops);