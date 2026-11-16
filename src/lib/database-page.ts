import { and, asc, eq, isNull, max } from "drizzle-orm";
import { db } from "@/db";
import { databaseRecords, databases, pages } from "@/db/schema";

/** The transaction a caller is already using for its own rows. */
export type DatabaseTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

/**
 * Returns the page that groups a database's record pages, creating it for a
 * database that predates the grouping. Called inside the caller's transaction,
 * so the grouping page and the record that needs it commit or roll back
 * together.
 */
export async function ensureDatabasePage(
  tx: DatabaseTransaction,
  database: { id: string; name: string; pageId: string | null },
): Promise<string> {
  if (database.pageId) {
    const [existing] = await tx
      .select({ id: pages.id })
      .from(pages)
      .where(and(eq(pages.id, database.pageId), isNull(pages.deletedAt)))
      .limit(1);
    if (existing) return existing.id;
  }

  const createdId = await createRootPage(tx, database.name);
  await tx
    .update(databases)
    .set({ pageId: createdId, updatedAt: new Date() })
    .where(eq(databases.id, database.id));
  return createdId;
}

/** Appends a page under a parent, so record pages keep a stable order. */
export async function createChildPage(
  tx: DatabaseTransaction,
  parentId: string,
  title: string,
): Promise<string> {
  const [childOrder] = await tx
    .select({ value: max(pages.sortOrder) })
    .from(pages)
    .where(eq(pages.parentId, parentId));
  const [created] = await tx
    .insert(pages)
    .values({
      title,
      parentId,
      sortOrder: (childOrder?.value ?? -1) + 1,
    })
    .returning({ id: pages.id });
  return created.id;
}

/** Creates a page at the root of the tree, used for a database's own page. */
export async function createRootPage(
  tx: DatabaseTransaction,
  title: string,
): Promise<string> {
  const [rootOrder] = await tx
    .select({ value: max(pages.sortOrder) })
    .from(pages)
    .where(isNull(pages.parentId));
  const [created] = await tx
    .insert(pages)
    .values({ title, sortOrder: (rootOrder?.value ?? -1) + 1 })
    .returning({ id: pages.id });
  return created.id;
}

export type RecordPageGrouping = {
  databases: number;
  createdPages: number;
  movedPages: number;
};

/**
 * Groups record pages created before databases owned a grouping page. A root
 * record page moves under its database's page — a page already nested
 * somewhere else keeps the user's placement — and each database keeps its
 * existing page order. Running it twice moves nothing the second time. Pass a
 * database id to limit a run to one database.
 */
export async function groupRecordPages(
  databaseId?: string,
): Promise<RecordPageGrouping> {
  return db.transaction(async (tx) => {
    const databaseRows = await tx
      .select()
      .from(databases)
      .where(databaseId ? eq(databases.id, databaseId) : undefined)
      .orderBy(asc(databases.createdAt), asc(databases.id));
    let createdPages = 0;
    let movedPages = 0;

    for (const database of databaseRows) {
      const databasePageId = await ensureDatabasePage(tx, database);
      if (databasePageId !== database.pageId) createdPages += 1;

      const rootRecordPages = await tx
        .select({ id: pages.id })
        .from(databaseRecords)
        .innerJoin(pages, eq(pages.id, databaseRecords.pageId))
        .where(and(
          eq(databaseRecords.databaseId, database.id),
          isNull(pages.parentId),
          isNull(pages.deletedAt),
        ))
        .orderBy(asc(pages.sortOrder), asc(pages.id));
      if (rootRecordPages.length === 0) continue;

      const [lastChild] = await tx
        .select({ value: max(pages.sortOrder) })
        .from(pages)
        .where(eq(pages.parentId, databasePageId));
      let sortOrder = (lastChild?.value ?? -1) + 1;
      for (const page of rootRecordPages) {
        await tx
          .update(pages)
          .set({ parentId: databasePageId, sortOrder })
          .where(eq(pages.id, page.id));
        sortOrder += 1;
        movedPages += 1;
      }
    }

    return { databases: databaseRows.length, createdPages, movedPages };
  });
}
