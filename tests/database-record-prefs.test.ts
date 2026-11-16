import assert from "node:assert/strict";
import test from "node:test";
import {
  hiddenPropertiesStorageKey,
  parseHiddenPropertyIds,
} from "../src/lib/database-record-prefs";

test("hidden property ids are stored per database", () => {
  assert.equal(
    hiddenPropertiesStorageKey("database-1"),
    "kbs:database-hidden-properties:database-1",
  );
});

test("hidden property ids are read defensively", () => {
  assert.deepEqual(parseHiddenPropertyIds(null), []);
  assert.deepEqual(parseHiddenPropertyIds(""), []);
  assert.deepEqual(parseHiddenPropertyIds("not json"), []);
  assert.deepEqual(parseHiddenPropertyIds('{"id":"status"}'), []);
  assert.deepEqual(parseHiddenPropertyIds('["status","status","",2,null,"owner"]'), [
    "status",
    "owner",
  ]);
  assert.equal(
    parseHiddenPropertyIds(
      JSON.stringify(Array.from({ length: 250 }, (_, index) => `property-${index}`)),
    ).length,
    200,
  );
});
