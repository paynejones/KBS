
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
} from "drizzle-orm/pg-core";

export const pages = pgTable(
  "pages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    parentId: uuid("parent_id").references(
        (): AnyPgColumn => pages.id,
        { onDelete: "set null" }
    ),

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