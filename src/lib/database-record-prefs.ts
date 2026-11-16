/**
 * Entry-page property visibility is a reading choice, not shared database
 * metadata, so it is kept per database in this browser like the view-tab
 * preferences.
 */
const HIDDEN_PROPERTIES_PREFIX = "kbs:database-hidden-properties:";
const MAX_HIDDEN_PROPERTIES = 200;

export function hiddenPropertiesStorageKey(databaseId: string): string {
  return `${HIDDEN_PROPERTIES_PREFIX}${databaseId}`;
}

/** Stored ids are untrusted, so blanks, duplicates, and wrong types are dropped. */
export function parseHiddenPropertyIds(raw: string | null | undefined): string[] {
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const ids: string[] = [];
  const seen = new Set<string>();
  for (const entry of parsed) {
    if (typeof entry !== "string" || !entry || seen.has(entry)) continue;
    seen.add(entry);
    ids.push(entry);
    if (ids.length >= MAX_HIDDEN_PROPERTIES) break;
  }
  return ids;
}

export function readHiddenPropertyIds(databaseId: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    return parseHiddenPropertyIds(window.localStorage.getItem(hiddenPropertiesStorageKey(databaseId)));
  } catch {
    return [];
  }
}

export function writeHiddenPropertyIds(databaseId: string, propertyIds: string[]): string[] {
  const ids = parseHiddenPropertyIds(JSON.stringify(propertyIds));
  try {
    if (ids.length > 0) {
      window.localStorage.setItem(hiddenPropertiesStorageKey(databaseId), JSON.stringify(ids));
    } else {
      window.localStorage.removeItem(hiddenPropertiesStorageKey(databaseId));
    }
  } catch {
    // The entry page still updates for this visit.
  }
  return ids;
}

export function setPropertyHidden(
  databaseId: string,
  propertyId: string,
  hidden: boolean,
): string[] {
  const current = readHiddenPropertyIds(databaseId);
  const next = hidden
    ? [...current, propertyId]
    : current.filter((id) => id !== propertyId);
  return writeHiddenPropertyIds(databaseId, next);
}
