import "../setup-dom";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PageEditor } from "../../src/components/page-editor";
import { json, type FetchCall } from "./fetch-stub";
import { restorePageEditorFetch, stubPageEditor } from "./page-editor-stub";

const PAGE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const UPDATED_AT = "2026-01-01T00:00:00.000Z";

function serverPage(selectedText: string | null) {
  return {
    id: PAGE_ID,
    title: "Saved article",
    content: "Notes from the article",
    contentJson: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Notes from the article" }] },
      ],
    },
    parentId: null,
    isFavorite: false,
    icon: null,
    coverImageUrl: null,
    selectedText,
    updatedAt: UPDATED_AT,
    createdAt: UPDATED_AT,
  };
}

function pagePatches(calls: FetchCall[]) {
  return calls.filter(
    (call) => call.method === "PATCH" && call.url === `/api/pages/${PAGE_ID}`,
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  restorePageEditorFetch();
});

test("PageEditor opens with the passage captured from its source", async () => {
  stubPageEditor({ page: serverPage("A passage worth keeping.") });

  render(<PageEditor id={PAGE_ID} />);

  const quote = await screen.findByText("A passage worth keeping.");
  assert.equal(
    quote.closest("blockquote")?.getAttribute("aria-label"),
    "Quoted passage from the saved link",
    "the quote is presented as the captured passage, above the page body",
  );
});

test("PageEditor shows no quote for a page captured without one", async () => {
  stubPageEditor({ page: serverPage(null) });

  render(<PageEditor id={PAGE_ID} />);

  await screen.findByDisplayValue("Saved article");
  assert.equal(screen.queryByText("A passage worth keeping."), null);
  assert.equal(document.querySelector("blockquote"), null);
});

test("editing the quote saves the correction in place", async () => {
  const calls = stubPageEditor({ page: serverPage("A passage worth keeping.") });

  render(<PageEditor id={PAGE_ID} />);
  await screen.findByText("A passage worth keeping.");

  fireEvent.click(screen.getByRole("button", { name: "Edit quote" }));
  const field = screen.getByLabelText("Quoted passage") as HTMLTextAreaElement;
  assert.equal(field.value, "A passage worth keeping.", "editing starts from the saved passage");

  fireEvent.change(field, { target: { value: "  A corrected passage.  " } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Save quote" }));
  });

  const patches = pagePatches(calls);
  assert.deepEqual(
    patches.at(-1)?.body,
    { selectedText: "A corrected passage." },
    "the correction is saved with its surrounding whitespace trimmed",
  );
  assert.ok(await screen.findByText("A corrected passage."));
  assert.equal(screen.queryByText("A passage worth keeping."), null);
  assert.equal(screen.queryByLabelText("Quoted passage"), null, "the editor closes after saving");
});

test("removing the quote clears it from the page", async () => {
  const calls = stubPageEditor({ page: serverPage("A passage worth keeping.") });

  render(<PageEditor id={PAGE_ID} />);
  await screen.findByText("A passage worth keeping.");

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Remove quote" }));
  });

  assert.deepEqual(pagePatches(calls).at(-1)?.body, { selectedText: null });
  assert.equal(screen.queryByText("A passage worth keeping."), null);
  assert.equal(document.querySelector("blockquote"), null, "the cleared quote leaves no trace");
});

test("a failed quote save keeps the editor open with the draft intact", async () => {
  stubPageEditor({
    page: serverPage("A passage worth keeping."),
    route: (call) =>
      call.url === `/api/pages/${PAGE_ID}` && call.method === "PATCH"
        ? json({ error: "Failed to update page" }, 500)
        : undefined,
  });

  render(<PageEditor id={PAGE_ID} />);
  await screen.findByText("A passage worth keeping.");

  fireEvent.click(screen.getByRole("button", { name: "Edit quote" }));
  fireEvent.change(screen.getByLabelText("Quoted passage"), {
    target: { value: "A correction that cannot be saved." },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Save quote" }));
  });

  assert.equal(
    (screen.getByLabelText("Quoted passage") as HTMLTextAreaElement).value,
    "A correction that cannot be saved.",
    "the draft survives so the correction can be retried",
  );
  assert.ok(await screen.findByText("Save failed. Please try again."));
});
