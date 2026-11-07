import "../setup-dom";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QuickCapture } from "../../src/components/quick-capture";
import { json, restoreFetch, stubFetch } from "./fetch-stub";

afterEach(() => {
  restoreFetch();
  cleanup();
});

async function openCapture() {
  render(<QuickCapture />);
  fireEvent.click(screen.getByRole("button", { name: /Capture/ }));
  await screen.findByRole("dialog", { name: "Quick capture" });
}

test("the selected-text field only appears once a link is present", async () => {
  await openCapture();
  assert.equal(screen.queryByLabelText("Selected text"), null, "a plain note has no quote field");

  fireEvent.change(screen.getByPlaceholderText("Paste a link (optional)"), {
    target: { value: "https://example.com/essay" },
  });

  assert.ok(screen.getByLabelText("Selected text"));
});

test("a capture sends the selected text with its link", async () => {
  const calls = stubFetch(() => json({ id: "page-1" }, 201));
  await openCapture();

  fireEvent.change(screen.getByPlaceholderText("Paste a link (optional)"), {
    target: { value: "https://example.com/essay" },
  });
  fireEvent.change(screen.getByLabelText("Selected text"), {
    target: { value: "A passage worth keeping." },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Capture" }));
  });

  const post = calls.find((call) => call.method === "POST");
  assert.equal(post?.url, "/api/inbox");
  assert.deepEqual(post?.body, {
    title: "",
    content: "",
    sourceUrl: "https://example.com/essay",
    selectedText: "A passage worth keeping.",
  });
  assert.ok(await screen.findByText("Saved to your inbox."));
});

test("a note captured without a link leaves the quote out of the request", async () => {
  const calls = stubFetch(() => json({ id: "page-2" }, 201));
  await openCapture();

  fireEvent.change(screen.getByPlaceholderText("Write a quick note…"), {
    target: { value: "A thought with no source" },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Capture" }));
  });

  const post = calls.find((call) => call.method === "POST");
  assert.ok(post, "the capture was sent");
  assert.deepEqual(post.body, {
    title: "",
    content: "A thought with no source",
    sourceUrl: "",
  });
});
