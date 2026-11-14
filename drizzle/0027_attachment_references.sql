CREATE TABLE "attachment_references" (
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"attachment_id" uuid NOT NULL,
	CONSTRAINT "attachment_references_source_type_source_id_attachment_id_pk" PRIMARY KEY("source_type","source_id","attachment_id")
);
--> statement-breakpoint
ALTER TABLE "attachment_references" ADD CONSTRAINT "attachment_references_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachment_references_attachment_id_idx" ON "attachment_references" USING btree ("attachment_id");--> statement-breakpoint
-- A file is named by its URL inside a document, so the references are extracted
-- where the documents live and only the ids are kept. Triggers keep this true
-- for every writer, including cascades and restores, not just the API routes.
CREATE OR REPLACE FUNCTION "refresh_attachment_references"() RETURNS trigger AS $$
DECLARE
	payload text;
BEGIN
	IF (TG_OP = 'DELETE') THEN
		DELETE FROM "attachment_references"
		WHERE "source_type" = TG_TABLE_NAME AND "source_id" = OLD."id";
		RETURN OLD;
	END IF;

	DELETE FROM "attachment_references"
	WHERE "source_type" = TG_TABLE_NAME AND "source_id" = NEW."id";

	-- Separate statements, not one CASE: plpgsql compiles an expression as a
	-- whole, so naming NEW."values" while handling a page row would fail even
	-- though that branch is never taken.
	IF (TG_TABLE_NAME = 'pages') THEN
		payload := coalesce(NEW."content"::text, '') || ' ' || coalesce(NEW."content_json"::text, '') || ' '
			|| coalesce(NEW."cover_image_url"::text, '') || ' ' || coalesce(NEW."capture_attachment"::text, '');
	ELSIF (TG_TABLE_NAME = 'page_revisions') THEN
		payload := coalesce(NEW."content"::text, '') || ' ' || coalesce(NEW."content_json"::text, '');
	ELSE
		payload := coalesce(NEW."values"::text, '');
	END IF;

	IF (position('/api/attachments/' in payload) > 0) THEN
		INSERT INTO "attachment_references" ("source_type", "source_id", "attachment_id")
		SELECT TG_TABLE_NAME, NEW."id", "attachments"."id"
		FROM regexp_matches(
			payload,
			'/api/attachments/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})',
			'gi'
		) AS match
		JOIN "attachments" ON "attachments"."id" = lower(match[1])::uuid
		ON CONFLICT DO NOTHING;
	END IF;

	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "pages_attachment_references" AFTER INSERT OR UPDATE OR DELETE ON "pages"
	FOR EACH ROW EXECUTE FUNCTION "refresh_attachment_references"();--> statement-breakpoint
CREATE TRIGGER "page_revisions_attachment_references" AFTER INSERT OR UPDATE OR DELETE ON "page_revisions"
	FOR EACH ROW EXECUTE FUNCTION "refresh_attachment_references"();--> statement-breakpoint
CREATE TRIGGER "database_records_attachment_references" AFTER INSERT OR UPDATE OR DELETE ON "database_records"
	FOR EACH ROW EXECUTE FUNCTION "refresh_attachment_references"();--> statement-breakpoint
CREATE TRIGGER "database_templates_attachment_references" AFTER INSERT OR UPDATE OR DELETE ON "database_templates"
	FOR EACH ROW EXECUTE FUNCTION "refresh_attachment_references"();--> statement-breakpoint
INSERT INTO "attachment_references" ("source_type", "source_id", "attachment_id")
SELECT 'pages', "pages"."id", "attachments"."id"
FROM "pages"
CROSS JOIN LATERAL regexp_matches(
	coalesce("pages"."content"::text, '') || ' ' || coalesce("pages"."content_json"::text, '') || ' '
	|| coalesce("pages"."cover_image_url"::text, '') || ' ' || coalesce("pages"."capture_attachment"::text, ''),
	'/api/attachments/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})',
	'gi'
) AS match
JOIN "attachments" ON "attachments"."id" = lower(match[1])::uuid
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "attachment_references" ("source_type", "source_id", "attachment_id")
SELECT 'page_revisions', "page_revisions"."id", "attachments"."id"
FROM "page_revisions"
CROSS JOIN LATERAL regexp_matches(
	coalesce("page_revisions"."content"::text, '') || ' ' || coalesce("page_revisions"."content_json"::text, ''),
	'/api/attachments/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})',
	'gi'
) AS match
JOIN "attachments" ON "attachments"."id" = lower(match[1])::uuid
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "attachment_references" ("source_type", "source_id", "attachment_id")
SELECT 'database_records', "database_records"."id", "attachments"."id"
FROM "database_records"
CROSS JOIN LATERAL regexp_matches(
	coalesce("database_records"."values"::text, ''),
	'/api/attachments/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})',
	'gi'
) AS match
JOIN "attachments" ON "attachments"."id" = lower(match[1])::uuid
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "attachment_references" ("source_type", "source_id", "attachment_id")
SELECT 'database_templates', "database_templates"."id", "attachments"."id"
FROM "database_templates"
CROSS JOIN LATERAL regexp_matches(
	coalesce("database_templates"."values"::text, ''),
	'/api/attachments/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})',
	'gi'
) AS match
JOIN "attachments" ON "attachments"."id" = lower(match[1])::uuid
ON CONFLICT DO NOTHING;
