import { and, asc, eq, ilike, inArray, isNull, notExists, sql, type SQL } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { databaseRecords, databases, pageRecordLinks, pages } from "@/db/schema";
import { apiErrorResponse } from "@/lib/api-log";
import { PICKER_OPTION_LIMIT, pickerPattern, pickerQuery } from "@/lib/picker-options";

type Context = { params: Promise<{ id: string }> };
const idSchema = z.string().uuid();
const linkSchema = z.object({ recordId: z.string().uuid() });

const recordColumns = {
  id: databaseRecords.id,
  title: databaseRecords.title,
  databaseId: databases.id,
  databaseName: databases.name,
  pageId: databaseRecords.pageId,
};

/**
 * The picker's unfiltered first page, in the order the list is shown. Ordering
 * every record by database name and then title sorts the whole table, so each
 * database is asked for its own first titles instead; the (database_id, title)
 * index answers each of those in index order.
 */
async function firstRecordOptions(pageId: string) {
  const result = await db.execute<{
    id: string;
    title: string;
    databaseId: string;
    databaseName: string;
    pageId: string | null;
  }>(sql`
    select records.id,
           records.title,
           databases.id as "databaseId",
           databases.name as "databaseName",
           records.page_id as "pageId"
    from databases
    join lateral (
      select id, title, page_id
      from database_records
      where database_id = databases.id
        and not exists (
          select 1
          from page_record_links
          where page_record_links.page_id = ${pageId}
            and page_record_links.record_id = database_records.id
        )
      order by title
      limit ${PICKER_OPTION_LIMIT + 1}
    ) records on true
    order by databases.name, records.title
    limit ${PICKER_OPTION_LIMIT + 1}
  `);
  return result.rows;
}

export async function GET(request: Request, context: Context) {
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ error: "Invalid page ID" }, { status: 400 });
  }

  try {
    const [page] = await db
      .select({ id: pages.id })
      .from(pages)
      .where(and(eq(pages.id, id), isNull(pages.deletedAt)))
      .limit(1);
    if (!page) {
      return NextResponse.json({ error: "Page not found" }, { status: 404 });
    }

    // The picker used to answer with every record in the workspace. It now
    // returns one screenful of titles, narrowed by the search it is given, so
    // opening a page costs what the page can show rather than the whole table.
    const query = pickerQuery(request);

    // A record already linked here is listed above, not offered again.
    const unlinked = notExists(
      db
        .select({ pageId: pageRecordLinks.pageId })
        .from(pageRecordLinks)
        .where(
          and(
            eq(pageRecordLinks.pageId, id),
            eq(pageRecordLinks.recordId, databaseRecords.id),
          ),
        ),
    );

    const findOptions = (filter: SQL) =>
      db
        .select(recordColumns)
        .from(databaseRecords)
        .innerJoin(databases, eq(databaseRecords.databaseId, databases.id))
        .where(and(unlinked, filter))
        .orderBy(asc(databases.name), asc(databaseRecords.title))
        .limit(PICKER_OPTION_LIMIT + 1);

    // A title search and a database-name search in one `OR` made the planner
    // read every record; asked separately, the title half is answered by the
    // title's trigram index and the database half by the database's records.
    async function searchOptions(pattern: string) {
      const [matchingDatabases, byTitle] = await Promise.all([
        db
          .select({ id: databases.id })
          .from(databases)
          .where(ilike(databases.name, pattern))
          .limit(PICKER_OPTION_LIMIT),
        findOptions(ilike(databaseRecords.title, pattern)),
      ]);
      const byDatabase = matchingDatabases.length === 0
        ? []
        : await findOptions(
            inArray(
              databaseRecords.databaseId,
              matchingDatabases.map((database) => database.id),
            ),
          );

      const merged = new Map<string, (typeof byTitle)[number]>();
      for (const record of [...byTitle, ...byDatabase]) {
        if (!merged.has(record.id)) merged.set(record.id, record);
      }
      return [...merged.values()]
        .sort(
          (a, b) =>
            a.databaseName.localeCompare(b.databaseName) ||
            a.title.localeCompare(b.title),
        )
        .slice(0, PICKER_OPTION_LIMIT + 1);
    }

    const [linked, optionRows] = await Promise.all([
      db
        .select(recordColumns)
        .from(pageRecordLinks)
        .innerJoin(databaseRecords, eq(pageRecordLinks.recordId, databaseRecords.id))
        .innerJoin(databases, eq(databaseRecords.databaseId, databases.id))
        .where(eq(pageRecordLinks.pageId, id))
        .orderBy(asc(databases.name), asc(databaseRecords.title)),
      query ? searchOptions(pickerPattern(query)) : firstRecordOptions(id),
    ]);

    return NextResponse.json({
      records: linked,
      options: optionRows.slice(0, PICKER_OPTION_LIMIT),
      hasMore: optionRows.length > PICKER_OPTION_LIMIT,
    });
  } catch (error) {
    return apiErrorResponse(request, "Failed to load page records", error, { status: 500, logMessage: "Failed to load page records:" });
  }
}

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ error: "Invalid page ID" }, { status: 400 });
  }
  const parsed = linkSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid record" }, { status: 400 });
  }

  try {
    const [page] = await db
      .select({ id: pages.id })
      .from(pages)
      .where(and(eq(pages.id, id), isNull(pages.deletedAt)))
      .limit(1);
    if (!page) {
      return NextResponse.json({ error: "Page not found" }, { status: 404 });
    }

    const [record] = await db
      .select({ id: databaseRecords.id, pageId: databaseRecords.pageId })
      .from(databaseRecords)
      .where(eq(databaseRecords.id, parsed.data.recordId))
      .limit(1);
    if (!record) {
      return NextResponse.json({ error: "Record not found" }, { status: 404 });
    }
    if (record.pageId === id) {
      return NextResponse.json(
        { error: "A page cannot link to the record it belongs to" },
        { status: 400 },
      );
    }

    await db
      .insert(pageRecordLinks)
      .values({ pageId: id, recordId: record.id })
      .onConflictDoNothing();

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(request, "Failed to link a record", error, { status: 500, logMessage: "Failed to link a record:" });
  }
}

export async function DELETE(request: Request, context: Context) {
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ error: "Invalid page ID" }, { status: 400 });
  }
  const parsed = linkSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid record" }, { status: 400 });
  }

  try {
    await db
      .delete(pageRecordLinks)
      .where(
        and(
          eq(pageRecordLinks.pageId, id),
          eq(pageRecordLinks.recordId, parsed.data.recordId),
        ),
      );
    return NextResponse.json({ success: true });
  } catch (error) {
    return apiErrorResponse(request, "Failed to unlink a record", error, { status: 500, logMessage: "Failed to unlink a record:" });
  }
}
