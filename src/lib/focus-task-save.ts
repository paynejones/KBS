import {
  toggleTaskInDocument,
  type FocusTask,
  type TaskCompletionChange,
} from "./focus";

/**
 * Writes a task's checked state back to the page that holds it, returning
 * nothing on success. The page is read first because the stored document is
 * the source of truth: a task list edited elsewhere may have moved the item
 * since this view loaded, and a stale path must not toggle a neighbour.
 */
export async function saveTaskChecked(
  task: Pick<FocusTask, "pageId" | "path" | "text">,
  checked: boolean,
): Promise<void> {
  const pageResponse = await fetch(`/api/pages/${task.pageId}`);
  if (!pageResponse.ok) throw new Error("Could not open the page holding that task.");
  const page = (await pageResponse.json()) as { contentJson?: unknown };

  const nextJson = toggleTaskInDocument(page.contentJson, task.path, checked);
  if (!nextJson) throw new Error("That task has changed. Reload and try again.");

  const response = await fetch(`/api/pages/${task.pageId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contentJson: nextJson }),
  });
  if (!response.ok) throw new Error("Could not save that task.");

  await recordTaskCompletions(task.pageId, [{ text: task.text, checked }]);
}

/**
 * Records check-offs for the pinned project history. History is decoration
 * around an already-saved page, so every failure here is swallowed.
 */
export async function recordTaskCompletions(
  pageId: string,
  changes: readonly TaskCompletionChange[],
): Promise<void> {
  for (const change of changes) {
    try {
      await fetch(`/api/pages/${pageId}/task-completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(change),
      });
    } catch {
      // The saved page stands even when its history does not.
    }
  }
}
