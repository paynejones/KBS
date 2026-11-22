CREATE TABLE "notion_objects" (
	"notion_id" text NOT NULL,
	"kind" text NOT NULL,
	"kbs_id" uuid NOT NULL,
	"label" text NOT NULL,
	"parent_notion_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notion_objects_notion_id_kbs_id_pk" PRIMARY KEY("notion_id","kbs_id")
);
