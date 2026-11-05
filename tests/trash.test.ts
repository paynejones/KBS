import assert from "node:assert/strict";
import test from "node:test";
import { attachmentIdsInText } from "../src/lib/media";
import { collectSubtreeIds, descendantCount, trashedRoots } from "../src/lib/trash";

const ROOT = "11111111-1111-4111-8111-111111111111";
const CHILD = "22222222-2222-4222-8222-222222222222";
const GRANDCHILD = "33333333-3333-4333-8333-333333333333";
const SIBLING = "44444444-4444-4444-8444-444444444444";

const hierarchy = [
  { id: ROOT, parentId: null },
  { id: CHILD, parentId: ROOT },
  { id: GRANDCHILD, parentId: CHILD },
  { id: SIBLING, parentId: null },
];

test("trash helpers collect a page together with every descendant", () => {
  assert.deepEqual(collectSubtreeIds(hierarchy, ROOT), [ROOT, CHILD, GRANDCHILD]);
  assert.deepEqual(collectSubtreeIds(hierarchy, SIBLING), [SIBLING]);
  assert.deepEqual(collectSubtreeIds(hierarchy, "missing"), ["missing"]);
  assert.equal(descendantCount(hierarchy, ROOT), 2);
  assert.equal(descendantCount(hierarchy, GRANDCHILD), 0);
});

test("trash helpers ignore cycles and repeated ancestry", () => {
  const cyclic = [
    { id: ROOT, parentId: CHILD },
    { id: CHILD, parentId: ROOT },
  ];
  assert.deepEqual(collectSubtreeIds(cyclic, ROOT), [ROOT, CHILD]);
});

test("trash listing shows one row per trashed subtree", () => {
  const trashed = hierarchy.map((page) => ({
    ...page,
    deletedAt: page.id === SIBLING ? null : new Date("2026-11-01T12:00:00Z"),
  }));

  const roots = trashedRoots(trashed);
  assert.deepEqual(roots.map((page) => page.id), [ROOT]);
  assert.deepEqual(trashedRoots(hierarchy).map((page) => page.id), []);
});

test("trashed roots include pages whose parent is still active", () => {
  const mixed = hierarchy.map((page) => ({
    ...page,
    deletedAt: page.id === CHILD ? new Date("2026-11-01T12:00:00Z") : null,
  }));

  assert.deepEqual(trashedRoots(mixed).map((page) => page.id), [CHILD]);
});

test("attachment references are found in page text and JSON payloads", () => {
  const text = `Image: /api/attachments/${ROOT} and again /api/attachments/${ROOT.toUpperCase()}`;
  assert.deepEqual(attachmentIdsInText(text), [ROOT]);

  const payload = JSON.stringify({
    type: "doc",
    content: [
      {
        type: "image",
        attrs: { src: `/api/attachments/${CHILD}`, alt: "Cover" },
      },
    ],
  });
  assert.deepEqual(attachmentIdsInText(payload), [CHILD]);
});

test("attachment scanning ignores unrelated URLs and empty input", () => {
  assert.deepEqual(attachmentIdsInText(""), []);
  assert.deepEqual(attachmentIdsInText(null), []);
  assert.deepEqual(attachmentIdsInText("https://example.com/api/attachments/not-a-uuid"), []);
  assert.deepEqual(attachmentIdsInText("/api/attachments/123e4567-e89b-12d3-a456-426614174000"), [
    "123e4567-e89b-12d3-a456-426614174000",
  ]);
});
