import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { restorePageEditorFetch, stubPageEditor } from "./page-editor-stub";
import { restoreStrictFetch, stubStrictFetch } from "./strict-fetch-stub";

afterEach(() => {
  restorePageEditorFetch();
});

test("the PageEditor stub fails cleanup for an unhandled endpoint", async () => {
  stubPageEditor({
    page: { id: "page-1", title: "Page", parentId: null },
  });

  const response = await fetch("/api/pages/page-1/unknown");

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: "Unhandled PageEditor request: GET /api/pages/page-1/unknown",
  });
  assert.throws(
    () => restorePageEditorFetch(),
    (error: unknown) =>
      error instanceof Error &&
      error.message ===
        "PageEditor made unhandled requests:\nGET /api/pages/page-1/unknown",
    "cleanup reports the request that would otherwise fall through",
  );
});

test("cleanup reports unhandled requests from every active strict stub", async () => {
  stubStrictFetch("FirstPanel", () => undefined);
  const first = await fetch("/api/first/unknown");

  stubStrictFetch("SecondPanel", () => undefined);
  const second = await fetch("/api/second/unknown");

  assert.equal(first.status, 500);
  assert.equal(second.status, 500);
  assert.throws(
    () => restoreStrictFetch(),
    (error: unknown) =>
      error instanceof Error &&
      error.message ===
        "FirstPanel made unhandled requests:\nGET /api/first/unknown\n\n" +
          "SecondPanel made unhandled requests:\nGET /api/second/unknown",
    "cleanup names every active stub and its unhandled request",
  );
});
