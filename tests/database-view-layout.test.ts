import assert from "node:assert/strict";
import test from "node:test";
import {
  appendedViewName,
  parseVisibleProperties,
  reorderedViewIds,
  visiblePropertyList,
} from "../src/lib/database-view";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

const properties = [
  { id: A, name: "Status" },
  { id: B, name: "Due" },
  { id: C, name: "Owner" },
];

test("a view shows every property until it saves a choice", () => {
  assert.equal(parseVisibleProperties(undefined), null);
  assert.equal(parseVisibleProperties({}), null);
  assert.equal(parseVisibleProperties({ visibleProperties: "Status" }), null);
  assert.deepEqual(visiblePropertyList(properties, undefined), properties);

  assert.deepEqual(parseVisibleProperties({ visibleProperties: [A, A, 7, "", B] }), [A, B]);
  assert.deepEqual(
    visiblePropertyList(properties, { visibleProperties: [C, A] }),
    [properties[0], properties[2]],
    "saved ids follow database order",
  );
  assert.deepEqual(
    visiblePropertyList(properties, { visibleProperties: [C, "deleted-property"] }),
    [properties[2]],
    "properties that no longer exist are skipped",
  );
  assert.deepEqual(
    visiblePropertyList(properties, { visibleProperties: [] }),
    [],
    "hiding every property is a valid choice",
  );
});

test("a duplicated view gets a bounded copy name", () => {
  assert.equal(appendedViewName("Watchlist"), "Watchlist copy");
  assert.equal(appendedViewName("  "), "View copy");
  assert.equal(appendedViewName("x".repeat(120)).length, 100);
  assert.match(appendedViewName("x".repeat(120)), / copy$/);
});

test("moving a view swaps neighbors and stops at the edges", () => {
  const ids = [A, B, C];

  assert.deepEqual(reorderedViewIds(ids, B, "left"), [B, A, C]);
  assert.deepEqual(reorderedViewIds(ids, B, "right"), [A, C, B]);
  assert.deepEqual(reorderedViewIds(ids, A, "left"), ids);
  assert.deepEqual(reorderedViewIds(ids, C, "right"), ids);
  assert.deepEqual(reorderedViewIds(ids, "missing", "left"), ids);
  assert.deepEqual(ids, [A, B, C], "the original order is never mutated");
});
