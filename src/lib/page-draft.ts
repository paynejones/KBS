export type PageDraft = {
  content: string;
  contentJson: Record<string, unknown>;
  revision: number;
  savedAt: number;
};

export function readRecoverablePageDraft(
  serialized: string | null,
  serverUpdatedAt: string | Date,
): PageDraft | null {
  if (!serialized) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const draft = parsed as Partial<PageDraft>;
  const serverTime = serverUpdatedAt instanceof Date
    ? serverUpdatedAt.getTime()
    : new Date(serverUpdatedAt).getTime();

  if (
    typeof draft.content !== "string" ||
    !draft.contentJson || typeof draft.contentJson !== "object" || Array.isArray(draft.contentJson) || draft.contentJson.type !== "doc" ||
    typeof draft.revision !== "number" || !Number.isSafeInteger(draft.revision) || draft.revision < 1 ||
    typeof draft.savedAt !== "number" || !Number.isFinite(draft.savedAt) ||
    !Number.isFinite(serverTime) || draft.savedAt <= serverTime
  ) {
    return null;
  }

  return draft as PageDraft;
}
