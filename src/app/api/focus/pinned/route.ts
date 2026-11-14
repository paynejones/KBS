import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { pages, taskCompletions } from "@/db/schema";
import { apiErrorResponse } from "@/lib/api-log";
import {
  FOCUS_TASK_LIMIT,
  focusTaskProgress,
  focusTasks,
  type FocusTask,
} from "@/lib/focus";
import { subtreeIds } from "@/db/page-tree";

/** Home shows a short list; the focus view is where every pinned project lives. */
const PINNED_PROJECT_LIMIT = 6;
/** Only the next few open tasks fit on a card. */
const OPEN_TASK_LIMIT = 20;
/**
 * Favorites are examined a batch at a time, so their editor documents are read
 * only until the cards are full instead of for the whole workspace.
 */
const PINNED_FAVORITE_BATCH = 6;

type PinnedProject = {
  id: string;
  title: string;
  icon: string | null;
  progress: ReturnType<typeof focusTaskProgress>;
  tasks: FocusTask[];
  recentlyCompleted: { text: string; completedAt: Date }[];
};

/**
 * Task progress for pinned (favorite) pages that actually hold tasks. Each
 * project counts the task lists on its own page and every subpage, the same
 * way the focus view does, so the home page and the focus view never disagree.
 */
export async function GET(request: Request) {
  try {
    // Only the pinned pages are named here. Which pages belong to a project is
    // a question about the tree, so the subtrees are walked per favorite below
    // rather than by reading every page in the workspace first.
    const pinnedPages = await db
      .select({ id: pages.id, title: pages.title, icon: pages.icon })
      .from(pages)
      .where(and(isNull(pages.deletedAt), eq(pages.isFavorite, true)))
      .orderBy(asc(pages.title));

    const projects: PinnedProject[] = [];
    const subtreeByProject = new Map<string, Set<string>>();

    for (
      let start = 0;
      start < pinnedPages.length && projects.length < PINNED_PROJECT_LIMIT;
      start += PINNED_FAVORITE_BATCH
    ) {
      // A favorite with nothing to do is not a project with progress to show,
      // so the bodies decide which favorites count — but only this batch's
      // subtrees are read to find out.
      const batchPages = pinnedPages.slice(start, start + PINNED_FAVORITE_BATCH);
      const batch = await Promise.all(
        batchPages.map(async (project) => ({
          project,
          subtreeIds: await subtreeIds(db, project.id),
        })),
      );

      const subtreePageIds = [...new Set(batch.flatMap(({ subtreeIds: ids }) => ids))];
      // The subtree walk sees trashed pages too, so they are filtered here for
      // the same reason the old whole-table read skipped them.
      const details = subtreePageIds.length === 0
        ? []
        : await db
            .select({ id: pages.id, title: pages.title, contentJson: pages.contentJson })
            .from(pages)
            .where(and(inArray(pages.id, subtreePageIds), isNull(pages.deletedAt)))
            .orderBy(asc(pages.title));
      const contentById = new Map(details.map((row) => [row.id, row.contentJson]));
      const activeSubtreeIds = new Set(details.map((row) => row.id));

      for (const { project, subtreeIds: projectSubtreeIds } of batch) {
        if (projects.length >= PINNED_PROJECT_LIMIT) break;

        const members = new Set(projectSubtreeIds.filter((id) => activeSubtreeIds.has(id)));
        // Titles come from the same rows, ordered by title, so a card lists its
        // subpages in the order the old read put them in.
        const subtree = [
          project,
          ...details.filter((row) => row.id !== project.id && members.has(row.id)),
        ];

        const tasks: FocusTask[] = [];
        for (const row of subtree) {
          const remaining = FOCUS_TASK_LIMIT - tasks.length;
          if (remaining <= 0) break;
          tasks.push(...focusTasks(contentById.get(row.id), row.id, row.title, remaining));
        }

        if (tasks.length === 0) continue;

        projects.push({
          id: project.id,
          title: project.title,
          icon: project.icon,
          progress: focusTaskProgress(tasks),
          tasks: tasks.filter((task) => !task.checked).slice(0, OPEN_TASK_LIMIT),
          recentlyCompleted: [],
        });
        subtreeByProject.set(project.id, members);
      }
    }

    if (projects.length > 0) {
      // One query covers every pinned project: subtrees may overlap when a
      // favorite sits inside another favorite, and both cards should show it.
      const pageIds = [...new Set(
        [...subtreeByProject.values()].flatMap((ids) => [...ids]),
      )];
      const completions = await db
        .select({
          pageId: taskCompletions.pageId,
          text: taskCompletions.text,
          completedAt: taskCompletions.completedAt,
        })
        .from(taskCompletions)
        .where(inArray(taskCompletions.pageId, pageIds))
        .orderBy(desc(taskCompletions.completedAt));

      for (const project of projects) {
        const ids = subtreeByProject.get(project.id) ?? new Set<string>();
        const seen = new Set<string>();
        const recent: { text: string; completedAt: Date }[] = [];

        for (const row of completions) {
          if (!ids.has(row.pageId) || seen.has(row.text)) continue;
          seen.add(row.text);
          recent.push({ text: row.text, completedAt: row.completedAt });
          if (recent.length >= 2) break;
        }

        project.recentlyCompleted = recent;
      }
    }

    return NextResponse.json({ projects });
  } catch (error) {
    return apiErrorResponse(request, "Failed to load pinned project progress", error, {
      status: 500,
      logMessage: "Failed to load pinned project progress:",
    });
  }
}
