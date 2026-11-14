export { cn } from "cn"

/**
 * A one-line, plain-text excerpt of page content. The listing already strips
 * editor markup and collapses whitespace, so this only decodes the entities
 * that survive and trims the result to a card-width preview.
 */
export function previewText(source: string | null | undefined, limit = 160): string {
  if (!source) return "";

  return source
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}
