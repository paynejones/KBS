const DATABASE_DISPLAY_PREFIXES = [
  "kbs:database-view:",
  "kbs:database-hidden-views:",
  "kbs:database-hidden-properties:",
] as const;
const PAGE_DRAFT_PREFIX = "kbs:page-draft:";
const SETTINGS_PREFERENCES_UPDATED_EVENT = "kbs:settings-preferences-updated";

type PreferenceStorage = Pick<Storage, "length" | "key" | "removeItem">;

function browserStorage(): PreferenceStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function matchingKeys(
  storage: PreferenceStorage,
  prefixes: readonly string[],
): string[] {
  const keys: string[] = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key && prefixes.some((prefix) => key.startsWith(prefix))) keys.push(key);
    }
  } catch {
    // Storage can be unavailable in private mode; treat it as empty.
  }
  return keys;
}

function countKeys(prefixes: readonly string[]): number {
  const storage = browserStorage();
  return storage ? matchingKeys(storage, prefixes).length : 0;
}

function removeKeys(prefixes: readonly string[]): number {
  const storage = browserStorage();
  if (!storage) return 0;

  let removed = 0;
  for (const key of matchingKeys(storage, prefixes)) {
    try {
      storage.removeItem(key);
      removed += 1;
    } catch {
      // Keep clearing the remaining keys if one removal fails.
    }
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(SETTINGS_PREFERENCES_UPDATED_EVENT));
  }
  return removed;
}

export function subscribeToSettingsPreferences(onChange: () => void) {
  if (typeof window === "undefined") return () => {};

  window.addEventListener("storage", onChange);
  window.addEventListener(SETTINGS_PREFERENCES_UPDATED_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(SETTINGS_PREFERENCES_UPDATED_EVENT, onChange);
  };
}

export function getDatabaseDisplayPreferencesSnapshot(): number {
  return countDatabaseDisplayPreferences();
}

export function getPageDraftsSnapshot(): number {
  return countPageDrafts();
}

export function getEmptySettingsPreferencesSnapshot(): number {
  return 0;
}

export function countDatabaseDisplayPreferences(): number {
  return countKeys(DATABASE_DISPLAY_PREFIXES);
}

export function clearDatabaseDisplayPreferences(): number {
  return removeKeys(DATABASE_DISPLAY_PREFIXES);
}

export function countPageDrafts(): number {
  return countKeys([PAGE_DRAFT_PREFIX]);
}

export function clearPageDrafts(): number {
  return removeKeys([PAGE_DRAFT_PREFIX]);
}
