import assert from "node:assert/strict";
import { expect, test, type APIRequestContext, type APIResponse } from "@playwright/test";

type Database = { id: string; name: string };
type Property = { id: string; name: string; type: string };
type RecordRow = { id: string; title: string; pageId: string; values: Record<string, unknown> };

async function json<T>(response: APIResponse): Promise<T> {
  const text = await response.text();
  assert.ok(response.ok(), `${response.url()} returned ${response.status()}: ${text}`);
  return JSON.parse(text) as T;
}

async function createDatabase(request: APIRequestContext, name: string): Promise<Database> {
  return await json<Database>(await request.post("/api/databases", { data: { name } }));
}

async function createProperty(
  request: APIRequestContext,
  databaseId: string,
  data: Record<string, unknown>,
): Promise<Property> {
  return await json<Property>(
    await request.post(`/api/databases/${databaseId}/properties`, { data }),
  );
}

async function createRecord(
  request: APIRequestContext,
  databaseId: string,
  title: string,
): Promise<RecordRow> {
  return await json<RecordRow>(
    await request.post(`/api/databases/${databaseId}/records`, { data: { title } }),
  );
}

async function setValues(
  request: APIRequestContext,
  databaseId: string,
  recordId: string,
  values: Record<string, unknown>,
) {
  await json<RecordRow>(
    await request.patch(`/api/databases/${databaseId}/records/${recordId}`, {
      data: { values },
    }),
  );
}

async function storedValues(
  request: APIRequestContext,
  databaseId: string,
  recordId: string,
): Promise<Record<string, unknown>> {
  const detail = await json<{ records: RecordRow[] }>(
    await request.get(`/api/databases/${databaseId}`),
  );
  return detail.records.find((record) => record.id === recordId)?.values ?? {};
}

async function purgePage(request: APIRequestContext, id: string) {
  const trashed = await request.delete(`/api/pages/${id}`);
  if (trashed.ok()) await request.delete(`/api/trash/${id}`);
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

test("shows select values as a short pill and edits them from the keyboard", async ({ page, request }) => {
  const token = `select-cell-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const database = await createDatabase(request, `${token} database`);
  const status = await createProperty(request, database.id, {
    name: "Status",
    type: "select",
    options: { choices: ["Todo", "In progress", "Done"] },
  });
  const record = await createRecord(request, database.id, `${token} record`);

  try {
    await setValues(request, database.id, record.id, { [status.id]: "Done" });
    await page.goto(`/databases/${database.id}`);

    const cell = page.getByRole("button", { name: `Status for ${record.title}` });
    await expect(cell).toBeVisible();
    await expect(cell).toHaveText("Done");

    await cell.focus();
    await page.keyboard.press("ArrowDown");
    const listbox = page.getByRole("listbox", { name: "Status choices" });
    await expect(listbox).toBeVisible();
    await expect(listbox.getByRole("option")).toHaveText(["Todo", "In progress", "Done"]);
    await expect(listbox.getByRole("option", { name: "Done" })).toBeFocused();

    const saved = page.waitForResponse((response) =>
      response.url().endsWith(`/records/${record.id}`)
      && response.request().method() === "PATCH",
    );
    await page.keyboard.press("Home");
    await page.keyboard.press("Enter");
    assert.equal((await saved).status(), 200);

    await expect(cell).toHaveText("Todo");
    await expect.poll(async () => (
      await storedValues(request, database.id, record.id)
    )[status.id]).toBe("Todo");

    // Tab out of the option list reaches Clear, and Enter clears the value.
    await cell.click();
    await expect(listbox).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Clear" })).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(cell).toHaveText("Choose…");
    await page.reload();
    await expect(page.getByRole("button", { name: `Status for ${record.title}` })).toHaveText(
      "Choose…",
    );
  } finally {
    await cleanupDatabase(request, database.id);
  }
});

test("flips a date picker above a cell at the bottom edge and saves the date", async ({ page, request }) => {
  const token = `date-cell-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const database = await createDatabase(request, `${token} database`);
  const due = await createProperty(request, database.id, { name: "Due", type: "date" });
  const record = await createRecord(request, database.id, `${token} record`);

  try {
    await setValues(request, database.id, record.id, { [due.id]: "2026-11-19" });
    for (let index = 0; index < 15; index += 1) {
      await createRecord(request, database.id, `${token} filler ${index}`);
    }

    await page.setViewportSize({ width: 1280, height: 640 });
    await page.goto(`/databases/${database.id}`);

    const cell = page.getByRole("button", { name: `Due for ${record.title}` });
    await expect(cell).toBeVisible();
    const initialText = (await cell.textContent())?.trim() ?? "";
    assert.ok(/\d/.test(initialText), `the cell shows a short date, got "${initialText}"`);
    assert.ok(!initialText.includes("2026"), "the cell does not show the stored ISO value");

    // Put the cell's bottom edge on the viewport's bottom edge, so the picker
    // has no room below it and must flip above.
    await cell.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      window.scrollBy(0, rect.bottom - window.innerHeight + 2);
    });
    await cell.click();
    const dialog = page.getByRole("dialog", { name: "Due picker" });
    await expect(dialog).toBeVisible();

    // Measured after opening: focusing the field can nudge the page, and the
    // picker re-anchors to wherever the cell ends up.
    const cellBox = await cell.boundingBox();
    assert.ok(cellBox, "the date cell has a box");
    assert.ok(cellBox.y > 300, `the cell sits near the bottom edge, top was ${cellBox.y}`);
    const dialogBox = await dialog.boundingBox();
    assert.ok(dialogBox, "the picker has a box");
    assert.ok(dialogBox.y >= 0, "the picker stays below the top edge");
    assert.ok(
      dialogBox.y + dialogBox.height <= cellBox.y + 1,
      `the picker flips above the cell: picker ends at ${dialogBox.y + dialogBox.height}, cell starts at ${cellBox.y}`,
    );

    const input = page.getByLabel("Due date");
    await expect(input).toHaveValue("2026-11-19");

    const saved = page.waitForResponse((response) =>
      response.url().endsWith(`/records/${record.id}`)
      && response.request().method() === "PATCH",
    );
    await input.fill("2026-12-01");
    assert.equal((await saved).status(), 200);
    await expect.poll(async () => (
      await storedValues(request, database.id, record.id)
    )[due.id]).toBe("2026-12-01");

    await page.reload();
    const reloaded = page.getByRole("button", { name: `Due for ${record.title}` });
    const nextText = (await reloaded.textContent())?.trim() ?? "";
    assert.ok(nextText && nextText !== initialText, "the cell shows the new date");
    assert.ok(!nextText.includes("2026"), "the cell keeps the short format");
  } finally {
    await cleanupDatabase(request, database.id);
  }
});
