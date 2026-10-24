
import {
  pgTable,
  text,
  timestamp,
  uuid,
  index,
  jsonb,
} from "drizzle-orm/pg-core";

export const pages = pgTable(
  "pages",
  {
    id: uuid("id").defaultRandom().primaryKey(),

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
  ],
);
