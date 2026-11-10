import "../setup-dom";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PageTags } from "../../src/components/page-tags";
import { json } from "./fetch-stub";
import { restoreStrictFetch, stubStrictFetch } from "./strict-fetch-stub";

type Tag = { id: string; name: string };

afterEach(() => {
  cleanup();
  restoreStrictFetch();
});

test("PageTags shows assigned tags and offers only unassigned ones", async () => {
  const calls = stubStrictFetch("PageTags", (call) => {
    if (call.url === "/api/tags" && call.method === "GET") {
      return json([{ id: "t1", name: "Ideas" }, { id: "t2", name: "Work" }]);
    }
    if (call.url === "/api/pages/p1/tags" && call.method === "GET") {
      return json([{ id: "t2", name: "Work" }]);
    }
    return undefined;
  });

  render(<PageTags pageId="p1" />);

  assert.ok(await screen.findByRole("button", { name: "Remove Work tag" }));
  assert.equal(screen.queryByText("No tags assigned."), null);
  const select = screen.getByRole("combobox", { name: "Add an existing tag to this page" }) as HTMLSelectElement;
  assert.deepEqual(
    Array.from(select.options).map((option) => option.textContent),
    ["Choose an existing tag...", "Ideas"],
  );
  assert.equal(calls.length, 2);
});

test("PageTags reports when no tags are assigned", async () => {
  stubStrictFetch("PageTags", (call) => {
    if (call.url === "/api/tags" && call.method === "GET") {
      return json([{ id: "t1", name: "Ideas" }]);
    }
    if (call.url === "/api/pages/p1/tags" && call.method === "GET") return json([]);
    return undefined;
  });

  render(<PageTags pageId="p1" />);

  assert.ok(await screen.findByText("No tags assigned."));
});

test("PageTags creates a tag and assigns it to the page", async () => {
  let tags: Tag[] = [{ id: "t1", name: "Ideas" }];
  let assigned: Tag[] = [];
  const calls = stubStrictFetch("PageTags", (call) => {
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
    if (call.method === "GET" && call.url === "/api/tags") return json(tags);
    if (call.method === "GET" && call.url === "/api/pages/p1/tags") {
      return json(assigned);
    }
    return undefined;
  });

  render(<PageTags pageId="p1" />);
  await screen.findByText("No tags assigned.");

  const input = screen.getByLabelText("Create a new tag");
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
  assert.equal((screen.getByLabelText("Create a new tag") as HTMLInputElement).value, "");
});

test("PageTags assigns an existing tag from the picker", async () => {
  let assigned: Tag[] = [];
  const calls = stubStrictFetch("PageTags", (call) => {
    if (call.method === "POST" && call.url === "/api/pages/p1/tags") {
      assigned = [{ id: "t1", name: "Ideas" }];
      return json({ ok: true });
    }
    if (call.method === "GET" && call.url === "/api/tags") {
      return json([{ id: "t1", name: "Ideas" }]);
    }
    if (call.method === "GET" && call.url === "/api/pages/p1/tags") {
      return json(assigned);
    }
    return undefined;
  });

  render(<PageTags pageId="p1" />);
  await screen.findByText("No tags assigned.");

  const select = screen.getByRole("combobox", { name: "Add an existing tag to this page" });
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
  const calls = stubStrictFetch("PageTags", (call) => {
    if (call.method === "DELETE" && call.url === "/api/pages/p1/tags") {
      assigned = [];
      return json({ ok: true });
    }
    if (call.method === "GET" && call.url === "/api/tags") {
      return json([{ id: "t2", name: "Work" }]);
    }
    if (call.method === "GET" && call.url === "/api/pages/p1/tags") {
      return json(assigned);
    }
    return undefined;
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
  stubStrictFetch("PageTags", (call) =>
    (call.url === "/api/tags" || call.url === "/api/pages/p1/tags") &&
    call.method === "GET"
      ? json({ error: "boom" }, 500)
      : undefined,
  );

  render(<PageTags pageId="p1" />);

  const alert = await screen.findByRole("alert");
  assert.equal(alert.textContent, "Could not load tags.");
});

test("PageTags reports a failed tag creation", async () => {
  stubStrictFetch("PageTags", (call) => {
    if (call.method === "POST") return json({ error: "boom" }, 500);
    if (
      call.method === "GET" &&
      (call.url === "/api/tags" || call.url === "/api/pages/p1/tags")
    ) {
      return json([]);
    }
    return undefined;
  });

  render(<PageTags pageId="p1" />);
  await screen.findByText("No tags assigned.");

  const input = screen.getByLabelText("Create a new tag");
  fireEvent.change(input, { target: { value: "Reading" } });
  await act(async () => {
    fireEvent.submit(input.closest("form")!);
  });

  assert.equal((await screen.findByRole("alert")).textContent, "Could not create or assign tag.");
  assert.equal((screen.getByLabelText("Create a new tag") as HTMLInputElement).value, "Reading");
});
