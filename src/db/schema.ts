
import {
  pgTable,
  text,
  timestamp,
  uuid,
  index,
  jsonb,
  primaryKey,
  uniqueIndex,
  AnyPgColumn,
  integer,
  boolean,
} from "drizzle-orm/pg-core";

export const pages = pgTable(
  "pages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    parentId: uuid("parent_id").references(
        (): AnyPgColumn => pages.id,
        { onDelete: "set null" }
    ),
    sortOrder: integer("sort_order").notNull().default(0),
    isFavorite: boolean("is_favorite").notNull().default(false),
    icon: text("icon"),
    coverImageUrl: text("cover_image_url"),
    isInbox: boolean("is_inbox").notNull().default(false),
    sourceUrl: text("source_url"),
    capturedAt: timestamp("captured_at", { withTimezone: true }),

    // Workspace ownership will be added when workspaces
    // and authentication are implemented.
    title: text("title").notNull().default("Untitled"),

    content: text("content").notNull().default(""),

    contentJson: jsonb("content_json")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp("updated_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("pages_updated_at_idx").on(table.updatedAt),
    index("pages_parent_id_idx").on(table.parentId),
  ],
);

export const pageRevisions = pgTable(
  "page_revisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    pageId: uuid("page_id").notNull().references(() => pages.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    content: text("content").notNull(),
    contentJson: jsonb("content_json").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("page_revisions_page_created_idx").on(table.pageId, table.createdAt)],
);

export const tags = pgTable(
  "tags",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    name: text("name").notNull(),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("tags_name_unique").on(table.name),
  ]
);

export const pageTags = pgTable(
  "page_tags",
  {
    pageId: uuid("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),

    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({
      columns: [table.pageId, table.tagId],
    }),

    index("page_tags_tag_id_idx").on(table.tagId),
  ]
);

export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("attachments_created_at_idx").on(table.createdAt)],
);

export const pageLinks = pgTable(
  "page_links",
  {
    sourcePageId: uuid("source_page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    targetPageId: uuid("target_page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.sourcePageId, table.targetPageId] }),
    index("page_links_target_page_id_idx").on(table.targetPageId),
  ],
);

// Databases own records and properties. Views are separate so full-page and
// future embedded database views can reference the same underlying records.
export const databases = pgTable(
  "databases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull().default("Untitled database"),
    description: text("description").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("databases_updated_at_idx").on(table.updatedAt)],
);

export const databaseProperties = pgTable(
  "database_properties",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    databaseId: uuid("database_id")
      .notNull()
      .references(() => databases.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type").notNull().default("text"),
    options: jsonb("options")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("database_properties_database_id_idx").on(table.databaseId)],
);

export const databaseRecords = pgTable(
  "database_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    databaseId: uuid("database_id")
      .notNull()
      .references(() => databases.id, { onDelete: "cascade" }),
    pageId: uuid("page_id").references(() => pages.id, { onDelete: "set null" }),
    title: text("title").notNull().default("Untitled"),
    values: jsonb("values")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("database_records_database_id_idx").on(table.databaseId),
    index("database_records_updated_at_idx").on(table.updatedAt),
  ],
);

export const databaseViews = pgTable(
  "database_views",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    databaseId: uuid("database_id")
      .notNull()
      .references(() => databases.id, { onDelete: "cascade" }),
    name: text("name").notNull().default("Table"),
    type: text("type").notNull().default("table"),
    config: jsonb("config")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("database_views_database_id_idx").on(table.databaseId)],
);

export const databaseTemplates = pgTable(
  "database_templates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    databaseId: uuid("database_id")
      .notNull()
      .references(() => databases.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    title: text("title").notNull().default("Untitled"),
    values: jsonb("values")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("database_templates_database_id_idx").on(table.databaseId)],
);

export const databaseRecordRelations = pgTable(
  "database_record_relations",
  {
    sourceRecordId: uuid("source_record_id")
      .notNull()
      .references(() => databaseRecords.id, { onDelete: "cascade" }),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => databaseProperties.id, { onDelete: "cascade" }),
    targetRecordId: uuid("target_record_id")
      .notNull()
      .references(() => databaseRecords.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.sourceRecordId, table.propertyId, table.targetRecordId] }),
    index("database_record_relations_target_record_id_idx").on(table.targetRecordId),
  ],
);
