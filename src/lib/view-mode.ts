export const VIEW_MODE_PARAM = "mode";

/** A URL-backed view mode keeps the lock shareable and survives reloads. */
export function isViewMode(search: string | URLSearchParams): boolean {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  return params.get(VIEW_MODE_PARAM) === "view";
}

/** Preserves existing query state, such as the selected database view. */
export function viewModeHref(
  pathname: string,
  search: string | URLSearchParams,
  viewMode: boolean,
): string {
  const params = new URLSearchParams(
    typeof search === "string" ? search : search.toString(),
  );

  if (viewMode) params.set(VIEW_MODE_PARAM, "view");
  else params.delete(VIEW_MODE_PARAM);

  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}
