import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import {
  databaseRecords,
  databases,
  pageLinks,
  pageRecordLinks,
  pages,
  pageTags,
  tags,
} from "@/db/schema";
import { apiErrorResponse } from "@/lib/api-log";
import {
  FOCUS_TASK_LIMIT,
  focusTaskProgress,
  focusTasks,
  type FocusTask,
} from "@/lib/focus";
import { subtreeIds } from "@/db/page-tree";

type Context = { params: Promise<{ id: string }> };
const idSchema = z.string().uuid();
/**
 * Editor documents are read a batch at a time, in the order tasks are listed,
 * so a project with many subpages does not load every document at once and
 * stops as soon as the task list is full.
 */
const TASK_DOCUMENT_BATCH = 8;

/**
 * Everything one project needs on one screen: the task lists from the project
 * page and its subpages, the subpages themselves, and the pages and records
 * connected to it. Tasks carry their document path so the checkbox can be
 * written back to the page that owns it.
 */
export async function GET(request: Request, context: Context) {
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ error: "Invalid page ID" }, { status: 400 });
  }

  try {
    // One recursive query names the subtree, so only the pages whose tasks
    // appear on this screen are read; this used to load every page body in the
    // workspace.
    const subtree = await subtreeIds(db, id);
    if (!subtree.includes(id)) {
      return NextResponse.json({ error: "Page not found" }, { status: 404 });
    }

    // Titles and tree shape only: the documents that hold the tasks are read
    // afterwards, once the order they appear in is known.
    const pageRows = await db
      .select({
        id: pages.id,
        title: pages.title,
        icon: pages.icon,
        isFavorite: pages.isFavorite,
        parentId: pages.parentId,
        sortOrder: pages.sortOrder,
      })
      .from(pages)
      .where(and(inArray(pages.id, subtree), isNull(pages.deletedAt)));

    const project = pageRows.find((row) => row.id === id);
    if (!project) {
      return NextResponse.json({ error: "Page not found" }, { status: 404 });
    }

    // Tasks come from the project and everything beneath it, so a project made
    // of several pages is one checklist. The project's own page comes first.
    // The query already limited these rows to the subtree, so the project is
    // the only page that has to come out.
    const descendants = pageRows
      .filter((row) => row.id !== id)
      .sort(
        (left, right) =>
          left.sortOrder - right.sortOrder ||
          left.title.localeCompare(right.title, undefined, { sensitivity: "base" }),
      );

    const taskPages = [project, ...descendants];
    const tasks: FocusTask[] = [];

    for (
      let start = 0;
      start < taskPages.length && tasks.length < FOCUS_TASK_LIMIT;
      start += TASK_DOCUMENT_BATCH
    ) {
      const batch = taskPages.slice(start, start + TASK_DOCUMENT_BATCH);
      const documents = await db
        .select({ id: pages.id, contentJson: pages.contentJson })
        .from(pages)
        .where(
          and(
            inArray(pages.id, batch.map((row) => row.id)),
            // A document with no task nodes cannot add a task, so it is not
            // worth sending: projects are often mostly prose. The check runs
            // in the database, which means those documents never leave it.
            sql`jsonb_path_exists(${pages.contentJson}, ${'$.**.type ? (@ == "taskItem")'})`
          )
        );
      const documentById = new Map(documents.map((row) => [row.id, row.contentJson]));

      for (const row of batch) {
        const remaining = FOCUS_TASK_LIMIT - tasks.length;
        if (remaining <= 0) break;
        tasks.push(...focusTasks(documentById.get(row.id), row.id, row.title, remaining));
      }
    }

    const [linkRows, backlinkRows, recordRows, tagRows, parentRows] = await Promise.all([
      db
        .select({ id: pages.id, title: pages.title })
        .from(pageLinks)
        .innerJoin(pages, eq(pageLinks.targetPageId, pages.id))
        .where(and(eq(pageLinks.sourcePageId, id), isNull(pages.deletedAt)))
        .orderBy(asc(pages.title)),
      db
        .select({ id: pages.id, title: pages.title })
        .from(pageLinks)
        .innerJoin(pages, eq(pageLinks.sourcePageId, pages.id))
        .where(and(eq(pageLinks.targetPageId, id), isNull(pages.deletedAt)))
        .orderBy(asc(pages.title)),
      db
        .select({
          id: databaseRecords.id,
          title: databaseRecords.title,
          databaseId: databases.id,
          databaseName: databases.name,
          pageId: databaseRecords.pageId,
        })
        .from(pageRecordLinks)
        .innerJoin(databaseRecords, eq(pageRecordLinks.recordId, databaseRecords.id))
        .innerJoin(databases, eq(databaseRecords.databaseId, databases.id))
        .where(eq(pageRecordLinks.pageId, id))
        .orderBy(asc(databases.name), asc(databaseRecords.title)),
      db
        .select({ id: tags.id, name: tags.name })
        .from(pageTags)
        .innerJoin(tags, eq(pageTags.tagId, tags.id))
        .where(eq(pageTags.pageId, id))
        .orderBy(asc(tags.name)),
      project.parentId
        ? db
            .select({ id: pages.id, title: pages.title })
            .from(pages)
            .where(and(eq(pages.id, project.parentId), isNull(pages.deletedAt)))
            .limit(1)
        : Promise.resolve([] as { id: string; title: string }[]),
    ]);

    return NextResponse.json({
      project: {
        id: project.id,
        title: project.title,
        icon: project.icon,
        isFavorite: project.isFavorite,
        parent: parentRows[0] ?? null,
        tags: tagRows,
      },
      tasks,
      pages: descendants.map(({ id: pageId, title, parentId }) => ({
        id: pageId,
        title,
        parentId,
      })),
      references: {
        links: linkRows,
        backlinks: backlinkRows,
        records: recordRows,
      },
      progress: focusTaskProgress(tasks),
    });
  } catch (error) {
    return apiErrorResponse(request, "Failed to load the focus view", error, {
      status: 500,
      logMessage: "Failed to load the focus view:",
    });
  }
}
