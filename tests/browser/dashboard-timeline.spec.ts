import assert from "node:assert/strict";
import { expect, test, type APIRequestContext, type APIResponse } from "@playwright/test";

type Database = { id: string; name: string };
type Property = { id: string; name: string; type: string };
type RecordRow = { id: string; title: string; pageId: string };

async function json<T>(response: APIResponse): Promise<T> {
  const text = await response.text();
  assert.ok(response.ok(), `${response.url()} returned ${response.status()}: ${text}`);
  return JSON.parse(text) as T;
}

function todayKey(): string {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

async function cleanup(
  request: APIRequestContext,
  databaseIds: string[],
  pageIds: string[],
) {
  for (const pageId of pageIds) {
    const trashed = await request.delete(`/api/pages/${pageId}`);
    if (trashed.ok()) await request.delete(`/api/trash/${pageId}`);
  }
  for (const databaseId of databaseIds) {
    await request.delete(`/api/databases/${databaseId}`);
  }
}

test("shows dated records from several databases on the home timeline", async ({ page, request }) => {
  const token = `timeline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const databaseIds: string[] = [];
  const pageIds: string[] = [];

  try {
    const tasks = await json<Database>(
      await request.post("/api/databases", { data: { name: `${token} tasks` } }),
    );
    databaseIds.push(tasks.id);
    const reading = await json<Database>(
      await request.post("/api/databases", { data: { name: `${token} reading` } }),
    );
    databaseIds.push(reading.id);

    // The home dashboard only renders once the workspace has a regular page;
    // record pages are deliberately kept out of the page list.
    const homePage = await json<{ id: string }>(await request.post("/api/pages", {
      data: { title: `${token} home page` },
    }));
    pageIds.push(homePage.id);

    const due = await json<Property>(await request.post(
      `/api/databases/${tasks.id}/properties`,
      { data: { name: "Due", type: "date" } },
    ));
    const finished = await json<Property>(await request.post(
      `/api/databases/${reading.id}/properties`,
      { data: { name: "Finished", type: "date" } },
    ));

    const taskTitle = `${token} ship beta`;
    const taskRecord = await json<RecordRow>(await request.post(
      `/api/databases/${tasks.id}/records`,
      { data: { title: taskTitle } },
    ));
    pageIds.push(taskRecord.pageId);
    const bookTitle = `${token} finish chapter`;
    const bookRecord = await json<RecordRow>(await request.post(
      `/api/databases/${reading.id}/records`,
      { data: { title: bookTitle } },
    ));
    pageIds.push(bookRecord.pageId);

    for (const [databaseId, recordId, propertyId] of [
      [tasks.id, taskRecord.id, due.id],
      [reading.id, bookRecord.id, finished.id],
    ]) {
      const updated = await request.patch(
        `/api/databases/${databaseId}/records/${recordId}`,
        { data: { values: { [propertyId]: todayKey() } } },
      );
      assert.ok(updated.ok(), `updating the date returned ${updated.status()}`);
    }

    await page.goto("/");
    const timeline = page.locator("section").filter({
      has: page.getByRole("heading", { name: "Timeline" }),
    });
    await expect(timeline).toBeVisible();

    await expect(timeline.getByRole("link", { name: taskTitle })).toBeVisible();
    await expect(timeline).toContainText(`${token} tasks`);
    await expect(timeline).toContainText("Due");

    await expect(timeline.getByRole("link", { name: bookTitle })).toBeVisible();
    await expect(timeline).toContainText(`${token} reading`);
    await expect(timeline).toContainText("Finished");
  } finally {
    await cleanup(request, databaseIds, pageIds);
  }
});
