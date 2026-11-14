/**
 * The page browser keeps its listing in the address: the page number, the
 * sort, and the filters it was narrowed with, so a reload or a return from an
 * open page lands on the same window of the same search.
 */

/** One screenful of the listing, matching the browser's page size. */
export const LISTING_PAGE_SIZE = 24;

export const LISTING_DEFAULT_SORT = "updated-desc";

/** Orders the listing accepts; anything else falls back to the default. */
const LISTING_SORTS = [
  "updated-desc",
  "updated-asc",
  "created-desc",
  "created-asc",
  "title-asc",
  "title-desc",
] as const;

export type ListingSort = (typeof LISTING_SORTS)[number];

/** A listing window as the address describes it. */
export type ListingSelection = {
  page: number;
  sort: ListingSort | null;
  query: string | null;
  tagId: string | null;
  from: string | null;
  through: string | null;
};

/** A listing window as the controls hold it. */
export type ListingWindow = {
  page: number;
  sort: string;
  query: string;
  tagId: string;
  from: string;
  through: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const QUERY_LENGTH = 200;

export function isListingSort(value: string | null): value is ListingSort {
  return value !== null && (LISTING_SORTS as readonly string[]).includes(value);
}

/** A local calendar day as the date inputs write it, or null when unusable. */
function isListingDay(value: string): boolean {
  if (!DAY_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

/** The listing a URL asks for; unusable values fall back to no filter. */
export function readListingSearch(search: string): ListingSelection {
  const params = new URLSearchParams(search);
  const requestedPage = Number(params.get("page"));
  const sort = params.get("sort");
  const query = (params.get("q") ?? "").trim().slice(0, QUERY_LENGTH);
  const tagId = params.get("tagId") ?? "";
  const from = params.get("from") ?? "";
  const through = params.get("through") ?? "";

  return {
    page: Number.isInteger(requestedPage) && requestedPage > 1 ? requestedPage : 1,
    sort: isListingSort(sort) ? sort : null,
    query: query || null,
    tagId: UUID_PATTERN.test(tagId) ? tagId : null,
    from: isListingDay(from) ? from : null,
    through: isListingDay(through) ? through : null,
  };
}

function setOrDelete(params: URLSearchParams, key: string, value: string): void {
  if (value) params.set(key, value);
  else params.delete(key);
}

/**
 * The query string for a listing window, leaving any other parameter alone.
 * The first page, the default sort and empty filters stay out of the address.
 */
export function listingSearch(search: string, listing: ListingWindow): string {
  const params = new URLSearchParams(search);
  setOrDelete(params, "page", listing.page > 1 ? String(listing.page) : "");
  setOrDelete(params, "sort", listing.sort === LISTING_DEFAULT_SORT ? "" : listing.sort);
  setOrDelete(params, "q", listing.query.trim());
  setOrDelete(params, "tagId", listing.tagId);
  setOrDelete(params, "from", listing.from);
  setOrDelete(params, "through", listing.through);
  const query = params.toString();
  return query ? `?${query}` : "";
}

/** The page number a list offset falls on. */
export function listingPageFor(offset: number, pageSize = LISTING_PAGE_SIZE): number {
  return Math.floor(offset / pageSize) + 1;
}

/** The list offset a page number starts at. */
export function listingOffsetFor(page: number, pageSize = LISTING_PAGE_SIZE): number {
  return (page - 1) * pageSize;
}
