import assert from "node:assert/strict";
import { expect, test, type APIRequestContext, type APIResponse } from "@playwright/test";

type Database = { id: string; name: string };
type Property = { id: string; name: string; type: string };
type RecordRow = {
  id: string;
  title: string;
  pageId: string;
  relations: Record<string, string[]>;
};

async function json<T>(response: APIResponse): Promise<T> {
  const text = await response.text();
  assert.ok(response.ok(), `${response.url()} returned ${response.status()}: ${text}`);
  return JSON.parse(text) as T;
}

async function createDatabase(request: APIRequestContext, name: string): Promise<Database> {
  return await json<Database>(await request.post("/api/databases", { data: { name } }));
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

async function getRelations(
  request: APIRequestContext,
  databaseId: string,
  recordId: string,
): Promise<Record<string, string[]>> {
  const record = await json<RecordRow>(
    await request.get(`/api/databases/${databaseId}/records/${recordId}`),
  );
  return record.relations;
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

test("assigns and clears a database relation from the record page", async ({ page, request }) => {
  const token = `relation-ui-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const databaseIds: string[] = [];
  const pageIds: string[] = [];

  try {
    const targetDatabase = await createDatabase(request, `${token} target`);
    databaseIds.push(targetDatabase.id);
    const ownerDatabase = await createDatabase(request, `${token} owner`);
    databaseIds.push(ownerDatabase.id);

    const relation = await json<Property>(await request.post(
      `/api/databases/${ownerDatabase.id}/properties`,
      {
        data: {
          name: "Related",
          type: "relation",
          options: { relatedDatabaseId: targetDatabase.id },
        },
      },
    ));

    const targetRecord = await createRecord(request, targetDatabase.id, `${token} target record`);
    pageIds.push(targetRecord.pageId);
    const sourceRecord = await createRecord(request, ownerDatabase.id, `${token} source record`);
    pageIds.push(sourceRecord.pageId);

    await page.goto(`/databases/${ownerDatabase.id}/records/${sourceRecord.id}`);
    await expect(page.getByLabel("Record title")).toHaveValue(sourceRecord.title);

    const relationSelect = page.getByLabel(`${relation.name} relations`);
    await expect(relationSelect).toBeVisible();
    await expect(relationSelect.locator("option")).toContainText([targetRecord.title]);

    const assigned = page.waitForResponse((response) =>
      response.url().endsWith(`/records/${sourceRecord.id}`)
      && response.request().method() === "PATCH",
    );
    await relationSelect.selectOption([targetRecord.id]);
    assert.equal((await assigned).status(), 200);
    await expect.poll(async () => (
      await getRelations(request, ownerDatabase.id, sourceRecord.id)
    )[relation.id] ?? []).toEqual([targetRecord.id]);

    await page.reload();
    const persistedRelation = page.getByLabel(`${relation.name} relations`);
    await expect(persistedRelation.locator("option")).toContainText([targetRecord.title]);
    await expect(persistedRelation.locator("option:checked")).toHaveText(targetRecord.title);

    const cleared = page.waitForResponse((response) =>
      response.url().endsWith(`/records/${sourceRecord.id}`)
      && response.request().method() === "PATCH",
    );
    await persistedRelation.selectOption([]);
    assert.equal((await cleared).status(), 200);
    await expect.poll(async () => (
      await getRelations(request, ownerDatabase.id, sourceRecord.id)
    )[relation.id] ?? []).toEqual([]);

    await page.reload();
    const clearedRelation = page.getByLabel(`${relation.name} relations`);
    await expect(clearedRelation.locator("option")).toContainText([targetRecord.title]);
    await expect(clearedRelation.locator("option:checked")).toHaveCount(0);
  } finally {
    await cleanup(request, databaseIds, pageIds);
  }
});

test("assigns and clears a database relation from the table view", async ({ page, request }) => {
  const token = `relation-table-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const databaseIds: string[] = [];
  const pageIds: string[] = [];

  try {
    const targetDatabase = await createDatabase(request, `${token} target`);
    databaseIds.push(targetDatabase.id);
    const ownerDatabase = await createDatabase(request, `${token} owner`);
    databaseIds.push(ownerDatabase.id);

    const relation = await json<Property>(await request.post(
      `/api/databases/${ownerDatabase.id}/properties`,
      {
        data: {
          name: "Related",
          type: "relation",
          options: { relatedDatabaseId: targetDatabase.id },
        },
      },
    ));

    const targetRecord = await createRecord(request, targetDatabase.id, `${token} target record`);
    pageIds.push(targetRecord.pageId);
    const sourceRecord = await createRecord(request, ownerDatabase.id, `${token} source record`);
    pageIds.push(sourceRecord.pageId);

    await page.goto(`/databases/${ownerDatabase.id}`);
    await expect(page.getByLabel("Database name")).toHaveValue(ownerDatabase.name);

    const relationCell = page.getByLabel(`${relation.name} relations for ${sourceRecord.title}`);
    await expect(relationCell).toBeVisible();
    await expect(relationCell.locator("option")).toContainText([targetRecord.title]);

    await relationCell.focus();
    await relationCell.selectOption([targetRecord.id]);
    const assigned = page.waitForResponse((response) =>
      response.url().endsWith(`/records/${sourceRecord.id}`)
      && response.request().method() === "PATCH",
    );
    await page.getByLabel("Database name").click();
    assert.equal((await assigned).status(), 200);
    await expect.poll(async () => (
      await getRelations(request, ownerDatabase.id, sourceRecord.id)
    )[relation.id] ?? []).toEqual([targetRecord.id]);

    await page.reload();
    const persistedRelation = page.getByLabel(`${relation.name} relations for ${sourceRecord.title}`);
    await expect(persistedRelation.locator("option")).toContainText([targetRecord.title]);
    await expect(persistedRelation.locator("option:checked")).toHaveText(targetRecord.title);

    await persistedRelation.focus();
    await persistedRelation.selectOption([]);
    const cleared = page.waitForResponse((response) =>
      response.url().endsWith(`/records/${sourceRecord.id}`)
      && response.request().method() === "PATCH",
    );
    await page.getByLabel("Database name").click();
    assert.equal((await cleared).status(), 200);
    await expect.poll(async () => (
      await getRelations(request, ownerDatabase.id, sourceRecord.id)
    )[relation.id] ?? []).toEqual([]);

    await page.reload();
    const clearedRelation = page.getByLabel(`${relation.name} relations for ${sourceRecord.title}`);
    await expect(clearedRelation.locator("option")).toContainText([targetRecord.title]);
    await expect(clearedRelation.locator("option:checked")).toHaveCount(0);
  } finally {
    await cleanup(request, databaseIds, pageIds);
  }
});
