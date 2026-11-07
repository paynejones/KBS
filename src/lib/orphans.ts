export type OrphanPageFacts = {
  id: string;
  title: string;
  updatedAt: Date;
  parentId: string | null;
  childCount: number;
  tagCount: number;
  pageLinkCount: number;
  recordLinkCount: number;
};

export type OrphanRecordFacts = {
  id: string;
  title: string;
  updatedAt: Date;
  databaseId: string;
  databaseName: string;
  relationCount: number;
  pageLinkCount: number;
};

export type OrphanPage = {
  id: string;
  title: string;
  updatedAt: Date;
};

export type OrphanRecord = OrphanPage & {
  databaseId: string;
  databaseName: string;
};

/**
 * A page counts as connected when it sits in the tree (a parent or a child), is
 * tagged, or is joined to another page or a record in either direction.
 * Favorites are a preference rather than a connection, so they do not count.
 */
export function isOrphanPage(facts: OrphanPageFacts): boolean {
  return (
    facts.parentId === null &&
    facts.childCount === 0 &&
    facts.tagCount === 0 &&
    facts.pageLinkCount === 0 &&
    facts.recordLinkCount === 0
  );
}

/**
 * A record counts as connected when a relation property points at it or away
 * from it, or when a page links to it. Its own page is not a connection.
 */
export function isOrphanRecord(facts: OrphanRecordFacts): boolean {
  return facts.relationCount === 0 && facts.pageLinkCount === 0;
}

function newestFirst(
  left: { updatedAt: Date; title: string },
  right: { updatedAt: Date; title: string },
): number {
  const delta = right.updatedAt.getTime() - left.updatedAt.getTime();
  if (delta !== 0) return delta;
  return left.title.localeCompare(right.title, undefined, { sensitivity: "base" });
}

export function findOrphanPages(facts: OrphanPageFacts[]): OrphanPage[] {
  return facts
    .filter(isOrphanPage)
    .map(({ id, title, updatedAt }) => ({ id, title, updatedAt }))
    .sort(newestFirst);
}

export function findOrphanRecords(facts: OrphanRecordFacts[]): OrphanRecord[] {
  return facts
    .filter(isOrphanRecord)
    .map(({ id, title, updatedAt, databaseId, databaseName }) => ({
      id,
      title,
      updatedAt,
      databaseId,
      databaseName,
    }))
    .sort(newestFirst);
}
