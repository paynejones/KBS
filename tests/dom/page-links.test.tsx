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

const RECORD = { id: "r1", title: "Record one", databaseId: "d1", databaseName: "Media" };

afterEach(() => {
  restoreFetch();
  cleanup();
});

/** Answers the page-links request and the page-records request separately. */
function stubConnections(
  pageLinks: { links: { id: string; title: string }[]; backlinks: { id: string; title: string; contexts: string[] }[] },
  recordLinks: { records: typeof RECORD[]; options: typeof RECORD[] } = { records: [], options: [] },
) {
  return stubFetch((call) =>
    call.url.endsWith("/records") ? json(recordLinks) : json(pageLinks),
  );
}

test("PageLinks renders linked pages, backlinks, and linked records", async () => {
  const calls = stubConnections(
    {
      links: [{ id: "p2", title: "Other" }],
      backlinks: [{ id: "p3", title: "Source page", contexts: ["Reads with Other in mind."] }],
    },
    { records: [RECORD], options: [] },
  );

  render(<PageLinks pageId="p1" pages={PAGES} />);

  const link = await screen.findByRole("link", { name: "Other" });
  assert.equal(link.getAttribute("href"), "/pages/p2");
  assert.equal(screen.getByRole("link", { name: /Source page/ }).getAttribute("href"), "/pages/p3");

  const recordLink = screen.getByRole("link", { name: "Record one" });
  assert.equal(
    recordLink.getAttribute("href"),
    "/databases/d1/records/r1",
    "a linked record opens its record page",
  );
  assert.ok(screen.getByText("Media"), "the record shows which database it belongs to");

  assert.ok(screen.getByText("Reads with Other in mind."));
  assert.equal(screen.getAllByText("(1)").length, 3, "every column shows a count");
  assert.deepEqual(calls.map((call) => call.url).sort(), [
    "/api/pages/p1/links",
    "/api/pages/p1/records",
  ]);
});

test("PageLinks shows empty states when nothing is connected", async () => {
  stubConnections({ links: [], backlinks: [] });

  render(<PageLinks pageId="p1" pages={PAGES} />);

  assert.ok(await screen.findByText("No linked pages yet."));
  assert.ok(screen.getByText("No pages link here yet."));
  assert.ok(screen.getByText("No linked records yet."));
});

test("PageLinks only offers pages that are not already linked", async () => {
  stubConnections({ links: [{ id: "p2", title: "Other" }], backlinks: [] });

  render(<PageLinks pageId="p1" pages={PAGES} />);
  await screen.findByRole("link", { name: "Other" });

  const select = screen.getByRole("combobox", { name: "Page connections: choose a page to link" }) as HTMLSelectElement;
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
    if (call.url.endsWith("/records")) return json({ records: [], options: [] });
    if (call.method === "POST") {
      links = [...links, { id: "p3", title: "Free page" }];
      return json({ ok: true });
    }
    return json({ links, backlinks: [] });
  });

  render(<PageLinks pageId="p1" pages={PAGES} />);
  await screen.findByRole("link", { name: "Other" });

  fireEvent.change(screen.getByRole("combobox", { name: "Page connections: choose a page to link" }), {
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
    (screen.getByRole("combobox", { name: "Page connections: choose a page to link" }) as HTMLSelectElement).value,
    "",
    "the picker resets after a successful link",
  );
});

test("PageLinks deletes a link and updates both columns", async () => {
  let links = [{ id: "p2", title: "Other" }];
  const calls = stubFetch((call) => {
    if (call.url.endsWith("/records")) return json({ records: [], options: [] });
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

test("PageLinks links a record and shows it with its database", async () => {
  let records: (typeof RECORD)[] = [];
  const calls = stubFetch((call) => {
    if (call.url === "/api/pages/p1/records") {
      if (call.method === "POST") {
        records = [RECORD];
        return json({ ok: true });
      }
      return json({ records, options: records.length ? [] : [RECORD] });
    }
    return json({ links: [], backlinks: [] });
  });

  render(<PageLinks pageId="p1" pages={PAGES} />);
  await screen.findByText("No linked records yet.");

  fireEvent.change(screen.getByRole("combobox", { name: "Link a record to this page" }), {
    target: { value: "r1" },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Link record" }));
  });

  const post = calls.find((call) => call.method === "POST");
  assert.equal(post?.url, "/api/pages/p1/records");
  assert.deepEqual(post?.body, { recordId: "r1" });
  const linked = await screen.findByRole("link", { name: "Record one" });
  assert.equal(linked.getAttribute("href"), "/databases/d1/records/r1");
  assert.equal(
    (screen.getByRole("combobox", { name: "Link a record to this page" }) as HTMLSelectElement).value,
    "",
  );
});

test("PageLinks removes a record link", async () => {
  let records = [RECORD];
  const calls = stubFetch((call) => {
    if (call.url === "/api/pages/p1/records") {
      if (call.method === "DELETE") {
        records = [];
        return json({ ok: true });
      }
      return json({ records, options: [] });
    }
    return json({ links: [], backlinks: [] });
  });

  render(<PageLinks pageId="p1" pages={PAGES} />);
  await screen.findByRole("link", { name: "Record one" });

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Remove link to Record one" }));
  });

  const deletion = calls.find((call) => call.method === "DELETE");
  assert.equal(deletion?.url, "/api/pages/p1/records");
  assert.deepEqual(deletion?.body, { recordId: "r1" });
  assert.ok(await screen.findByText("No linked records yet."));
});

test("PageLinks reports a failed load", async () => {
  stubFetch(() => json({ error: "boom" }, 500));

  render(<PageLinks pageId="p1" pages={PAGES} />);

  const alert = await screen.findByRole("alert");
  assert.equal(alert.textContent, "Could not load page connections.");
});

test("PageLinks reports a failed link creation", async () => {
  stubFetch((call) => {
    if (call.url.endsWith("/records")) return json({ records: [], options: [] });
    return call.method === "POST" ? json({ error: "boom" }, 500) : json({ links: [], backlinks: [] });
  });

  render(<PageLinks pageId="p1" pages={PAGES} />);
  await screen.findByText("No linked pages yet.");

  fireEvent.change(screen.getByRole("combobox", { name: "Page connections: choose a page to link" }), {
    target: { value: "p3" },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Add link" }));
  });

  assert.equal((await screen.findByRole("alert")).textContent, "Could not link this page.");
});

test("PageLinks reports a failed record link", async () => {
  stubFetch((call) => {
    if (call.url.endsWith("/records")) {
      return call.method === "POST"
        ? json({ error: "boom" }, 500)
        : json({ records: [], options: [RECORD] });
    }
    return json({ links: [], backlinks: [] });
  });

  render(<PageLinks pageId="p1" pages={PAGES} />);
  await screen.findByText("No linked records yet.");

  fireEvent.change(screen.getByRole("combobox", { name: "Link a record to this page" }), {
    target: { value: "r1" },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Link record" }));
  });

  assert.equal((await screen.findByRole("alert")).textContent, "Could not link this record.");
});
