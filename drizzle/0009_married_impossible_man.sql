CREATE TABLE "database_record_relations" (
	"source_record_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"target_record_id" uuid NOT NULL,
	CONSTRAINT "database_record_relations_source_record_id_property_id_target_record_id_pk" PRIMARY KEY("source_record_id","property_id","target_record_id")
);
--> statement-breakpoint
ALTER TABLE "database_record_relations" ADD CONSTRAINT "database_record_relations_source_record_id_database_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."database_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "database_record_relations" ADD CONSTRAINT "database_record_relations_property_id_database_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."database_properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "database_record_relations" ADD CONSTRAINT "database_record_relations_target_record_id_database_records_id_fk" FOREIGN KEY ("target_record_id") REFERENCES "public"."database_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "database_record_relations_target_record_id_idx" ON "database_record_relations" USING btree ("target_record_id");