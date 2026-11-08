import { randomUUID } from "node:crypto";
import { asc, eq, isNull, max } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { databases, databaseProperties, databaseRecords, pages } from "@/db/schema";
import { apiErrorResponse } from "@/lib/api-log";
import { MAX_CSV_ROWS, buildCsvRecords, parseCsv, planCsvColumns } from "@/lib/csv-import";

type Context = { params: Promise<{ id: string }> };
const idSchema = z.string().uuid();
const importSchema = z.object({ csv: z.string().min(1).max(2_000_000) });

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) return NextResponse.json({ error: "Invalid database ID" }, { status: 400 });
  const parsed = importSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid CSV import" }, { status: 400 });

  try {
    const [database] = await db.select({ id: databases.id }).from(databases).where(eq(databases.id, id)).limit(1);
    if (!database) return NextResponse.json({ error: "Database not found" }, { status: 404 });

    const csv = parseCsv(parsed.data.csv);
    if (!csv.ok) return NextResponse.json({ error: csv.error }, { status: 400 });
    if (csv.rows.length > MAX_CSV_ROWS) {
      return NextResponse.json({ error: `Import at most ${MAX_CSV_ROWS} records at a time.` }, { status: 400 });
    }

    const properties = await db.select().from(databaseProperties)
      .where(eq(databaseProperties.databaseId, id))
      .orderBy(asc(databaseProperties.sortOrder));
    const plan = planCsvColumns(csv.headers, properties);

    const summary = await db.transaction(async (tx) => {
      const propertyIds = new Map<string, string>();
      for (const column of plan.columns) {
        if (!column.key.startsWith("new:")) propertyIds.set(column.key, column.key);
      }
      const [lastProperty] = await tx.select({ value: max(databaseProperties.sortOrder) })
        .from(databaseProperties)
        .where(eq(databaseProperties.databaseId, id));
      let propertyOrder = (lastProperty?.value ?? -1) + 1;

      for (const name of plan.newPropertyNames) {
        const [property] = await tx.insert(databaseProperties)
          .values({ databaseId: id, name, type: "text", options: {}, sortOrder: propertyOrder })
          .returning({ id: databaseProperties.id });
        propertyOrder += 1;
        propertyIds.set(`new:${name.toLocaleLowerCase()}`, property.id);
      }

      const { records, skippedRows, skippedCells } = buildCsvRecords(csv.rows, plan, propertyIds);
      if (records.length > 0) {
        const [lastRecord] = await tx.select({ value: max(databaseRecords.sortOrder) })
          .from(databaseRecords)
          .where(eq(databaseRecords.databaseId, id));
        const [lastPage] = await tx.select({ value: max(pages.sortOrder) })
          .from(pages)
          .where(isNull(pages.parentId));
        const pageIds = records.map(() => randomUUID());
        // Every record owns a page, so pages are inserted first with known ids.
        await tx.insert(pages).values(records.map((record, index) => ({
          id: pageIds[index],
          title: record.title,
          sortOrder: (lastPage?.value ?? -1) + 1 + index,
        })));
        await tx.insert(databaseRecords).values(records.map((record, index) => ({
          databaseId: id,
          pageId: pageIds[index],
          title: record.title,
          values: record.values,
          sortOrder: (lastRecord?.value ?? -1) + 1 + index,
        })));
      }

      return {
        created: records.length,
        propertiesCreated: plan.newPropertyNames,
        ignoredColumns: plan.ignoredColumns,
        skippedRows,
        skippedCells,
      };
    });

    return NextResponse.json(summary, { status: 201 });
  } catch (error) {
    return apiErrorResponse(request, "Failed to import CSV", error, { status: 500, logMessage: "Failed to import CSV:" });
  }
}
