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

    const relationTrigger = page.getByRole("button", {
      name: `Add ${relation.name} relation`,
    });
    await expect(relationTrigger).toBeVisible();

    const assigned = page.waitForResponse((response) =>
      response.url().endsWith(`/records/${sourceRecord.id}`)
      && response.request().method() === "PATCH",
    );
    await relationTrigger.click();
    // The record page also has a "Choose a record to link" select for page
    // links, so scope the option to this property's own listbox.
    const relationOptions = page.getByRole("listbox", {
      name: `${relation.name} relation options`,
    });
    await expect(relationOptions).toBeVisible();
    await relationOptions.getByRole("option", { name: targetRecord.title }).click();
    assert.equal((await assigned).status(), 200);
    await expect.poll(async () => (
      await getRelations(request, ownerDatabase.id, sourceRecord.id)
    )[relation.id] ?? []).toEqual([targetRecord.id]);

    await page.reload();
    const removeRelation = page.getByRole("button", {
      name: `Remove ${targetRecord.title}`,
    });
    await expect(removeRelation).toBeVisible();

    const cleared = page.waitForResponse((response) =>
      response.url().endsWith(`/records/${sourceRecord.id}`)
      && response.request().method() === "PATCH",
    );
    await removeRelation.click();
    assert.equal((await cleared).status(), 200);
    await expect.poll(async () => (
      await getRelations(request, ownerDatabase.id, sourceRecord.id)
    )[relation.id] ?? []).toEqual([]);

    await page.reload();
    await expect(page.getByRole("button", {
      name: `Remove ${targetRecord.title}`,
    })).toHaveCount(0);
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

test("shows the records whose relations point at a record", async ({ page, request }) => {
  const token = `relation-inbound-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
          name: "Inspiration",
          type: "relation",
          options: { relatedDatabaseId: targetDatabase.id },
        },
      },
    ));

    const targetRecord = await createRecord(request, targetDatabase.id, `${token} target record`);
    pageIds.push(targetRecord.pageId);
    const sourceRecord = await createRecord(request, ownerDatabase.id, `${token} source record`);
    pageIds.push(sourceRecord.pageId);

    const assigned = await request.patch(
      `/api/databases/${ownerDatabase.id}/records/${sourceRecord.id}`,
      { data: { relations: { [relation.id]: [targetRecord.id] } } },
    );
    assert.ok(assigned.ok(), `assigning the relation returned ${assigned.status()}`);

    await page.goto(`/databases/${targetDatabase.id}/records/${targetRecord.id}`);
    await expect(page.getByRole("heading", { name: "Linked from" })).toBeVisible();

    const sourceLink = page.getByRole("link", { name: sourceRecord.title });
    await expect(sourceLink).toBeVisible();
    await expect(sourceLink).toHaveAttribute(
      "href",
      `/databases/${ownerDatabase.id}/records/${sourceRecord.id}`,
    );

    const sourceItem = page.getByRole("listitem").filter({
      has: page.getByRole("link", { name: sourceRecord.title }),
    });
    await expect(sourceItem).toContainText("Inspiration");
    await expect(sourceItem).toContainText(ownerDatabase.name);
  } finally {
    await cleanup(request, databaseIds, pageIds);
  }
});
