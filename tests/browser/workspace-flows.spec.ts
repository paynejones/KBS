import assert from "node:assert/strict";
import { expect, test, type APIRequestContext, type APIResponse } from "@playwright/test";

type PageRow = {
  id: string;
  title: string;
  content: string;
  isFavorite: boolean;
};

type Database = { id: string; name: string };
type Property = { id: string; name: string; type: string };
type RecordRow = { id: string; title: string; pageId: string; values: Record<string, unknown> };

async function json<T>(response: APIResponse): Promise<T> {
  const text = await response.text();
  assert.ok(response.ok(), `${response.url()} returned ${response.status()}: ${text}`);
  return JSON.parse(text) as T;
}

async function createPage(request: APIRequestContext, data: Record<string, unknown>): Promise<PageRow> {
  return await json<PageRow>(await request.post("/api/pages", { data }));
}

async function getPage(request: APIRequestContext, id: string): Promise<PageRow> {
  return await json<PageRow>(await request.get(`/api/pages/${id}`));
}

async function purgePage(request: APIRequestContext, id: string) {
  const trashed = await request.delete(`/api/pages/${id}`);
  if (trashed.ok()) await request.delete(`/api/trash/${id}`);
}

async function createDatabase(request: APIRequestContext, name: string): Promise<Database> {
  return await json<Database>(await request.post("/api/databases", { data: { name } }));
}

async function createProperty(
  request: APIRequestContext,
  databaseId: string,
  data: Record<string, unknown>,
): Promise<Property> {
  return await json<Property>(await request.post(`/api/databases/${databaseId}/properties`, { data }));
}

async function createRecord(
  request: APIRequestContext,
  databaseId: string,
  title: string,
): Promise<RecordRow> {
  return await json<RecordRow>(await request.post(`/api/databases/${databaseId}/records`, {
    data: { title },
  }));
}

async function cleanupDatabase(request: APIRequestContext, databaseId: string) {
  const response = await request.get(`/api/databases/${databaseId}`);
  if (response.ok()) {
    const database = await json<{ records: { pageId: string | null }[] }>(response);
    for (const record of database.records) {
      if (record.pageId) await purgePage(request, record.pageId);
    }
  }
  await request.delete(`/api/databases/${databaseId}`);
}

test("edits and autosaves a page body and title", async ({ page, request }) => {
  const token = `page-editor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const fixture = await createPage(request, { title: `${token} draft`, content: "" });

  try {
    await page.goto(`/pages/${fixture.id}`);
    const title = page.getByLabel("Page title");
    await expect(title).toHaveValue(fixture.title);

    const editor = page.locator(".ProseMirror");
    await expect(editor).toBeEditable();

    const nextTitle = `${token} edited`;
    const titleSaved = page.waitForResponse((response) =>
      response.url().endsWith(`/api/pages/${fixture.id}`)
      && response.request().method() === "PATCH",
    );
    await title.fill(nextTitle);
    await title.press("Tab");
    assert.equal((await titleSaved).status(), 200);

    const body = `${token} body text`;
    const bodySaved = page.waitForResponse((response) =>
      response.url().endsWith(`/api/pages/${fixture.id}`)
      && response.request().method() === "PATCH",
    );
    await editor.fill(body);
    assert.equal((await bodySaved).status(), 200);

    await expect.poll(async () => (await getPage(request, fixture.id)).content).toBe(body);

    await page.reload();
    await expect(page.getByLabel("Page title")).toHaveValue(nextTitle);
    await expect(page.locator(".ProseMirror")).toContainText(body);
  } finally {
    await purgePage(request, fixture.id);
  }
});

test("searches pages and toggles a favorite", async ({ page, request }) => {
  const token = `page-browse-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const matching = await createPage(request, { title: `${token} finder` });
  const unrelated = await createPage(request, { title: `unrelated-${Date.now()}` });

  try {
    await page.goto("/pages");
    await page.getByPlaceholder("Search pages...").fill(token);

    await expect(page.getByRole("main").getByText(matching.title, { exact: true })).toBeVisible();
    await expect(page.getByRole("main").getByText(unrelated.title, { exact: true })).toHaveCount(0);

    const favorite = page.waitForResponse((response) =>
      response.url().endsWith(`/api/pages/${matching.id}`)
      && response.request().method() === "PATCH",
    );
    await page.getByRole("button", { name: `Add ${matching.title} to favorites` }).click();
    assert.equal((await favorite).status(), 200);
    await expect(
      page.getByRole("button", { name: `Remove ${matching.title} from favorites` }),
    ).toBeVisible();
    assert.equal((await getPage(request, matching.id)).isFavorite, true);
  } finally {
    await purgePage(request, matching.id);
    await purgePage(request, unrelated.id);
  }
});

test("captures a note in the inbox", async ({ page, request }) => {
  const token = `inbox-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let capturedId = "";

  try {
    await page.goto("/inbox");
    await page.getByPlaceholder("Title (optional)").fill(`${token} title`);
    await page.getByPlaceholder("Write a quick note…").fill(`${token} body`);
    await page.getByPlaceholder("Paste a link (optional)").fill("https://example.com/essay");
    await page
      .getByPlaceholder("Paste the passage you want to keep (optional)")
      .fill(`${token} quote`);

    const captured = page.waitForResponse((response) =>
      response.url().endsWith("/api/inbox")
      && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Capture", exact: true }).click();
    const response = await captured;
    assert.equal(response.status(), 201);
    const item = await response.json() as PageRow;
    capturedId = item.id;

    await expect(page.getByRole("heading", { name: `${token} title` })).toBeVisible();
    await expect(page.getByText(`${token} body`, { exact: true })).toBeVisible();
    await expect(
      page.locator("blockquote").filter({ hasText: `${token} quote` }),
    ).toBeVisible();
  } finally {
    if (capturedId) await purgePage(request, capturedId);
  }
});

test("restores a page from the trash", async ({ page, request }) => {
  const token = `trash-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const fixture = await createPage(request, { title: `${token} restore me` });

  try {
    await request.delete(`/api/pages/${fixture.id}`);
    await page.goto("/trash");

    const row = page.locator("li").filter({ hasText: fixture.title });
    await expect(row).toBeVisible();
    const restored = page.waitForResponse((response) =>
      response.url().endsWith(`/api/trash/${fixture.id}/restore`)
      && response.request().method() === "POST",
    );
    await row.getByRole("button", { name: "Restore", exact: true }).click();
    assert.equal((await restored).status(), 200);
    await expect(page.getByText(`Restored “${fixture.title}”.`)).toBeVisible();
    await expect(row).toHaveCount(0);
    assert.equal((await request.get(`/api/pages/${fixture.id}`)).status(), 200);
  } finally {
    await purgePage(request, fixture.id);
  }
});

test("pins and removes a dashboard widget", async ({ page, request }) => {
  const token = `dashboard-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const database = await createDatabase(request, `${token} database`);
  const record = await createRecord(request, database.id, `${token} record`);
  // The home page renders the pinned-views section only for a workspace that
  // already has at least one page.
  const fixture = await createPage(request, { title: `${token} page` });

  try {
    await page.goto("/");
    const picker = page.locator("#dashboard-widget-picker");
    await expect(picker).toBeEnabled();
    await picker.selectOption({ label: `${database.name} — All records` });
    const pin = page.getByRole("button", { name: "Pin" });
    await expect(pin).toBeEnabled();
    await pin.click();

    await expect(page.getByRole("heading", { name: "All records" })).toBeVisible();
    await expect(page.getByRole("link", { name: record.title, exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("heading", { name: "All records" })).toBeVisible();
    await page.getByRole("button", { name: "Remove All records widget" }).click();
    await expect(page.getByRole("heading", { name: "All records" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: record.title, exact: true })).toHaveCount(0);
  } finally {
    await purgePage(request, fixture.id);
    await cleanupDatabase(request, database.id);
  }
});

test("adds a database record and edits its title and number value", async ({ page, request }) => {
  const token = `table-crud-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const database = await createDatabase(request, `${token} database`);
  const score = await createProperty(request, database.id, { name: "Score", type: "number" });

  try {
    await page.goto(`/databases/${database.id}`);
    await expect(page.getByLabel("Database name")).toHaveValue(database.name);

    const createdResponse = page.waitForResponse((response) =>
      response.url().endsWith(`/api/databases/${database.id}/records`)
      && response.request().method() === "POST",
    );
    // The table's inline add row uses this label too; the toolbar button is
    // first in the document.
    await page.getByRole("button", { name: "New record" }).first().click();
    const created = await createdResponse;
    assert.equal(created.status(), 201);
    const record = await created.json() as RecordRow;

    const recordName = page.getByLabel("Record name");
    await expect(recordName).toHaveValue("Untitled");
    const nextTitle = `${token} record`;
    const titleSaved = page.waitForResponse((response) =>
      response.url().endsWith(`/api/databases/${database.id}/records/${record.id}`)
      && response.request().method() === "PATCH",
    );
    await recordName.fill(nextTitle);
    await recordName.press("Tab");
    assert.equal((await titleSaved).status(), 200);

    const scoreInput = page.getByLabel(`Score for ${nextTitle}`);
    await expect(scoreInput).toBeVisible();
    const valueSaved = page.waitForResponse((response) =>
      response.url().endsWith(`/api/databases/${database.id}/records/${record.id}`)
      && response.request().method() === "PATCH",
    );
    await scoreInput.fill("42");
    await scoreInput.press("Enter");
    assert.equal((await valueSaved).status(), 200);

    const detail = await json<{ records: RecordRow[] }>(
      await request.get(`/api/databases/${database.id}`),
    );
    const saved = detail.records.find((candidate) => candidate.id === record.id);
    assert.equal(saved?.title, nextTitle);
    assert.equal(saved?.values[score.id], 42);
  } finally {
    await cleanupDatabase(request, database.id);
  }
});
