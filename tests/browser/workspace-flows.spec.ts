import assert from "node:assert/strict";
import { expect, test, type APIRequestContext, type APIResponse } from "@playwright/test";

type PageRow = {
  id: string;
  title: string;
  content: string;
  isFavorite: boolean;
  icon: string | null;
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

test("picks a page icon in settings and saves it", async ({ page, request }) => {
  const token = `page-icon-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const fixture = await createPage(request, { title: `${token} page` });

  try {
    await page.goto(`/pages/${fixture.id}`);
    const titleRow = page.getByLabel("Page title").locator("xpath=..");

    await page.locator("summary").filter({ hasText: "Page settings" }).click();
    await page.getByRole("button", { name: "Add page icon" }).click();

    const saved = page.waitForResponse((response) =>
      response.url().endsWith(`/api/pages/${fixture.id}`)
      && response.request().method() === "PATCH",
    );
    await page.getByRole("option", { name: "Rocket" }).click();
    const response = await saved;
    assert.equal(response.status(), 200);
    const savedPage = await response.json() as PageRow;
    assert.equal(savedPage.icon, "🚀");

    await expect(page.getByRole("dialog", { name: "Choose a page icon" })).toHaveCount(0);
    await expect(titleRow.getByText("🚀", { exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("Page title")).toHaveValue(fixture.title);
    await expect(titleRow.getByText("🚀", { exact: true })).toBeVisible();
    assert.equal((await getPage(request, fixture.id)).icon, "🚀");
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

test("shows a gallery card cover from the record's linked page", async ({ page, request }) => {
  const token = `gallery-cover-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const database = await createDatabase(request, `${token} database`);
  const record = await createRecord(request, database.id, `${token} record`);

  try {
    const gallery = await json<{ id: string }>(await request.post(`/api/databases/${database.id}/views`, {
      data: { name: "Gallery", type: "gallery", config: {} },
    }));
    const attachment = await json<{ url: string }>(await request.post("/api/attachments", {
      multipart: {
        purpose: "image",
        file: {
          name: `${token}.png`,
          mimeType: "image/png",
          // A 1x1 PNG, so the card's image request succeeds same-origin.
          buffer: Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=",
            "base64",
          ),
        },
      },
    }));
    assert.equal((await request.patch(`/api/pages/${record.pageId}`, {
      data: { coverImageUrl: attachment.url },
    })).status(), 200);

    await page.goto(`/databases/${database.id}?view=${gallery.id}`);
    const galleryRegion = page.getByRole("region", { name: "Gallery view" });
    await expect(galleryRegion).toBeVisible();

    // The record has no file properties, so this image can only be the linked
    // page's cover showing through the fallback.
    const cover = galleryRegion.getByRole("img", { name: record.title });
    await expect(cover).toBeVisible();
    await expect(cover).toHaveAttribute("src", attachment.url);
    await expect(
      galleryRegion.getByRole("button", { name: `Remove cover for ${record.title}` }),
    ).toHaveCount(0);
  } finally {
    await cleanupDatabase(request, database.id);
    await request.delete("/api/attachments/orphans");
  }
});

test("pins chart views to the home dashboard with their saved shape", async ({ page, request }) => {
  const token = `chart-widget-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const database = await createDatabase(request, `${token} database`);
  const score = await createProperty(request, database.id, { name: "Score", type: "number" });
  const effort = await createProperty(request, database.id, { name: "Effort", type: "number" });
  const status = await createProperty(request, database.id, {
    name: "Status",
    type: "select",
    options: { choices: ["Todo", "Done"] },
  });
  const when = await createProperty(request, database.id, { name: "When", type: "date" });
  const fixture = await createPage(request, { title: `${token} page` });

  try {
    for (const [title, scoreValue, effortValue, statusValue, date] of [
      [`${token} Alpha`, 7, 2, "Done", "2026-11-20"],
      [`${token} Beta`, 3, 8, "Todo", "2026-11-10"],
    ] as const) {
      const record = await createRecord(request, database.id, title);
      assert.equal((await request.patch(`/api/databases/${database.id}/records/${record.id}`, {
        data: {
          values: {
            [score.id]: scoreValue,
            [effort.id]: effortValue,
            [status.id]: statusValue,
            [when.id]: date,
          },
        },
      })).status(), 200);
    }
    await createRecord(request, database.id, `${token} Gamma`);

    const createChartView = async (name: string, chartType: string) =>
      await json<{ id: string; name: string }>(await request.post(`/api/databases/${database.id}/views`, {
        data: { name, type: "chart", config: { chartPropertyId: score.id, chartType } },
      }));
    const pie = await createChartView(`${token} pie`, "pie");
    const line = await createChartView(`${token} line`, "line");

    await page.goto("/");
    const picker = page.locator("#dashboard-widget-picker");
    await expect(picker).toBeEnabled();
    await picker.selectOption({ label: `${database.name} — ${pie.name}` });
    await page.getByRole("button", { name: "Pin", exact: true }).click();
    await picker.selectOption({ label: `${database.name} — ${line.name}` });
    await page.getByRole("button", { name: "Pin", exact: true }).click();

    const pieWidget = page.locator("article").filter({
      has: page.getByRole("heading", { name: pie.name }),
    });
    await expect(pieWidget).toBeVisible();
    await expect(pieWidget.getByText("70% · 7")).toBeVisible();
    await expect(pieWidget.getByText("30% · 3")).toBeVisible();
    await expect(pieWidget.getByText("1 record has no Score value.")).toBeVisible();
    await expect(
      pieWidget.getByRole("link", { name: `Open database filtered to ${token} Alpha` }),
    ).toHaveAttribute("href", /origin=dashboard/);

    // Value and grouping picks save to the view and redraw from fresh data.
    const savedValue = page.waitForResponse((response) =>
      response.url().endsWith(`/api/databases/${database.id}/views/${pie.id}`)
      && response.request().method() === "PATCH",
    );
    await pieWidget.getByLabel(`Chart value for ${pie.name}`).selectOption(effort.id);
    assert.equal((await savedValue).status(), 200);
    await expect(pieWidget.getByText("20% · 2")).toBeVisible();
    await expect(pieWidget.getByText("80% · 8")).toBeVisible();

    const savedGroup = page.waitForResponse((response) =>
      response.url().endsWith(`/api/databases/${database.id}/views/${pie.id}`)
      && response.request().method() === "PATCH",
    );
    await pieWidget.getByLabel(`Chart group for ${pie.name}`).selectOption(status.id);
    assert.equal((await savedGroup).status(), 200);
    await expect(pieWidget.locator("ul").getByText("Done", { exact: true })).toBeVisible();
    await expect(pieWidget.locator("ul").getByText("Todo", { exact: true })).toBeVisible();

    const lineWidget = page.locator("article").filter({
      has: page.getByRole("heading", { name: line.name }),
    });
    await expect(lineWidget).toBeVisible();
    await expect(lineWidget.getByText("2 points")).toBeVisible();
    await expect(lineWidget.getByText("High 7")).toBeVisible();
    await expect(lineWidget.getByText("Low 0")).toBeVisible();

    // Switching the shape in place saves it to the shared view.
    const savedShape = page.waitForResponse((response) =>
      response.url().endsWith(`/api/databases/${database.id}/views/${pie.id}`)
      && response.request().method() === "PATCH",
    );
    await pieWidget.getByLabel(`Chart type for ${pie.name}`).selectOption("line");
    assert.equal((await savedShape).status(), 200);
    await expect(pieWidget.getByText("2 points")).toBeVisible();
    await expect(pieWidget.getByText("High 8")).toBeVisible();

    const savedDates = page.waitForResponse((response) =>
      response.url().endsWith(`/api/databases/${database.id}/views/${pie.id}`)
      && response.request().method() === "PATCH",
    );
    await pieWidget.getByLabel(`Chart dates for ${pie.name}`).selectOption(when.id);
    assert.equal((await savedDates).status(), 200);
    await expect(pieWidget.getByText("2 points")).toBeVisible();

    const savedWindow = page.waitForResponse((response) =>
      response.url().endsWith(`/api/databases/${database.id}/views/${pie.id}`)
      && response.request().method() === "PATCH",
    );
    await pieWidget.getByLabel(`Chart window for ${pie.name}`).selectOption("7");
    assert.equal((await savedWindow).status(), 200);
    await expect(pieWidget.getByLabel(`Chart window for ${pie.name}`)).toHaveValue("7");

    const shiftedWindow = page.waitForResponse((response) =>
      response.url().endsWith(`/api/databases/${database.id}/views/${pie.id}`)
      && response.request().method() === "PATCH",
    );
    await pieWidget.getByRole("button", { name: `Previous window for ${pie.name}` }).click();
    assert.equal((await shiftedWindow).status(), 200);
    await expect(pieWidget.getByText("7 days back")).toBeVisible();

    const rangeStart = page.waitForResponse((response) =>
      response.url().endsWith(`/api/databases/${database.id}/views/${pie.id}`)
      && response.request().method() === "PATCH",
    );
    await pieWidget.getByLabel(`Chart range start for ${pie.name}`).fill("2026-10-01");
    assert.equal((await rangeStart).status(), 200);

    const rangeEnd = page.waitForResponse((response) =>
      response.url().endsWith(`/api/databases/${database.id}/views/${pie.id}`)
      && response.request().method() === "PATCH",
    );
    await pieWidget.getByLabel(`Chart range end for ${pie.name}`).fill("2026-10-31");
    assert.equal((await rangeEnd).status(), 200);
    await expect(pieWidget.getByText("Custom range")).toBeVisible();
    await expect(pieWidget.getByText("Custom range · Oct 1–31, 2026 · 0 records")).toBeVisible();

    const now = new Date();
    const monthKey = (date: Date) =>
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const thisMonthFrom = monthKey(new Date(now.getFullYear(), now.getMonth(), 1));
    const thisMonthTo = monthKey(new Date(now.getFullYear(), now.getMonth() + 1, 0));

    const monthRange = page.waitForResponse((response) =>
      response.url().endsWith(`/api/databases/${database.id}/views/${pie.id}`)
      && response.request().method() === "PATCH",
    );
    await pieWidget.getByRole("button", { name: `This month for ${pie.name}` }).click();
    assert.equal((await monthRange).status(), 200);
    await expect(pieWidget.getByLabel(`Chart range start for ${pie.name}`)).toHaveValue(thisMonthFrom);
    await expect(pieWidget.getByLabel(`Chart range end for ${pie.name}`)).toHaveValue(thisMonthTo);
    const shortMonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthDays = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const expectedRecords = now.getFullYear() === 2026 && now.getMonth() === 10 ? 2 : 0;
    await expect(
      pieWidget.getByText(
        `This month · ${shortMonths[now.getMonth()]} 1–${monthDays}, ${now.getFullYear()} · ${expectedRecords} records`,
      ),
    ).toBeVisible();

    const detail = await json<{
      views: {
        id: string;
        config: {
          chartType?: string;
          chartPropertyId?: string;
          chartGroupPropertyId?: string;
          chartDatePropertyId?: string;
          chartDateRange?: number;
          chartDateOffset?: number;
          chartDateStart?: string | null;
          chartDateEnd?: string | null;
          chartDatePreset?: string | null;
        };
      }[];
    }>(await request.get(`/api/databases/${database.id}`));
    const savedConfig = detail.views.find((view) => view.id === pie.id)?.config;
    assert.equal(savedConfig?.chartType, "line", "the chosen shape is saved on the view");
    assert.equal(savedConfig?.chartPropertyId, effort.id, "the value property is saved");
    assert.equal(
      savedConfig?.chartGroupPropertyId,
      status.id,
      "the grouping property is saved",
    );
    assert.equal(
      savedConfig?.chartDatePropertyId,
      when.id,
      "the line's date axis is saved",
    );
    assert.equal(savedConfig?.chartDateRange, 7, "the line's window is saved");
    assert.equal(savedConfig?.chartDateOffset, -7, "the window's step back is saved");
    assert.equal(
      savedConfig?.chartDatePreset,
      "this-month",
      "the shortcut is saved as a calendar-following preset",
    );
    assert.equal(savedConfig?.chartDateStart, null);
    assert.equal(savedConfig?.chartDateEnd, null);
    const rangeRecords = pieWidget.getByRole("link", { name: `${expectedRecords} records` });
    await expect(rangeRecords).toHaveAttribute(
      "href",
      new RegExp(`/databases/${database.id}\\?.*rangeProperty=${when.id}`),
    );
    await rangeRecords.click();
    await expect(page.getByRole("link", { name: "Back to dashboard" })).toBeVisible();
    await page.getByRole("link", { name: "Back to dashboard" }).click();
    await expect(page.locator("#dashboard-widget-picker")).toBeVisible();

    // A fixed one-day window proves bars total only the records in it.
    const barsWidget = page.locator("article").filter({
      has: page.getByRole("heading", { name: pie.name }),
    });
    const fixedStart = page.waitForResponse((response) =>
      response.url().endsWith(`/api/databases/${database.id}/views/${pie.id}`)
      && response.request().method() === "PATCH",
    );
    await barsWidget.getByLabel(`Chart range start for ${pie.name}`).fill("2026-11-20");
    assert.equal((await fixedStart).status(), 200);
    const fixedEnd = page.waitForResponse((response) =>
      response.url().endsWith(`/api/databases/${database.id}/views/${pie.id}`)
      && response.request().method() === "PATCH",
    );
    await barsWidget.getByLabel(`Chart range end for ${pie.name}`).fill("2026-11-20");
    assert.equal((await fixedEnd).status(), 200);

    // Pie and bars both surface the same date selection, window, and summary.
    const savedPie = page.waitForResponse((response) =>
      response.url().endsWith(`/api/databases/${database.id}/views/${pie.id}`)
      && response.request().method() === "PATCH",
    );
    await barsWidget.getByLabel(`Chart type for ${pie.name}`).selectOption("pie");
    assert.equal((await savedPie).status(), 200);
    await expect(barsWidget.getByLabel(`Chart dates for ${pie.name}`)).toHaveValue(when.id);
    await expect(barsWidget.getByLabel(`Chart window for ${pie.name}`)).toBeVisible();
    await expect(
      barsWidget.getByText(/Custom range.*Nov 20.*1 record · 1 outside/),
    ).toBeVisible();

    const savedBars = page.waitForResponse((response) =>
      response.url().endsWith(`/api/databases/${database.id}/views/${pie.id}`)
      && response.request().method() === "PATCH",
    );
    await barsWidget.getByLabel(`Chart type for ${pie.name}`).selectOption("bars");
    assert.equal((await savedBars).status(), 200);
    await expect(barsWidget.getByLabel(`Chart dates for ${pie.name}`)).toHaveValue(when.id);
    await expect(barsWidget.getByLabel(`Chart window for ${pie.name}`)).toBeVisible();
    await expect(
      barsWidget.getByText(/Custom range.*Nov 20.*1 record · 1 outside/),
    ).toBeVisible();
    await expect(barsWidget.locator("ul").getByText("2", { exact: true })).toBeVisible();
    await expect(
      barsWidget.getByRole("link", { name: "Open database filtered to Todo" }),
    ).toHaveCount(0);
    const doneSlice = barsWidget.getByRole("link", {
      name: "Open database filtered to Done",
    });
    await expect(doneSlice).toHaveAttribute(
      "href",
      new RegExp(`rangeProperty=${when.id}.*rangeStart=2026-11-20`),
    );
    await doneSlice.click();
    await expect(page).toHaveURL(new RegExp(`filterProperty=${status.id}`));
    await expect(page).toHaveURL(new RegExp(`rangeProperty=${when.id}`));
    const combinedFilter = page.getByRole("status").filter({
      hasText: "Showing records with Status is Done.",
    });
    await expect(combinedFilter).toContainText("When in");
    await expect(page.getByRole("button", { name: "Clear filters" })).toBeVisible();
    await page.getByRole("link", { name: "Back to dashboard" }).click();
    await expect(page.locator("#dashboard-widget-picker")).toBeVisible();

    await barsWidget.getByRole("link", { name: "1 outside" }).click();
    await expect(page).toHaveURL(/rangeMode=outside/);
    await expect(page.getByRole("link", { name: "Back to dashboard" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Record name" })).toHaveCount(1);
    await page.getByRole("link", { name: "Back to dashboard" }).click();
    await expect(page.locator("#dashboard-widget-picker")).toBeVisible();

    const clearedWindow = page.waitForResponse((response) =>
      response.url().endsWith(`/api/databases/${database.id}/views/${pie.id}`)
      && response.request().method() === "PATCH",
    );
    await barsWidget
      .getByRole("button", { name: `Clear date window for ${pie.name}` })
      .click();
    assert.equal((await clearedWindow).status(), 200);
    await expect(barsWidget.getByLabel(`Chart dates for ${pie.name}`)).toHaveValue("");
    await expect(barsWidget.getByLabel(`Chart window for ${pie.name}`)).toHaveCount(0);
    await expect(
      barsWidget.getByRole("link", { name: "Open database filtered to Todo" }),
    ).toBeVisible();
    await expect(barsWidget.locator("ul").getByText("8", { exact: true })).toBeVisible();
  } finally {
    await purgePage(request, fixture.id);
    await cleanupDatabase(request, database.id);
  }
});

test("shows outside-window counts on grouped dashboard bars and pies", async ({ page, request }) => {
  const token = `chart-slice-outside-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const database = await createDatabase(request, `${token} database`);
  const score = await createProperty(request, database.id, { name: "Score", type: "number" });
  const status = await createProperty(request, database.id, {
    name: "Status",
    type: "select",
    options: { choices: ["Todo", "Done", "Archived"] },
  });
  const when = await createProperty(request, database.id, { name: "When", type: "date" });
  const fixture = await createPage(request, { title: `${token} page` });

  try {
    for (const [title, value, statusValue, date] of [
      [`${token} Done in`, 2, "Done", "2026-11-20"],
      [`${token} Todo in`, 8, "Todo", "2026-11-10"],
      [`${token} Todo out`, 4, "Todo", "2026-09-15"],
      [`${token} Archived out`, 3, "Archived", "2026-09-16"],
    ] as const) {
      const record = await createRecord(request, database.id, title);
      assert.equal((await request.patch(`/api/databases/${database.id}/records/${record.id}`, {
        data: { values: { [score.id]: value, [status.id]: statusValue, [when.id]: date } },
      })).status(), 200);
    }

    const view = await json<{ id: string; name: string }>(await request.post(
      `/api/databases/${database.id}/views`,
      {
        data: {
          name: `${token} chart`,
          type: "chart",
          config: {
            chartPropertyId: score.id,
            chartType: "pie",
            chartGroupPropertyId: status.id,
            chartDatePropertyId: when.id,
            chartDateStart: "2026-11-10",
            chartDateEnd: "2026-11-20",
          },
        },
      },
    ));

    await page.goto("/");
    const picker = page.locator("#dashboard-widget-picker");
    await expect(picker).toBeEnabled();
    await picker.selectOption({ label: `${database.name} — ${view.name}` });
    await page.getByRole("button", { name: "Pin", exact: true }).click();

    const widget = page.locator("article").filter({
      has: page.getByRole("heading", { name: view.name }),
    });
    await expect(widget).toBeVisible();
    await expect(widget.getByText(/20% · 2/)).toBeVisible();
    await expect(widget.getByText(/80% · 8 · 1 outside/)).toBeVisible();
    await expect(widget.getByText("Only outside this window:")).toBeVisible();
    await expect(widget.getByRole("link", { name: "Archived", exact: true })).toBeVisible();
    await expect(widget.locator("ul").getByText("Archived", { exact: true })).toHaveCount(0);

    const todoSliceOutside = widget.locator("ul").getByRole("link", {
      name: "Open database filtered to Todo record outside this date window",
      exact: true,
    });
    await expect(todoSliceOutside).toBeVisible();
    const todoOutsideHref = await todoSliceOutside.getAttribute("href");
    assert.ok(todoOutsideHref);
    const todoOutsideUrl = new URL(todoOutsideHref, "https://example.test");
    assert.equal(todoOutsideUrl.searchParams.get("filterProperty"), status.id);
    assert.equal(todoOutsideUrl.searchParams.get("filterValue"), "Todo");
    assert.equal(todoOutsideUrl.searchParams.get("rangeProperty"), when.id);
    assert.equal(todoOutsideUrl.searchParams.get("rangeStart"), "2026-11-10");
    assert.equal(todoOutsideUrl.searchParams.get("rangeEnd"), "2026-11-20");
    assert.equal(todoOutsideUrl.searchParams.get("rangeMode"), "outside");
    assert.equal(todoOutsideUrl.searchParams.get("from"), view.id);
    assert.equal(todoOutsideUrl.searchParams.get("origin"), "dashboard");

    await todoSliceOutside.click();
    await expect(page).toHaveURL(/rangeMode=outside/);
    const todoOutsideBanner = page.getByRole("status");
    await expect(todoOutsideBanner).toContainText("Showing records with Status is Todo.");
    await expect(todoOutsideBanner).toContainText("Showing records with When outside");
    const todoOutsideNames = page.getByRole("textbox", { name: "Record name" });
    await expect(todoOutsideNames).toHaveCount(1);
    await expect(todoOutsideNames).toHaveValue(`${token} Todo out`);
    await page.getByRole("link", { name: "Back to dashboard" }).click();
    await expect(page.locator("#dashboard-widget-picker")).toBeVisible();

    const savedBars = page.waitForResponse((response) =>
      response.url().endsWith(`/api/databases/${database.id}/views/${view.id}`)
      && response.request().method() === "PATCH",
    );
    await widget.getByLabel(`Chart type for ${view.name}`).selectOption("bars");
    assert.equal((await savedBars).status(), 200);
    await expect(widget.locator("ul").getByText(/8 · 1 outside/)).toBeVisible();
    await expect(widget.locator("ul").getByText(/^2$/)).toBeVisible();
    await expect(widget.locator("ul").getByText("Archived", { exact: true })).toHaveCount(0);

    const todoBarOutside = widget.locator("ul").getByRole("link", {
      name: "Open database filtered to Todo record outside this date window",
      exact: true,
    });
    await expect(todoBarOutside).toBeVisible();
    assert.equal(await todoBarOutside.getAttribute("href"), todoOutsideHref);
    await todoBarOutside.click();
    await expect(page).toHaveURL(/rangeMode=outside/);
    await expect(todoOutsideBanner).toContainText("Showing records with Status is Todo.");
    await expect(todoOutsideBanner).toContainText("Showing records with When outside");
    await expect(todoOutsideNames).toHaveCount(1);
    await expect(todoOutsideNames).toHaveValue(`${token} Todo out`);
    await page.getByRole("link", { name: "Back to dashboard" }).click();
    await expect(page.locator("#dashboard-widget-picker")).toBeVisible();

    const outsideGroupLink = widget.getByRole("link", { name: "Archived", exact: true });
    await expect(outsideGroupLink).toBeVisible();
    const outsideHref = await outsideGroupLink.getAttribute("href");
    assert.ok(outsideHref);
    const outsideUrl = new URL(outsideHref, "https://example.test");
    assert.equal(outsideUrl.searchParams.get("filterProperty"), status.id);
    assert.equal(outsideUrl.searchParams.get("filterValue"), "Archived");
    assert.equal(outsideUrl.searchParams.get("rangeProperty"), when.id);
    assert.equal(outsideUrl.searchParams.get("rangeStart"), "2026-11-10");
    assert.equal(outsideUrl.searchParams.get("rangeEnd"), "2026-11-20");
    assert.equal(outsideUrl.searchParams.get("rangeMode"), "outside");
    assert.equal(outsideUrl.searchParams.get("from"), view.id);
    assert.equal(outsideUrl.searchParams.get("origin"), "dashboard");

    await outsideGroupLink.click();
    await expect(page).toHaveURL(/rangeMode=outside/);
    const outsideBanner = page.getByRole("status");
    await expect(outsideBanner).toContainText("Showing records with Status is Archived.");
    await expect(outsideBanner).toContainText("Showing records with When outside");
    const outsideNames = page.getByRole("textbox", { name: "Record name" });
    await expect(outsideNames).toHaveCount(1);
    await expect(outsideNames).toHaveValue(`${token} Archived out`);
  } finally {
    await purgePage(request, fixture.id);
    await cleanupDatabase(request, database.id);
  }
});
