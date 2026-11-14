/**
 * A database record is its page, so a record link opens `/pages/[pageId]`
 * whenever the record payload carries a page. The record route stays the
 * fallback for payloads that only know a record id; it redirects to the page.
 */
export function recordHref(
  databaseId: string,
  recordId: string,
  pageId?: string | null,
) {
  return pageId ? `/pages/${pageId}` : `/databases/${databaseId}/records/${recordId}`;
}
