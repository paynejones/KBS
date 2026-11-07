export type SaveState = "loading" | "dirty" | "saving" | "saved" | "error";
export type SaveTone = "muted" | "active" | "success" | "error";
export type SaveStatusView = { label: string; tone: SaveTone };

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** Turns the editor's save state into the short label shown next to the page title. */
export function describeSaveState(
  state: SaveState,
  savedAt: number | null,
  now: number,
): SaveStatusView {
  switch (state) {
    case "loading":
      return { label: "Loading…", tone: "muted" };
    case "dirty":
      return { label: "Unsaved changes", tone: "active" };
    case "saving":
      return { label: "Saving…", tone: "active" };
    case "error":
      return { label: "Save failed", tone: "error" };
    case "saved":
      return {
        label: savedAt ? `Saved ${describeSavedAge(now - savedAt)}` : "Saved",
        tone: "success",
      };
  }
  return { label: "Saved", tone: "success" };
}

/** Human-readable age of the last successful save, kept coarse on purpose. */
export function describeSavedAge(elapsedMs: number): string {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 15_000) return "just now";
  if (elapsedMs < MINUTE) return `${Math.floor(elapsedMs / 1_000)}s ago`;
  if (elapsedMs < HOUR) return `${Math.floor(elapsedMs / MINUTE)}m ago`;
  if (elapsedMs < DAY) return `${Math.floor(elapsedMs / HOUR)}h ago`;
  return "earlier";
}
