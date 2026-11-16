import "../setup-dom";
import assert from "node:assert/strict";
import test from "node:test";
import {
  clearDatabaseDisplayPreferences,
  clearPageDrafts,
  countDatabaseDisplayPreferences,
  countPageDrafts,
} from "../../src/lib/settings-preferences";

test("Settings clears only database display and draft keys", () => {
  window.localStorage.clear();
  window.localStorage.setItem("kbs:database-view:database-1", "view-1");
  window.localStorage.setItem("kbs:database-hidden-views:database-1", "[]");
  window.localStorage.setItem("kbs:database-hidden-properties:database-1", "[]");
  window.localStorage.setItem("kbs:page-draft:page-1", "{}");
  window.localStorage.setItem("kbs:page-draft:page-2", "{}");
  window.localStorage.setItem("kbs:theme", "dark");
  window.localStorage.setItem("kbs:navigation", "{}");

  assert.equal(countDatabaseDisplayPreferences(), 3);
  assert.equal(countPageDrafts(), 2);

  assert.equal(clearDatabaseDisplayPreferences(), 3);
  assert.equal(clearPageDrafts(), 2);

  assert.equal(window.localStorage.getItem("kbs:database-view:database-1"), null);
  assert.equal(
    window.localStorage.getItem("kbs:database-hidden-views:database-1"),
    null,
  );
  assert.equal(
    window.localStorage.getItem("kbs:database-hidden-properties:database-1"),
    null,
  );
  assert.equal(window.localStorage.getItem("kbs:page-draft:page-1"), null);
  assert.equal(window.localStorage.getItem("kbs:page-draft:page-2"), null);
  assert.equal(window.localStorage.getItem("kbs:theme"), "dark");
  assert.equal(window.localStorage.getItem("kbs:navigation"), "{}");
});
