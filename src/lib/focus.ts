/**
 * A focus view is built from data the workspace already stores: task lists in
 * page documents and the connections around a project page. Nothing here is
 * persisted separately, so checking a task writes back to its own page and the
 * rest of the view keeps following the pages as they change.
 */

export type FocusTask = {
  pageId: string;
  pageTitle: string;
  /** Indices from the document root: `[1, 0]` is the first item of the second block. */
  path: number[];
  text: string;
  checked: boolean;
};

export type FocusPageRef = { id: string; title: string };
export type FocusRecordRef = FocusPageRef & { databaseId: string; databaseName: string };

export type FocusReferences = {
  links: FocusPageRef[];
  backlinks: FocusPageRef[];
  records: FocusRecordRef[];
};

export type FocusProject = {
  id: string;
  title: string;
  icon: string | null;
  isFavorite: boolean;
  parent: FocusPageRef | null;
  tags: { id: string; name: string }[];
};

export type FocusProgress = {
  total: number;
  done: number;
  open: number;
  percent: number;
};

export type FocusData = {
  project: FocusProject;
  tasks: FocusTask[];
  pages: { id: string; title: string; parentId: string | null }[];
  references: FocusReferences;
  progress: FocusProgress;
};

/** A project with more tasks than this is a data problem, not a focus view. */
export const FOCUS_TASK_LIMIT = 200;

/** Projects selected in this browser, newest first, for one-click switching. */
export const FOCUS_RECENTS_KEY = "kbs:focus-recents";
export const FOCUS_RECENT_LIMIT = 6;
export const FOCUS_SHORTCUT_LIMIT = 8;

export function parseFocusRecentIds(serialized: string | null): string[] {
  if (!serialized) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  const seen = new Set<string>();
  const ids: string[] = [];
  for (const entry of parsed) {
    if (typeof entry !== "string") continue;
    const id = entry.trim();
    if (!id || id.length > 100 || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= FOCUS_RECENT_LIMIT) break;
  }

  return ids;
}

/** Choosing a project again moves it to the front instead of repeating it. */
export function rememberFocusProject(
  ids: readonly string[],
  id: string,
  limit = FOCUS_RECENT_LIMIT,
): string[] {
  const projectId = id.trim();
  if (!projectId) return [...ids];

  return [projectId, ...ids.filter((entry) => entry !== projectId)].slice(0, limit);
}

/**
 * The quick-switch row: favorites first because they were chosen deliberately,
 * then recently focused projects, once each.
 */
export function focusShortcuts(
  favoriteIds: readonly string[],
  recentIds: readonly string[],
  limit = FOCUS_SHORTCUT_LIMIT,
): string[] {
  const seen = new Set<string>();
  const shortcuts: string[] = [];

  for (const id of [...favoriteIds, ...recentIds]) {
    const projectId = id.trim();
    if (!projectId || seen.has(projectId)) continue;
    seen.add(projectId);
    shortcuts.push(projectId);
    if (shortcuts.length >= limit) break;
  }

  return shortcuts;
}

type JsonNode = {
  type?: unknown;
  text?: unknown;
  attrs?: unknown;
  content?: unknown;
};

function nodeText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const record = node as JsonNode;
  if (typeof record.text === "string") return record.text;
  if (!Array.isArray(record.content)) return "";
  return record.content.map(nodeText).filter(Boolean).join(" ");
}

function nodeAttrs(node: JsonNode): Record<string, unknown> {
  return node.attrs && typeof node.attrs === "object"
    ? (node.attrs as Record<string, unknown>)
    : {};
}

/**
 * Reads every task item in a Tiptap document, keeping the path needed to find
 * the same checkbox again. Task items nested inside other blocks are included;
 * items without any text are skipped because they cannot be acted on.
 */
export function focusTasks(
  contentJson: unknown,
  pageId: string,
  pageTitle: string,
  limit = FOCUS_TASK_LIMIT,
): FocusTask[] {
  const tasks: FocusTask[] = [];
  if (!contentJson || typeof contentJson !== "object" || limit <= 0) return tasks;

  const visit = (node: JsonNode, path: number[]) => {
    if (tasks.length >= limit) return;

    if (node.type === "taskItem") {
      const text = nodeText(node).replace(/\s+/g, " ").trim();
      if (text) tasks.push({ pageId, pageTitle, path, text, checked: nodeAttrs(node).checked === true });
    }

    if (!Array.isArray(node.content)) return;
    node.content.forEach((child, index) => {
      if (child && typeof child === "object") visit(child as JsonNode, [...path, index]);
    });
  };

  const root = contentJson as JsonNode;
  if (Array.isArray(root.content)) {
    root.content.forEach((child, index) => {
      if (child && typeof child === "object") visit(child as JsonNode, [index]);
    });
  }

  return tasks;
}

/**
 * Returns a copy of the document with one task's checked attribute changed, or
 * null when the path no longer names a task item. The caller's document is left
 * untouched so a failed save cannot leave a half-applied edit behind.
 */
export function toggleTaskInDocument(
  contentJson: unknown,
  path: readonly number[],
  checked: boolean,
): Record<string, unknown> | null {
  if (!contentJson || typeof contentJson !== "object" || path.length === 0) return null;

  const next = JSON.parse(JSON.stringify(contentJson)) as JsonNode;
  let node: JsonNode = next;

  for (const index of path) {
    if (!Array.isArray(node.content) || !Number.isInteger(index) || index < 0) return null;
    const child = node.content[index];
    if (!child || typeof child !== "object") return null;
    node = child as JsonNode;
  }

  if (node.type !== "taskItem") return null;
  node.attrs = { ...nodeAttrs(node), checked };

  return next as Record<string, unknown>;
}

export type TaskCompletionChange = { text: string; checked: boolean };

function checkedCounts(contentJson: unknown): Map<string, { checked: number; total: number }> {
  const counts = new Map<string, { checked: number; total: number }>();

  for (const task of focusTasks(contentJson, "", "")) {
    const entry = counts.get(task.text) ?? { checked: 0, total: 0 };
    entry.total += 1;
    if (task.checked) entry.checked += 1;
    counts.set(task.text, entry);
  }

  return counts;
}

/**
 * Task check-offs made in the editor, found by diffing the saved document
 * against the previous save. Tasks are compared by text rather than by path so
 * inserting a block above a task list does not look like a different task.
 * Deleting a finished task leaves its history alone: the work was still done.
 */
export function taskCompletionChanges(
  previousJson: unknown,
  nextJson: unknown,
): TaskCompletionChange[] {
  const before = checkedCounts(previousJson);
  const after = checkedCounts(nextJson);
  const changes: TaskCompletionChange[] = [];

  for (const [text, next] of after) {
    const previous = before.get(text);
    const delta = next.checked - (previous?.checked ?? 0);
    if (delta > 0) changes.push({ text, checked: true });
    else if (delta < 0) changes.push({ text, checked: false });
  }

  return changes;
}

export function focusTaskProgress(tasks: readonly Pick<FocusTask, "checked">[]): FocusProgress {
  const total = tasks.length;
  const done = tasks.filter((task) => task.checked).length;

  return {
    total,
    done,
    open: total - done,
    percent: total === 0 ? 0 : Math.round((done / total) * 100),
  };
}
