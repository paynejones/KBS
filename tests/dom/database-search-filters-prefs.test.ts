import "../setup-dom";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  readSearchFiltersHidden,
  searchFiltersHiddenStorageKey,
  writeSearchFiltersHidden,
} from "../../src/lib/database-search-filters-prefs";

test("the search and filter bar is hidden per database", () => {
  window.localStorage.clear();

  assert.equal(
    searchFiltersHiddenStorageKey("database-1"),
    "kbs:database-search-filters-hidden:database-1",
  );
  assert.equal(readSearchFiltersHidden("database-1"), false, "shown by default");

  assert.equal(writeSearchFiltersHidden("database-1", true), true);
  assert.equal(readSearchFiltersHidden("database-1"), true);
  assert.equal(
    readSearchFiltersHidden("database-2"),
    false,
    "another database keeps its own bar",
  );

  writeSearchFiltersHidden("database-1", false);
  assert.equal(readSearchFiltersHidden("database-1"), false);
  assert.equal(
    window.localStorage.getItem("kbs:database-search-filters-hidden:database-1"),
    null,
    "showing the bar drops the stored preference",
  );
});

test("a corrupt stored value leaves the bar shown", () => {
  window.localStorage.clear();
  window.localStorage.setItem(
    "kbs:database-search-filters-hidden:database-1",
    "sometimes",
  );

  assert.equal(readSearchFiltersHidden("database-1"), false);
});
