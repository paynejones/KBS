import { asc, desc, inArray, isNull } from "drizzle-orm";
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
import { pageGroupIds } from "@/lib/graph";

/** Home shows a short list; the focus view is where every pinned project lives. */
const PINNED_PROJECT_LIMIT = 6;
/** Only the next few open tasks fit on a card. */
const OPEN_TASK_LIMIT = 20;

/**
 * Task progress for pinned (favorite) pages that actually hold tasks. Each
 * project counts the task lists on its own page and every subpage, the same
 * way the focus view does, so the home page and the focus view never disagree.
 */
export async function GET(request: Request) {
  try {
    // A project's tasks live on its own page and its subpages, so the whole
    // active tree is needed before the pinned pages are picked out of it.
    const allActive = await db
      .select({
        id: pages.id,
        title: pages.title,
        icon: pages.icon,
        parentId: pages.parentId,
        contentJson: pages.contentJson,
        isFavorite: pages.isFavorite,
      })
      .from(pages)
      .where(isNull(pages.deletedAt))
      .orderBy(asc(pages.title));

    const pinnedPages = allActive.filter((row) => row.isFavorite);

    const projects: {
      id: string;
      title: string;
      icon: string | null;
      progress: ReturnType<typeof focusTaskProgress>;
      tasks: FocusTask[];
      recentlyCompleted: { text: string; completedAt: Date }[];
    }[] = [];
    const subtreeByProject = new Map<string, Set<string>>();

    for (const project of pinnedPages) {
      if (projects.length >= PINNED_PROJECT_LIMIT) break;

      const subtreeIds = pageGroupIds(allActive, project.id);
      const subtree = [project, ...allActive.filter(
        (row) => row.id !== project.id && subtreeIds.has(row.id),
      )];
      subtreeByProject.set(project.id, subtreeIds);

      const tasks: FocusTask[] = [];
      for (const row of subtree) {
        const remaining = FOCUS_TASK_LIMIT - tasks.length;
        if (remaining <= 0) break;
        tasks.push(...focusTasks(row.contentJson, row.id, row.title, remaining));
      }

      // A favorite with nothing to do is not a project with progress to show.
      if (tasks.length === 0) continue;

      projects.push({
        id: project.id,
        title: project.title,
        icon: project.icon,
        progress: focusTaskProgress(tasks),
        tasks: tasks.filter((task) => !task.checked).slice(0, OPEN_TASK_LIMIT),
        recentlyCompleted: [],
      });
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
