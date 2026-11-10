export const SAVED_SEARCH_NAME_LIMIT = 80;
export const SAVED_SEARCH_QUERY_LIMIT = 200;

export type SavedSearchFilters = {
  query: string;
  tagId: string | null;
  favoritesOnly: boolean;
};

export type SavedSearch = SavedSearchFilters & {
  id: string;
  name: string;
  tagName: string | null;
  createdAt: string;
};

/**
 * The page-browser query a saved search runs. Every visit fetches the matching
 * pages again, which is what keeps a collection live instead of a snapshot.
 */
export function savedSearchPageParams(search: SavedSearchFilters): URLSearchParams {
  const params = new URLSearchParams();
  const query = search.query.trim();
  if (query) params.set("q", query);
  if (search.tagId) params.set("tagId", search.tagId);
  if (search.favoritesOnly) params.set("favorite", "true");
  return params;
}

/** A one-line summary of what a collection includes. */
export function describeSavedSearch(
  search: Pick<SavedSearch, "query" | "tagId" | "tagName" | "favoritesOnly">,
): string {
  const parts: string[] = [];
  const query = search.query.trim();

  if (query) parts.push(`“${query}”`);
  if (search.tagId) parts.push(`Tag: ${search.tagName ?? "deleted tag"}`);
  if (search.favoritesOnly) parts.push("Favorites only");

  return parts.length > 0 ? parts.join(" · ") : "Every page";
}
