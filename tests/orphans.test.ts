import assert from "node:assert/strict";
import { test } from "node:test";
import {
  findOrphanPages,
  findOrphanRecords,
  isOrphanPage,
  isOrphanRecord,
  type OrphanPageFacts,
  type OrphanRecordFacts,
} from "../src/lib/orphans";

const newest = new Date("2026-11-01T12:00:00Z");
const older = new Date("2026-10-01T12:00:00Z");

function pageFacts(overrides: Partial<OrphanPageFacts> = {}): OrphanPageFacts {
  return {
    id: "page-1",
    title: "Page",
    updatedAt: newest,
    parentId: null,
    childCount: 0,
    tagCount: 0,
    pageLinkCount: 0,
    recordLinkCount: 0,
    ...overrides,
  };
}

function recordFacts(overrides: Partial<OrphanRecordFacts> = {}): OrphanRecordFacts {
  return {
    id: "record-1",
    title: "Record",
    updatedAt: newest,
    databaseId: "database-1",
    databaseName: "Media",
    relationCount: 0,
    pageLinkCount: 0,
    ...overrides,
  };
}

test("an untouched top-level page is unconnected", () => {
  assert.equal(isOrphanPage(pageFacts()), true);
});

test("any hierarchy, tag, or link keeps a page connected", () => {
  assert.equal(isOrphanPage(pageFacts({ parentId: "parent" })), false, "a child page");
  assert.equal(isOrphanPage(pageFacts({ childCount: 2 })), false, "a parent page");
  assert.equal(isOrphanPage(pageFacts({ tagCount: 1 })), false, "a tagged page");
  assert.equal(isOrphanPage(pageFacts({ pageLinkCount: 1 })), false, "a page linked in either direction");
  assert.equal(isOrphanPage(pageFacts({ recordLinkCount: 1 })), false, "a page linked to a record");
});

test("a record is connected by a relation in either direction or a page link", () => {
  assert.equal(isOrphanRecord(recordFacts()), true);
  assert.equal(isOrphanRecord(recordFacts({ relationCount: 1 })), false);
  assert.equal(isOrphanRecord(recordFacts({ pageLinkCount: 1 })), false);
});

test("unconnected pages come back newest first and carry only summary fields", () => {
  const result = findOrphanPages([
    pageFacts({ id: "old", title: "Older", updatedAt: older }),
    pageFacts({ id: "new", title: "Newer", updatedAt: newest }),
    pageFacts({ id: "linked", tagCount: 1 }),
  ]);

  assert.deepEqual(result.map((page) => page.id), ["new", "old"]);
  assert.deepEqual(Object.keys(result[0]).sort(), ["id", "title", "updatedAt"]);
});

test("pages updated at the same time fall back to title order", () => {
  const result = findOrphanPages([
    pageFacts({ id: "b", title: "Beta" }),
    pageFacts({ id: "a", title: "Alpha" }),
  ]);

  assert.deepEqual(result.map((page) => page.title), ["Alpha", "Beta"]);
});

test("unconnected records keep their database and skip connected ones", () => {
  const result = findOrphanRecords([
    recordFacts({ id: "kept", title: "Kept", updatedAt: older }),
    recordFacts({ id: "linked", pageLinkCount: 1 }),
    recordFacts({ id: "related", relationCount: 3 }),
  ]);

  assert.deepEqual(result.map((record) => record.id), ["kept"]);
  assert.equal(result[0].databaseName, "Media");
  assert.equal(result[0].databaseId, "database-1");
});
