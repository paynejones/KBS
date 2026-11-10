export const READING_KINDS = ["article", "book"] as const;
export type ReadingKind = (typeof READING_KINDS)[number];

export const READING_STATUSES = ["to-read", "reading", "finished"] as const;
export type ReadingStatus = (typeof READING_STATUSES)[number];

export const READING_STATUS_LABELS: Record<ReadingStatus, string> = {
  "to-read": "To read",
  reading: "Reading",
  finished: "Finished",
};

export const READING_KIND_LABELS: Record<ReadingKind, string> = {
  article: "Article",
  book: "Book",
};

export type ReadingHighlight = {
  id: string;
  text: string;
  note: string;
  createdAt: string;
};

export type ReadingItem = {
  id: string;
  pageId: string;
  title: string;
  kind: ReadingKind;
  status: ReadingStatus;
  author: string;
  url: string | null;
  updatedAt: string;
  highlights: ReadingHighlight[];
};

export function isReadingKind(value: unknown): value is ReadingKind {
  return typeof value === "string" && (READING_KINDS as readonly string[]).includes(value);
}

export function isReadingStatus(value: unknown): value is ReadingStatus {
  return typeof value === "string" && (READING_STATUSES as readonly string[]).includes(value);
}

/** A link is optional, but when given it must be a usable web address. */
export type ReadingUrlResult = { ok: true; url: string | null } | { ok: false };

export function normalizeReadingUrl(value: string | null | undefined): ReadingUrlResult {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return { ok: true, url: null };

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { ok: false };
    return { ok: true, url: parsed.toString() };
  } catch {
    return { ok: false };
  }
}

/** The site an article came from, without the noise of a full URL. */
export function readingSourceLabel(url: string | null): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return url;
  }
}

export function readingStatusCounts(
  items: readonly Pick<ReadingItem, "status">[],
): Record<ReadingStatus, number> {
  const counts: Record<ReadingStatus, number> = { "to-read": 0, reading: 0, finished: 0 };
  for (const item of items) counts[item.status] += 1;
  return counts;
}
