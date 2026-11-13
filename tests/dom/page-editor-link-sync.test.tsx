import "../setup-dom";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PageEditor } from "../../src/components/page-editor";
import { json } from "./fetch-stub";
import { restorePageEditorFetch, stubPageEditor } from "./page-editor-stub";
import { withAppRouter } from "./app-router";

const PAGE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TARGET_ID = "11111111-1111-4111-8111-111111111111";

const SERVER_UPDATED_AT = "2026-01-01T00:00:00.000Z";

const serverPage = {
  id: PAGE_ID,
  title: "Draft page",
  content: "Roadmap",
  contentJson: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Roadmap",
            marks: [{ type: "link", attrs: { href: `/pages/${TARGET_ID}` } }],
          },
        ],
      },
    ],
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

afterEach(() => {
  cleanup();
  localStorage.clear();
  restorePageEditorFetch();
});

test("PageEditor reports a failed background connection sync without blocking", async () => {
  // A draft is offered after loading; recovering it drops the page link from the
  // document, which is the background sync losing its connection.
  localStorage.setItem(`kbs:page-draft:${PAGE_ID}`, JSON.stringify(recoveredDraft));

  const calls = stubPageEditor({
    page: serverPage,
    pages: [
      { id: PAGE_ID, title: "Draft page", parentId: null },
      { id: TARGET_ID, title: "Roadmap", parentId: null },
    ],
    route: (call) =>
      call.url === `/api/pages/${PAGE_ID}/links` && call.method === "DELETE"
        ? json({ error: "the connection could not be removed" }, 500)
        : undefined,
  });

  render(withAppRouter(<PageEditor id={PAGE_ID} />));

  const recover = await screen.findByRole("button", { name: "Recover draft" });
  await act(async () => {
    fireEvent.click(recover);
  });

  const deletion = calls.find(
    (call) => call.method === "DELETE" && call.url === `/api/pages/${PAGE_ID}/links`,
  );
  assert.deepEqual(
    deletion?.body,
    { targetPageId: TARGET_ID, origin: "inline" },
    "the editor syncs the connection the recovered draft no longer links",
  );

  assert.ok(
    calls.every((call) => !call.url.includes("includeRecordPages")),
    "page pickers load the filtered list so record pages cannot be chosen",
  );

  const notice = await screen.findByText(
    "A page connection could not be updated, so linked pages may be out of date.",
  );
  assert.equal(notice.getAttribute("role"), "status", "the failure is announced politely");
  assert.equal(
    screen.queryByText("Retry save"),
    null,
    "a connection sync failure does not take over the save error state",
  );
});
