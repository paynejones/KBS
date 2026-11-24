/**
 * Hiding a database's search, filter, and sort bar is a reading choice, not
 * shared database metadata, so it is kept per database in this browser like
 * the hidden-property preferences.
 */
const SEARCH_FILTERS_HIDDEN_PREFIX = "kbs:database-search-filters-hidden:";
const SEARCH_FILTERS_CHANGED_EVENT = "kbs:database-search-filters-changed";

export function searchFiltersHiddenStorageKey(databaseId: string): string {
  return `${SEARCH_FILTERS_HIDDEN_PREFIX}${databaseId}`;
}

/** Only an explicit "true" hides the bar; anything else reads as shown. */
export function subscribeToSearchFiltersHidden(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  window.addEventListener("storage", onChange);
  window.addEventListener(SEARCH_FILTERS_CHANGED_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(SEARCH_FILTERS_CHANGED_EVENT, onChange);
  };
}

export function readSearchFiltersHidden(databaseId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const value = window.localStorage.getItem(searchFiltersHiddenStorageKey(databaseId));
    return value === "true" || value === "1";
  } catch {
    return false;
  }
}

export function writeSearchFiltersHidden(databaseId: string, hidden: boolean): boolean {
  try {
    if (hidden) {
      window.localStorage.setItem(searchFiltersHiddenStorageKey(databaseId), "true");
    } else {
      window.localStorage.removeItem(searchFiltersHiddenStorageKey(databaseId));
    }
  } catch {
    // The bar still hides for this visit when storage is unavailable.
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(SEARCH_FILTERS_CHANGED_EVENT));
  }
  return hidden;
}
