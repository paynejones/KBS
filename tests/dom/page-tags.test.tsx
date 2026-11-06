import "../setup-dom";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PageTags } from "../../src/components/page-tags";
import { json, restoreFetch, stubFetch } from "./fetch-stub";

type Tag = { id: string; name: string };

afterEach(() => {
  restoreFetch();
  cleanup();
});

test("PageTags shows assigned tags and offers only unassigned ones", async () => {
  const calls = stubFetch((call) =>
    call.url === "/api/tags"
      ? json([{ id: "t1", name: "Ideas" }, { id: "t2", name: "Work" }])
      : json([{ id: "t2", name: "Work" }]));

  render(<PageTags pageId="p1" />);

  assert.ok(await screen.findByRole("button", { name: "Remove Work tag" }));
  assert.equal(screen.queryByText("No tags assigned."), null);
  const select = screen.getByRole("combobox") as HTMLSelectElement;
  assert.deepEqual(
    Array.from(select.options).map((option) => option.textContent),
    ["Choose an existing tag...", "Ideas"],
  );
  assert.equal(calls.length, 2);
});

test("PageTags reports when no tags are assigned", async () => {
  stubFetch((call) => json(call.url === "/api/tags" ? [{ id: "t1", name: "Ideas" }] : []));

  render(<PageTags pageId="p1" />);

  assert.ok(await screen.findByText("No tags assigned."));
});

test("PageTags creates a tag and assigns it to the page", async () => {
  let tags: Tag[] = [{ id: "t1", name: "Ideas" }];
  let assigned: Tag[] = [];
  const calls = stubFetch((call) => {
    if (call.method === "POST" && call.url === "/api/tags") {
      const tag = { id: "t2", name: "Reading" };
      tags = [...tags, tag];
      return json(tag);
    }
    if (call.method === "POST" && call.url === "/api/pages/p1/tags") {
      const { tagId } = call.body as { tagId: string };
      assigned = tags.filter((tag) => tag.id === tagId);
      return json({ ok: true });
    }
    return json(call.url === "/api/tags" ? tags : assigned);
  });

  render(<PageTags pageId="p1" />);
  await screen.findByText("No tags assigned.");

  const input = screen.getByPlaceholderText("Create a new tag...");
  fireEvent.change(input, { target: { value: "  Reading  " } });
  await act(async () => {
    fireEvent.submit(input.closest("form")!);
  });

  assert.deepEqual(
    calls.find((call) => call.url === "/api/tags" && call.method === "POST")?.body,
    { name: "Reading" },
  );
  assert.deepEqual(
    calls.find((call) => call.url === "/api/pages/p1/tags" && call.method === "POST")?.body,
    { tagId: "t2" },
  );
  assert.ok(await screen.findByRole("button", { name: "Remove Reading tag" }));
  assert.equal((screen.getByPlaceholderText("Create a new tag...") as HTMLInputElement).value, "");
});

test("PageTags assigns an existing tag from the picker", async () => {
  let assigned: Tag[] = [];
  const calls = stubFetch((call) => {
    if (call.method === "POST" && call.url === "/api/pages/p1/tags") {
      assigned = [{ id: "t1", name: "Ideas" }];
      return json({ ok: true });
    }
    return json(call.url === "/api/tags" ? [{ id: "t1", name: "Ideas" }] : assigned);
  });

  render(<PageTags pageId="p1" />);
  await screen.findByText("No tags assigned.");

  const select = screen.getByRole("combobox");
  assert.equal((screen.getByRole("button", { name: "Add tag" }) as HTMLButtonElement).disabled, true);
  fireEvent.change(select, { target: { value: "t1" } });
  assert.equal((screen.getByRole("button", { name: "Add tag" }) as HTMLButtonElement).disabled, false);

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Add tag" }));
  });

  assert.deepEqual(
    calls.find((call) => call.url === "/api/pages/p1/tags" && call.method === "POST")?.body,
    { tagId: "t1" },
  );
  assert.ok(await screen.findByRole("button", { name: "Remove Ideas tag" }));
});

test("PageTags removes a tag from the page", async () => {
  let assigned: Tag[] = [{ id: "t2", name: "Work" }];
  const calls = stubFetch((call) => {
    if (call.method === "DELETE") {
      assigned = [];
      return json({ ok: true });
    }
    return json(call.url === "/api/tags" ? [{ id: "t2", name: "Work" }] : assigned);
  });

  render(<PageTags pageId="p1" />);
  await screen.findByRole("button", { name: "Remove Work tag" });

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Remove Work tag" }));
  });

  assert.deepEqual(calls.find((call) => call.method === "DELETE")?.body, { tagId: "t2" });
  assert.ok(await screen.findByText("No tags assigned."));
});

test("PageTags reports a failed load", async () => {
  stubFetch(() => json({ error: "boom" }, 500));

  render(<PageTags pageId="p1" />);

  const alert = await screen.findByRole("alert");
  assert.equal(alert.textContent, "Could not load tags.");
});

test("PageTags reports a failed tag creation", async () => {
  stubFetch((call) =>
    call.method === "POST" ? json({ error: "boom" }, 500) : json([]));

  render(<PageTags pageId="p1" />);
  await screen.findByText("No tags assigned.");

  const input = screen.getByPlaceholderText("Create a new tag...");
  fireEvent.change(input, { target: { value: "Reading" } });
  await act(async () => {
    fireEvent.submit(input.closest("form")!);
  });

  assert.equal((await screen.findByRole("alert")).textContent, "Could not create or assign tag.");
  assert.equal((screen.getByPlaceholderText("Create a new tag...") as HTMLInputElement).value, "Reading");
});
