import "../setup-dom";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PageLinks } from "../../src/components/page-links";
import { json, restoreFetch, stubFetch } from "./fetch-stub";

const PAGES = [
  { id: "p1", title: "Current page", parentId: null },
  { id: "p2", title: "Other", parentId: null },
  { id: "p3", title: "Free page", parentId: null },
];

afterEach(() => {
  restoreFetch();
  cleanup();
});

test("PageLinks renders linked pages and backlinks with their context", async () => {
  const calls = stubFetch(() =>
    json({
      links: [{ id: "p2", title: "Other" }],
      backlinks: [{ id: "p3", title: "Source page", contexts: ["Reads with Other in mind."] }],
    }));

  render(<PageLinks pageId="p1" pages={PAGES} />);

  const link = await screen.findByRole("link", { name: "Other" });
  assert.equal(link.getAttribute("href"), "/pages/p2");
  assert.equal(screen.getByRole("link", { name: /Source page/ }).getAttribute("href"), "/pages/p3");
  assert.ok(screen.getByText("Reads with Other in mind."));
  assert.equal(screen.getAllByText("(1)").length, 2, "both columns show a count");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/pages/p1/links");
  assert.equal(calls[0].method, "GET");
});

test("PageLinks shows empty states when nothing is connected", async () => {
  stubFetch(() => json({ links: [], backlinks: [] }));

  render(<PageLinks pageId="p1" pages={PAGES} />);

  assert.ok(await screen.findByText("No linked pages yet."));
  assert.ok(screen.getByText("No pages link here yet."));
});

test("PageLinks only offers pages that are not already linked", async () => {
  stubFetch(() => json({ links: [{ id: "p2", title: "Other" }], backlinks: [] }));

  render(<PageLinks pageId="p1" pages={PAGES} />);
  await screen.findByRole("link", { name: "Other" });

  const select = screen.getByRole("combobox", { name: "Choose a page to link" }) as HTMLSelectElement;
  assert.deepEqual(
    Array.from(select.options).map((option) => option.textContent),
    ["Choose a page…", "Free page"],
  );
  const addButton = screen.getByRole("button", { name: "Add link" }) as HTMLButtonElement;
  assert.equal(addButton.disabled, true);

  fireEvent.change(select, { target: { value: "p3" } });

  assert.equal((screen.getByRole("button", { name: "Add link" }) as HTMLButtonElement).disabled, false);
});

test("PageLinks posts a new link and refreshes the list", async () => {
  let links = [{ id: "p2", title: "Other" }];
  const calls = stubFetch((call) => {
    if (call.method === "POST") {
      links = [...links, { id: "p3", title: "Free page" }];
      return json({ ok: true });
    }
    return json({ links, backlinks: [] });
  });

  render(<PageLinks pageId="p1" pages={PAGES} />);
  await screen.findByRole("link", { name: "Other" });

  fireEvent.change(screen.getByRole("combobox", { name: "Choose a page to link" }), {
    target: { value: "p3" },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Add link" }));
  });

  const post = calls.find((call) => call.method === "POST");
  assert.equal(post?.url, "/api/pages/p1/links");
  assert.deepEqual(post?.body, { targetPageId: "p3" });
  assert.ok(await screen.findByRole("link", { name: "Free page" }));
  assert.equal(
    (screen.getByRole("combobox", { name: "Choose a page to link" }) as HTMLSelectElement).value,
    "",
    "the picker resets after a successful link",
  );
});

test("PageLinks deletes a link and updates both columns", async () => {
  let links = [{ id: "p2", title: "Other" }];
  const calls = stubFetch((call) => {
    if (call.method === "DELETE") {
      links = [];
      return json({ ok: true });
    }
    return json({ links, backlinks: [] });
  });

  render(<PageLinks pageId="p1" pages={PAGES} />);
  await screen.findByRole("link", { name: "Other" });

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Remove link to Other" }));
  });

  const deletion = calls.find((call) => call.method === "DELETE");
  assert.equal(deletion?.url, "/api/pages/p1/links");
  assert.deepEqual(deletion?.body, { targetPageId: "p2" });
  assert.ok(await screen.findByText("No linked pages yet."));
});

test("PageLinks reports a failed load", async () => {
  stubFetch(() => json({ error: "boom" }, 500));

  render(<PageLinks pageId="p1" pages={PAGES} />);

  const alert = await screen.findByRole("alert");
  assert.equal(alert.textContent, "Could not load page links.");
});

test("PageLinks reports a failed link creation", async () => {
  stubFetch((call) =>
    call.method === "POST" ? json({ error: "boom" }, 500) : json({ links: [], backlinks: [] }));

  render(<PageLinks pageId="p1" pages={PAGES} />);
  await screen.findByText("No linked pages yet.");

  fireEvent.change(screen.getByRole("combobox", { name: "Choose a page to link" }), {
    target: { value: "p3" },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Add link" }));
  });

  assert.equal((await screen.findByRole("alert")).textContent, "Could not link this page.");
});
