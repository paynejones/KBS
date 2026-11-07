import assert from "node:assert/strict";
import { test } from "node:test";
import { clampEditorPopover } from "../src/lib/editor-popover";

const desktop = { width: 1024, height: 768 };

test("a menu anchored mid-page opens below the caret", () => {
  assert.deepEqual(
    clampEditorPopover({ x: 240, y: 180 }, { width: 320, height: 320 }, desktop),
    { left: 240, top: 180, width: 320, maxHeight: 320 },
  );
});

test("a menu near the bottom edge flips above the caret", () => {
  const placement = clampEditorPopover({ x: 100, y: 700 }, { width: 320, height: 240 }, desktop);

  assert.equal(placement.top, 454, "opens above the caret instead of below the fold");
  assert.equal(placement.top + placement.maxHeight <= desktop.height, true);
});

test("a menu near the right edge pulls back inside the viewport", () => {
  const placement = clampEditorPopover({ x: 1000, y: 100 }, { width: 320, height: 240 }, desktop);

  assert.equal(placement.left, 696);
  assert.equal(placement.left + placement.width <= desktop.width - 8, true);
});

test("a narrow viewport shrinks the menu so it still fits", () => {
  const placement = clampEditorPopover(
    { x: 300, y: 60 },
    { width: 320, height: 320 },
    { width: 300, height: 640 },
  );

  assert.equal(placement.width, 284);
  assert.equal(placement.left, 8);
  assert.equal(placement.left + placement.width, 292);
});

test("a short viewport caps the menu height and keeps it on screen", () => {
  const placement = clampEditorPopover(
    { x: 20, y: 140 },
    { width: 320, height: 320 },
    { width: 390, height: 300 },
  );

  assert.equal(placement.maxHeight, 284);
  assert.equal(placement.top, 8);
  assert.equal(placement.top + placement.maxHeight, 292);
  assert.equal(placement.top + placement.maxHeight <= 300, true);
});

test("an extreme viewport never yields a negative size or off-screen top", () => {
  const placement = clampEditorPopover(
    { x: 10, y: 20 },
    { width: 320, height: 320 },
    { width: 8, height: 8 },
  );

  assert.equal(placement.width, 0);
  assert.equal(placement.maxHeight, 0);
  assert.equal(placement.left, 8);
  assert.equal(placement.top, 8);
});
