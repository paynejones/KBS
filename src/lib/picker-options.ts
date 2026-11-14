/**
 * Shared rules for the connection pickers. A picker shows one screenful of
 * titles and asks for a narrower search beyond that; it used to answer with
 * every page or record in the workspace.
 */

/** How many picker rows a request returns before asking for a narrower search. */
export const PICKER_OPTION_LIMIT = 20;

/** A picker search is a title fragment, not a query language. */
const PICKER_QUERY_LENGTH = 100;

/** The trimmed search in `?q=`, or null when the picker is unfiltered. */
export function pickerQuery(request: Request): string | null {
  const raw = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (!raw) return null;
  return raw.slice(0, PICKER_QUERY_LENGTH);
}

/** A LIKE pattern for a picker search, with its own wildcards escaped. */
export function pickerPattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}
