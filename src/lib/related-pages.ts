/**
 * Scores pages that might belong together based on connections the workspace
 * already records: shared tags, pages both link to, and database records both
 * are linked to. Every suggestion carries the reasons behind it so the user can
 * judge the hint instead of trusting an opaque score.
 */

export type RelatedSignals = {
  /** Tag names shared with the page being viewed. */
  tags: string[];
  /** Pages that both this page and the candidate link to. */
  pageLinks: { id: string; title: string }[];
  /** Records that both this page and the candidate are linked to. */
  records: { id: string; title: string; databaseName: string }[];
};

export type RelatedPageCandidate = {
  id: string;
  title: string;
  signals: RelatedSignals;
};

export type RelatedPageSuggestion = {
  id: string;
  title: string;
  score: number;
  reasons: string[];
};

// A shared record is a stronger signal than a shared link, which in turn beats
// a shared tag: records are deliberate, links are usually deliberate, and tags
// are broad labels.
const TAG_WEIGHT = 2;
const PAGE_LINK_WEIGHT = 3;
const RECORD_WEIGHT = 4;

function quote(title: string): string {
  return `“${title || "Untitled"}”`;
}

/** "“A”", "“A” and “B”", or "“A”, “B” and 3 more". */
function summarizeTitles(titles: string[]): string {
  const unique = [...new Set(titles.map((title) => title || "Untitled"))];
  if (unique.length === 1) return quote(unique[0]);
  if (unique.length === 2) return `${quote(unique[0])} and ${quote(unique[1])}`;
  return `${quote(unique[0])}, ${quote(unique[1])} and ${unique.length - 2} more`;
}

/** "a, b and c", capped so a broad tag overlap stays readable. */
function summarizeNames(names: string[]): string {
  const shown = names.slice(0, 3);
  const remaining = names.length - shown.length;
  return remaining > 0 ? `${shown.join(", ")} and ${remaining} more` : shown.join(", ");
}

/** "“Ep 1” in Anime", or several of them when they span databases. */
function summarizeRecords(records: RelatedSignals["records"]): string {
  const labels = [...new Set(records.map((record) => `${quote(record.title)} in ${record.databaseName}`))];
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels[0]}, ${labels[1]} and ${labels.length - 2} more`;
}

export function describeRelatedSignals(signals: RelatedSignals): {
  score: number;
  reasons: string[];
} {
  const tagNames = [...new Set(signals.tags.map((tag) => tag.trim()).filter(Boolean))].sort();
  const reasons: string[] = [];
  let score = 0;

  // Strongest first, so the first line of a suggestion is its best argument.
  if (signals.records.length > 0) {
    score += signals.records.length * RECORD_WEIGHT;
    reasons.push(`Both connected to ${summarizeRecords(signals.records)}`);
  }
  if (signals.pageLinks.length > 0) {
    score += signals.pageLinks.length * PAGE_LINK_WEIGHT;
    reasons.push(`Both link to ${summarizeTitles(signals.pageLinks.map((link) => link.title))}`);
  }
  if (tagNames.length > 0) {
    score += tagNames.length * TAG_WEIGHT;
    reasons.push(
      `Shares ${tagNames.length} tag${tagNames.length === 1 ? "" : "s"}: ${summarizeNames(tagNames)}`,
    );
  }

  return { score, reasons };
}

/**
 * Ranks candidates by signal strength, breaking ties by title and then id so
 * the same workspace always produces the same list.
 */
export function rankRelatedPages(
  candidates: readonly RelatedPageCandidate[],
  limit = 5,
): RelatedPageSuggestion[] {
  return candidates
    .map((candidate) => ({
      id: candidate.id,
      title: candidate.title,
      ...describeRelatedSignals(candidate.signals),
    }))
    .filter((suggestion) => suggestion.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.title.localeCompare(b.title) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, Math.max(0, limit));
}
