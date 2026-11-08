import "../setup-dom";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RecordPageLinks } from "../../src/components/record-links";
import { json, restoreFetch, stubFetch } from "./fetch-stub";

const PAGE = { id: "p1", title: "Source page" };
const FREE_PAGE = { id: "p2", title: "Free page" };

afterEach(() => {
  restoreFetch();
  cleanup();
});

test("RecordPageLinks lists the pages connected to a record", async () => {
  stubFetch(() => json({ pages: [PAGE], options: [FREE_PAGE] }));

  render(<RecordPageLinks recordId="r1" />);

  const link = await screen.findByRole("link", { name: "Source page" });
  assert.equal(link.getAttribute("href"), "/pages/p1");

  const select = screen.getByRole("combobox", { name: "Linked pages: choose a page to link" }) as HTMLSelectElement;
  assert.deepEqual(
    Array.from(select.options).map((option) => option.textContent),
    ["Choose a page…", "Free page"],
  );
});

test("RecordPageLinks links a page and refreshes the list", async () => {
  let pages: { id: string; title: string }[] = [];
  const calls = stubFetch((call) => {
    if (call.method === "POST") {
      pages = [FREE_PAGE];
      return json({ ok: true });
    }
    return json({ pages, options: pages.length ? [] : [FREE_PAGE] });
  });

  render(<RecordPageLinks recordId="r1" />);
  await screen.findByText("No linked pages yet.");

  fireEvent.change(screen.getByRole("combobox", { name: "Linked pages: choose a page to link" }), {
    target: { value: "p2" },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Link page" }));
  });

  const post = calls.find((call) => call.method === "POST");
  assert.equal(post?.url, "/api/records/r1/pages");
  assert.deepEqual(post?.body, { pageId: "p2" });
  assert.ok(await screen.findByRole("link", { name: "Free page" }));
  assert.equal(
    (screen.getByRole("combobox", { name: "Linked pages: choose a page to link" }) as HTMLSelectElement).value,
    "",
    "the picker resets after a successful link",
  );
});

test("RecordPageLinks removes a page connection", async () => {
  let pages = [PAGE];
  const calls = stubFetch((call) => {
    if (call.method === "DELETE") {
      pages = [];
      return json({ ok: true });
    }
    return json({ pages, options: [] });
  });

  render(<RecordPageLinks recordId="r1" />);
  await screen.findByRole("link", { name: "Source page" });

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Remove link to Source page" }));
  });

  const deletion = calls.find((call) => call.method === "DELETE");
  assert.equal(deletion?.url, "/api/records/r1/pages");
  assert.deepEqual(deletion?.body, { pageId: "p1" });
  assert.ok(await screen.findByText("No linked pages yet."));
});

test("RecordPageLinks disables the picker when there is nothing to link", async () => {
  stubFetch(() => json({ pages: [], options: [] }));

  render(<RecordPageLinks recordId="r1" />);
  await screen.findByText("No linked pages yet.");

  const select = screen.getByRole("combobox", { name: "Linked pages: choose a page to link" }) as HTMLSelectElement;
  assert.equal(select.disabled, true);
  assert.equal((screen.getByRole("button", { name: "Link page" }) as HTMLButtonElement).disabled, true);
});

test("RecordPageLinks reports a failed load", async () => {
  stubFetch(() => json({ error: "boom" }, 500));

  render(<RecordPageLinks recordId="r1" />);

  const alert = await screen.findByRole("alert");
  assert.equal(alert.textContent, "Could not load linked pages.");
});

test("RecordPageLinks reports a failed link", async () => {
  stubFetch((call) =>
    call.method === "POST" ? json({ error: "boom" }, 500) : json({ pages: [], options: [FREE_PAGE] }),
  );

  render(<RecordPageLinks recordId="r1" />);
  await screen.findByText("No linked pages yet.");

  fireEvent.change(screen.getByRole("combobox", { name: "Linked pages: choose a page to link" }), {
    target: { value: "p2" },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Link page" }));
  });

  assert.equal((await screen.findByRole("alert")).textContent, "Could not link this page.");
});
