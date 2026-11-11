
import { sql } from "drizzle-orm";
import type { CapturedAttachment } from "@/lib/media";
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

import type { DatabasePropertyType } from "@/lib/database-property";
import type { DatabaseViewType } from "@/lib/database-view";

// Metadata read from a captured link's page. Stored alongside the source URL
// so the inbox can show a real preview without re-fetching on every load.
export type LinkPreviewMetadata = {
  title: string | null;
  description: string | null;
  siteName: string | null;
  imageUrl: string | null;
  faviconUrl: string | null;
};

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
    // Optional passage the user highlighted on the captured page. Kept apart
    // from `content` so a quote stays attached to the URL it came from.
    selectedText: text("selected_text"),
    capturedAt: timestamp("captured_at", { withTimezone: true }),

    // Null when the captured URL could not be read: offline, non-HTML, or a
    // target the server refuses to fetch.
    linkPreview: jsonb("link_preview").$type<LinkPreviewMetadata | null>(),

    // The file saved with an inbox capture. The URL travels with it so the
    // usual reference scan keeps the bytes while this page exists.
    captureAttachment: jsonb("capture_attachment").$type<CapturedAttachment | null>(),

    // Soft delete. Trashed pages keep their rows so they can be restored
    // with their revisions, tags, and links intact.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),

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
    index("pages_deleted_at_idx").on(table.deletedAt),
    // Trigram indexes let global search and the page browser answer the
    // substring patterns below from an index instead of reading every page
    // body. Terms shorter than three characters carry no trigrams and still
    // fall back to a scan, as does a term common enough that the planner
    // prefers one.
    index("pages_title_trgm_idx").using("gin", sql`${table.title} gin_trgm_ops`),
    index("pages_content_trgm_idx").using("gin", sql`${table.content} gin_trgm_ops`),
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

// A saved search is a live collection: it stores the filters, never the rows,
// so its results follow the workspace as pages change. A deleted tag leaves
// the saved search intact and simply drops that part of the filter.
export const savedSearches = pgTable(
  "saved_searches",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    name: text("name").notNull(),

    // Matched against page titles and content, like the page browser's search.
    query: text("query").notNull().default(""),

    tagId: uuid("tag_id").references(() => tags.id, { onDelete: "set null" }),

    favoritesOnly: boolean("favorites_only").notNull().default(false),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("saved_searches_created_at_idx").on(table.createdAt)],
);

// A reading item is an article or book tracked through to-read, reading, and
// finished. Its notes live in the page it owns, so the item is metadata beside
// a normal page rather than a second copy of one.
export const readingItems = pgTable(
  "reading_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    pageId: uuid("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),

    // "article" or "book"; validated at the API edge.
    kind: text("kind").notNull().default("article"),

    // "to-read", "reading", or "finished".
    status: text("status").notNull().default("to-read"),

    author: text("author").notNull().default(""),

    url: text("url"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("reading_items_page_id_unique").on(table.pageId),
    index("reading_items_status_idx").on(table.status),
    index("reading_items_updated_at_idx").on(table.updatedAt),
  ],
);

// Passages kept from a reading item, with an optional note about why they
// matter. Removing an item takes its highlights with it; removing an item does
// not delete the notes page.
export const readingHighlights = pgTable(
  "reading_highlights",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    itemId: uuid("item_id")
      .notNull()
      .references(() => readingItems.id, { onDelete: "cascade" }),

    text: text("text").notNull(),

    note: text("note").notNull().default(""),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("reading_highlights_item_created_idx").on(table.itemId, table.createdAt)],
);

// Reusable page structures. A template is a snapshot of a page's title, icon,
// and content; using one creates an ordinary page, so later edits to either
// side never affect the other.
export const pageTemplates = pgTable(
  "page_templates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    title: text("title").notNull().default("Untitled"),
    content: text("content").notNull().default(""),
    contentJson: jsonb("content_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    icon: text("icon"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("page_templates_name_idx").on(table.name)],
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

// A small log of tasks checked off from the focus view or the home page, so a
// pinned project card can show what was finished recently. A row is keyed by
// the task's text on its page; unchecking the task removes the row again.
export const taskCompletions = pgTable(
  "task_completions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    pageId: uuid("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("task_completions_page_completed_idx").on(table.pageId, table.completedAt),
  ],
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
    // "manual" connections are chosen deliberately in the connections panel and
    // outlive inline links; "inline" ones are cleaned up with their link.
    origin: text("origin").notNull().default("manual"),
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
    type: text("type").$type<DatabasePropertyType>().notNull().default("text"),
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
    // Search reads record titles and every property value as text; both keep
    // their trigram index so record lookups stay indexed as a workspace grows.
    index("database_records_title_trgm_idx").using("gin", sql`${table.title} gin_trgm_ops`),
    index("database_records_values_trgm_idx").using(
      "gin",
      sql`(${table.values}::text) gin_trgm_ops`,
    ),
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
    type: text("type").$type<DatabaseViewType>().notNull().default("table"),
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

// Deliberate connections between a page and a database record. The row is
// symmetric: the page shows its linked records and the record shows its linked
// pages, so either side can create or remove the same connection.
export const pageRecordLinks = pgTable(
  "page_record_links",
  {
    pageId: uuid("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    recordId: uuid("record_id")
      .notNull()
      .references(() => databaseRecords.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.pageId, table.recordId] }),
    index("page_record_links_record_id_idx").on(table.recordId),
  ],
);
