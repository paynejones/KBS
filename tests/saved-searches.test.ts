import assert from "node:assert/strict";
import test from "node:test";
import { describeSavedSearch, savedSearchPageParams } from "../src/lib/saved-searches";

test("a saved search runs its filters against the page browser", () => {
  const params = savedSearchPageParams({ query: "  habits ", tagId: "tag-1", favoritesOnly: true });

  assert.equal(params.get("q"), "habits");
  assert.equal(params.get("tagId"), "tag-1");
  assert.equal(params.get("favorite"), "true");
});

test("a collection with no filters asks for every page", () => {
  assert.equal(savedSearchPageParams({ query: "  ", tagId: null, favoritesOnly: false }).toString(), "");
});

test("the summary names every filter and survives a deleted tag", () => {
  assert.equal(
    describeSavedSearch({ query: "habits", tagId: "tag-1", tagName: "Work", favoritesOnly: true }),
    "“habits” · Tag: Work · Favorites only",
  );
  assert.equal(
    describeSavedSearch({ query: "", tagId: null, tagName: null, favoritesOnly: false }),
    "Every page",
  );
  assert.equal(
    describeSavedSearch({ query: "", tagId: "tag-gone", tagName: null, favoritesOnly: false }),
    "Tag: deleted tag",
  );
});
