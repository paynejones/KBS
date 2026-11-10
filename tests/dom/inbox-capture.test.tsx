import "../setup-dom";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QuickCapture } from "../../src/components/quick-capture";
import { json } from "./fetch-stub";
import { restoreStrictFetch, stubStrictFetch } from "./strict-fetch-stub";

afterEach(() => {
  cleanup();
  restoreStrictFetch();
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
  const calls = stubStrictFetch("QuickCapture", (call) =>
    call.url === "/api/inbox" && call.method === "POST"
      ? json({ id: "page-1" }, 201)
      : undefined,
  );
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

test("a captured file is uploaded before the inbox item is saved", async () => {
  const attachmentId = "33333333-3333-4333-8333-333333333333";
  const calls = stubStrictFetch("QuickCapture", (call) => {
    if (call.url === "/api/attachments" && call.method === "POST") {
      return json({ id: attachmentId, url: `/api/attachments/${attachmentId}`, filename: "syllabus.pdf", mimeType: "application/pdf", size: 3 }, 201);
    }
    if (call.url === "/api/inbox" && call.method === "POST") {
      return json({ id: "page-3" }, 201);
    }
    return undefined;
  });
  await openCapture();

  const file = new File([new Uint8Array([1, 2, 3])], "syllabus.pdf", { type: "application/pdf" });
  fireEvent.change(screen.getByLabelText("Attach an image or PDF"), { target: { files: [file] } });
  assert.equal(screen.getByText("syllabus.pdf", { selector: "span" }).textContent, "syllabus.pdf");

  const capture = screen.getByRole("button", { name: "Capture" });
  assert.equal((capture as HTMLButtonElement).disabled, false, "a file alone is enough to capture");

  await act(async () => {
    fireEvent.click(capture);
  });

  const upload = calls.find((call) => call.url === "/api/attachments");
  assert.equal(upload?.method, "POST");
  const post = calls.find((call) => call.url === "/api/inbox");
  assert.equal(post?.method, "POST");
  assert.deepEqual(post?.body, {
    title: "",
    content: "",
    sourceUrl: "",
    attachmentId,
  });
  assert.ok(await screen.findByText("Saved to your inbox."));
});

test("a file type the attachment route rejects never reaches the upload", async () => {
  const calls = stubStrictFetch("QuickCapture", (call) =>
    call.url === "/api/inbox" && call.method === "POST"
      ? json({ id: "page-4" }, 201)
      : undefined,
  );
  await openCapture();

  const file = new File([new Uint8Array([1, 2, 3])], "notes.txt", { type: "text/plain" });
  fireEvent.change(screen.getByLabelText("Attach an image or PDF"), { target: { files: [file] } });

  assert.ok(screen.getByRole("alert").textContent?.includes("Choose an image or a PDF."));
  assert.equal(screen.queryByLabelText("Remove attached file"), null, "the rejected file is not kept");
  assert.equal((screen.getByRole("button", { name: "Capture" }) as HTMLButtonElement).disabled, true);
  assert.equal(calls.length, 0);
});

test("a note captured without a link leaves the quote out of the request", async () => {
  const calls = stubStrictFetch("QuickCapture", (call) =>
    call.url === "/api/inbox" && call.method === "POST"
      ? json({ id: "page-2" }, 201)
      : undefined,
  );
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
