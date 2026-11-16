/**
 * The desktop sidebar collapses to an icon rail. The choice belongs to this
 * browser, like the dashboard layout, so it is cached in a tiny external store
 * that React reads through useSyncExternalStore instead of a server round trip.
 */
export const SIDEBAR_COLLAPSED_STORAGE_KEY = "kbs:sidebar-collapsed";
export const SIDEBAR_COLLAPSED_EVENT = "kbs:sidebar-collapsed-updated";

let cached: boolean | null = null;

function readCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  if (cached !== null) return cached;
  try {
    cached = window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true";
  } catch {
    cached = false;
  }
  return cached;
}

export function getSidebarCollapsedSnapshot(): boolean {
  return readCollapsed();
}

/** The server cannot know a browser preference, so it renders the sidebar open. */
export function getServerSidebarCollapsedSnapshot(): boolean {
  return false;
}

export function subscribeToSidebarCollapsed(onChange: () => void) {
  const handleLocalChange = () => onChange();
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== SIDEBAR_COLLAPSED_STORAGE_KEY) return;
    cached = null;
    onChange();
  };
  window.addEventListener(SIDEBAR_COLLAPSED_EVENT, handleLocalChange);
  window.addEventListener("storage", handleStorage);
  return () => {
    window.removeEventListener(SIDEBAR_COLLAPSED_EVENT, handleLocalChange);
    window.removeEventListener("storage", handleStorage);
  };
}

export function setSidebarCollapsed(collapsed: boolean) {
  cached = collapsed;
  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(collapsed));
  } catch {
    // Private-mode browsers can refuse storage; the rail still toggles.
  }
  window.dispatchEvent(new Event(SIDEBAR_COLLAPSED_EVENT));
}
