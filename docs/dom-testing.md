# DOM testing

Run the DOM component tests with:

```bash
npm run test:dom
```

These tests render client components under `node:test`, jsdom, and Testing Library.

## Stub fetch with explicit routes

Use `stubStrictFetch` from `tests/dom/strict-fetch-stub.ts` whenever a DOM test replaces `fetch`. It wraps the low-level `stubFetch` primitive with a route table. Return a `Response` only for a method and URL the component is expected to call; return `undefined` for everything else.

```tsx
import { afterEach, test } from "node:test";
import { json } from "./fetch-stub";
import { restoreStrictFetch, stubStrictFetch } from "./strict-fetch-stub";

afterEach(() => {
  restoreStrictFetch();
});

test("loads the tags panel", async () => {
  const calls = stubStrictFetch("PageTags", (call) => {
    if (call.url === "/api/tags" && call.method === "GET") {
      return json([{ id: "t1", name: "Ideas" }]);
    }
    if (call.url === "/api/pages/p1/tags" && call.method === "GET") {
      return json([]);
    }
    return undefined;
  });

  // render and assert against the component; `calls` holds the request log.
});
```

Rules for a strict stub:

- Match both `call.method` and `call.url`. When query values vary, compare `call.url.split("?")[0]` and assert the parameters separately.
- Return `undefined` for anything not recognized. Do not add a catch-all `{ ok: true }` response.
- Call `restoreStrictFetch()` in `afterEach`, not `restoreFetch()` directly.
- A test may start more than one strict stub. Cleanup reports every unhandled request, grouped by its label.
- Assert request bodies and methods against the returned `calls` array.

An unhandled request returns a visible 500 response and fails cleanup with the label, method, and URL. This is deliberate: when a component starts calling a new endpoint, the test should fail loudly instead of silently receiving a generic success response.

## Component-specific stubs

`stubPageEditor` in `tests/dom/page-editor-stub.ts` provides the default route table for `PageEditor` and its child panels. Use it in PageEditor tests and call `restorePageEditorFetch()` during cleanup.

Add a new default route only when `PageEditor` or one of its children genuinely calls that endpoint. Otherwise use the `route` override for a single test:

```tsx
const calls = stubPageEditor({
  page,
  route: (call) =>
    call.url === `/api/pages/${page.id}` && call.method === "PATCH"
      ? json({ error: "Failed to update page" }, 500)
      : undefined,
});
```

## Low-level helper

`tests/dom/fetch-stub.ts` remains the low-level primitive. New component tests should use `stubStrictFetch` or a component-specific wrapper rather than calling `stubFetch` directly. ESLint enforces this under `tests/dom`: importing `stubFetch` from `./fetch-stub` is an error outside the strict wrapper itself.

ESLint also requires every DOM test file that calls `stubStrictFetch` or `stubPageEditor` to call `restoreStrictFetch()` or `restorePageEditorFetch()` inside `afterEach`. That keeps an unhandled request from being lost when a test ends.
