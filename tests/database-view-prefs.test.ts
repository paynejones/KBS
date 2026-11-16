import assert from "node:assert/strict";
import test from "node:test";
import {
  chooseInitialViewId,
  parseHiddenViewIds,
} from "../src/lib/database-view-prefs";

const views = [
  { id: "all", type: "table" },
  { id: "board", type: "board" },
  { id: "gallery", type: "gallery" },
];

test("a database page restores the view this browser last used", () => {
  assert.equal(chooseInitialViewId(views, { rememberedId: "gallery" }), "gallery");
  assert.equal(chooseInitialViewId(views, { rememberedId: "missing" }), "all");
  assert.equal(chooseInitialViewId(views, {}), "all");
  assert.equal(chooseInitialViewId([], { rememberedId: "gallery" }), "");
});

test("an explicit view link wins and hidden views are skipped", () => {
  assert.equal(
    chooseInitialViewId(views, { requestedId: "board", rememberedId: "gallery" }),
    "board",
  );
  assert.equal(
    chooseInitialViewId(views, { rememberedId: "gallery", hiddenIds: ["gallery"] }),
    "all",
  );
  assert.equal(
    chooseInitialViewId(views, { rememberedId: "all", hiddenIds: ["all"] }),
    "board",
  );
  assert.equal(
    chooseInitialViewId(views, { requestedId: "gallery", hiddenIds: ["gallery"] }),
    "gallery",
  );
});

test("hidden view ids are read defensively", () => {
  assert.deepEqual(parseHiddenViewIds(null), []);
  assert.deepEqual(parseHiddenViewIds(""), []);
  assert.deepEqual(parseHiddenViewIds("not json"), []);
  assert.deepEqual(parseHiddenViewIds('{"id":"board"}'), []);
  assert.deepEqual(parseHiddenViewIds('["board","board","",2,null,"gallery"]'), [
    "board",
    "gallery",
  ]);
  assert.equal(
    parseHiddenViewIds(JSON.stringify(Array.from({ length: 120 }, (_, index) => `view-${index}`))).length,
    100,
  );
});
