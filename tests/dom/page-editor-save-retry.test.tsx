import "../setup-dom";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PageEditor } from "../../src/components/page-editor";
import { json, type FetchCall } from "./fetch-stub";
import { restorePageEditorFetch, stubPageEditor } from "./page-editor-stub";
import { withAppRouter } from "./app-router";

const PAGE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SERVER_UPDATED_AT = "2026-01-01T00:00:00.000Z";

const serverPage = {
  id: PAGE_ID,
  title: "Draft page",
  content: "Roadmap",
  contentJson: {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "Roadmap" }] }],
  },
  parentId: null,
  isFavorite: false,
  icon: null,
  coverImageUrl: null,
  updatedAt: SERVER_UPDATED_AT,
  createdAt: SERVER_UPDATED_AT,
};

const recoveredDraft = {
  content: "Recovered text",
  contentJson: {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "Recovered text" }] }],
  },
  revision: 3,
  savedAt: Date.parse("2026-06-01T00:00:00.000Z"),
};

function pageSaves(calls: FetchCall[]) {
  return calls.filter(
    (call) => call.method === "PATCH" && call.url === `/api/pages/${PAGE_ID}`,
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  restorePageEditorFetch();
});

test("a failed save comes back on its own after a delay and stops once it succeeds", async () => {
  // Recovering a draft edits the document, which schedules the autosave.
  localStorage.setItem(`kbs:page-draft:${PAGE_ID}`, JSON.stringify(recoveredDraft));

  let failedOnce = false;
  const calls = stubPageEditor({
    page: serverPage,
    route: (call) => {
      if (call.url === `/api/pages/${PAGE_ID}` && call.method === "PATCH" && !failedOnce) {
        failedOnce = true;
        return json({ error: "the database is unavailable" }, 500);
      }
      return undefined;
    },
  });

  render(withAppRouter(<PageEditor id={PAGE_ID} />));

  const recover = await screen.findByRole("button", { name: "Recover draft" });
  await act(async () => {
    fireEvent.click(recover);
  });

  const retryButton = await screen.findByText("Retry save", undefined, { timeout: 4000 });
  assert.ok(retryButton, "the failure is reported with a manual retry");
  const afterFailure = pageSaves(calls).length;
  assert.ok(afterFailure > 0, "the first save reached the server");

  // The retry waits instead of spinning: nothing is sent right after the failure.
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(pageSaves(calls).length, afterFailure, "a failed save does not loop");

  await waitFor(() => assert.ok(pageSaves(calls).length > afterFailure), {
    timeout: 4000,
  });

  const body = pageSaves(calls).at(-1)?.body as { content?: string } | undefined;
  assert.equal(body?.content, "Recovered text", "the retry saves the unsaved content");

  await waitFor(() => assert.equal(screen.queryByText("Retry save"), null), {
    timeout: 4000,
  });

  const afterSuccess = pageSaves(calls).length;
  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.equal(
    pageSaves(calls).length,
    afterSuccess,
    "a successful retry stops further attempts",
  );
});
