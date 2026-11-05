export type PageHierarchyRow = {
  id: string;
  parentId: string | null;
  deletedAt?: Date | string | null;
  title?: string;
};

export function isTrashed(page: { deletedAt?: Date | string | null }) {
  return Boolean(page.deletedAt);
}

/**
 * Returns the page and every descendant beneath it. Trashing or restoring a
 * page always moves its whole subtree so child pages are never orphaned.
 */
export function collectSubtreeIds(pages: PageHierarchyRow[], rootId: string): string[] {
  const ids = new Set([rootId]);
  let added = true;

  while (added) {
    added = false;
    for (const page of pages) {
      if (page.parentId && ids.has(page.parentId) && !ids.has(page.id)) {
        ids.add(page.id);
        added = true;
      }
    }
  }

  return Array.from(ids);
}

/** Trashed pages whose parent is not trashed, so the trash list shows one row per removed subtree. */
export function trashedRoots(pages: PageHierarchyRow[]): PageHierarchyRow[] {
  const trashed = new Map(pages.filter(isTrashed).map((page) => [page.id, page]));

  return Array.from(trashed.values()).filter(
    (page) => !page.parentId || !trashed.has(page.parentId),
  );
}

export function descendantCount(pages: PageHierarchyRow[], rootId: string) {
  return Math.max(0, collectSubtreeIds(pages, rootId).length - 1);
}
