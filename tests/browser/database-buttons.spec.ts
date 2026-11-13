import assert from "node:assert/strict";
import { expect, test, type APIRequestContext, type APIResponse } from "@playwright/test";

async function json<T>(response: APIResponse): Promise<T> {
  const text = await response.text();
  assert.ok(response.ok(), `${response.url()} returned ${response.status()}: ${text}`);
  return JSON.parse(text) as T;
}

async function post<T>(
  request: APIRequestContext,
  url: string,
  data: Record<string, unknown>,
): Promise<T> {
  return await json<T>(await request.post(url, { data }));
}

test("creates and runs a button property across database views and embeds", async ({ page, request }) => {
  test.setTimeout(60_000);
  const token = `buttons-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const database = await post<{ id: string }>(request, "/api/databases", {
    name: `${token} database`,
  });
  let fixtureId = "";
  let targetDatabaseId = "";

  try {
    const targetDatabase = await post<{ id: string }>(request, "/api/databases", {
      name: `${token} archive`,
    });
    targetDatabaseId = targetDatabase.id;
    const targetSource = await post<{ id: string }>(
      request,
      `/api/databases/${targetDatabase.id}/properties`,
      { name: "Source", type: "text" },
    );
    const existingTarget = await post<{ id: string; title: string }>(
      request,
      `/api/databases/${targetDatabase.id}/records`,
      { title: `${token} existing target` },
    );
    const otherTarget = await post<{ id: string; title: string }>(
      request,
      `/api/databases/${targetDatabase.id}/records`,
      { title: `${token} unrelated target` },
    );
    const status = await post<{ id: string }>(
      request,
      `/api/databases/${database.id}/properties`,
      { name: "Status", type: "select", options: { choices: ["Todo", "Done"] } },
    );
    const record = await post<{ id: string; title: string }>(
      request,
      `/api/databases/${database.id}/records`,
      { title: `${token} task` },
    );
    await json(await request.patch(`/api/databases/${database.id}/records/${record.id}`, {
      data: { values: { [status.id]: "Todo" } },
    }));

    const gallery = await post<{ id: string }>(request, `/api/databases/${database.id}/views`, {
      name: "Gallery",
      type: "gallery",
      config: {},
    });
    const board = await post<{ id: string }>(request, `/api/databases/${database.id}/views`, {
      name: "Board",
      type: "board",
      config: { groupBy: status.id },
    });
    const list = await post<{ id: string }>(request, `/api/databases/${database.id}/views`, {
      name: "List",
      type: "list",
      config: {},
    });
    const detail = await json<{ views: { id: string; type: string }[] }>(
      await request.get(`/api/databases/${database.id}`),
    );
    const table = detail.views.find((view) => view.type === "table");
    assert.ok(table);

    await page.goto(`/databases/${database.id}`);

    // Build the button from the property form rather than seeding it through
    // the API, so this covers the action editor as well as the runner.
    await page.getByRole("button", { name: "Add property" }).click();
    await page.getByLabel("Property name").fill("Mark done");
    await page.getByLabel("Type").selectOption("button");
    await page.getByRole("button", { name: "Add action" }).click();
    await page.getByLabel("Property to set").selectOption(status.id);
    await page.getByLabel("Button action value").selectOption("Done");

    // A second action creates a record in another database with a validated
    // initial value. The target property picker appears only after its
    // database details have loaded.
    await page.getByRole("button", { name: "Add action" }).click();
    await page.getByLabel("Action 2").selectOption("create_record");
    await page.getByRole("combobox", { name: "Database", exact: true }).selectOption(targetDatabase.id);
    await page.getByLabel("New record title").fill("Archived from button");
    const addInitialValue = page.getByRole("button", { name: "Add initial value" });
    await expect(addInitialValue).toBeEnabled();
    await addInitialValue.click();
    await page.getByRole("textbox", { name: "Initial value for Source", exact: true }).fill("Created from a task");

    // A third action updates a record the user picks explicitly.
    await page.getByRole("button", { name: "Add action" }).click();
    await page.getByLabel("Action 3").selectOption("set_record_property");
    await page.getByLabel("Record database").selectOption(targetDatabase.id);
    const recordSearch = page.getByRole("combobox", { name: "Search existing records", exact: true });
    await recordSearch.fill("existing target");
    await expect(page.getByText("1 of 2 records match")).toBeVisible();
    const matchingOption = page.getByRole("option", { name: existingTarget.title, exact: true });
    await expect(matchingOption).toBeVisible();
    await expect(matchingOption.locator("mark")).toHaveText("existing target");
    await expect(page.getByRole("option", { name: otherTarget.title, exact: true })).toHaveCount(0);
    await recordSearch.press("ArrowDown");
    await recordSearch.press("Enter");
    await expect(page.getByText(`Selected record: ${existingTarget.title}`)).toBeVisible();
    await page.getByLabel("Property to update").selectOption(targetSource.id);
    await page.getByRole("textbox", { name: "Existing record value", exact: true }).fill("Updated existing record");

    const created = page.waitForResponse((response) =>
      response.url().endsWith(`/api/databases/${database.id}/properties`)
      && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Create property" }).click();
    assert.equal((await created).status(), 201);

    // The saved actions can be reopened and changed without recreating the
    // property. The updated title is what the run below must use.
    await page.getByRole("button", { name: "Configure Mark done button" }).click();
    await expect(page.getByRole("heading", { name: "Edit “Mark done” actions" })).toBeVisible();
    await page.getByLabel("New record title").fill("Archived after edit");
    const savedActions = page.waitForResponse((response) =>
      response.url().includes(`/api/databases/${database.id}/properties/`)
      && response.request().method() === "PATCH",
    );
    await page.getByRole("button", { name: "Save actions" }).click();
    assert.equal((await savedActions).status(), 200);
    await expect(page.getByRole("heading", { name: "Edit “Mark done” actions" })).toBeHidden();

    const run = page.getByRole("button", { name: "Run Mark done" });
    await expect(run).toBeVisible();
    const ran = page.waitForResponse((response) =>
      response.url().endsWith(`/api/databases/${database.id}/records/${record.id}/button`)
      && response.request().method() === "POST",
    );
    await run.click();
    const runResponse = await ran;
    assert.equal(runResponse.status(), 200);
    const runBody = await runResponse.json() as {
      results: { type: string; createdRecordIds?: string[] }[];
    };
    const createdRecordId = runBody.results.find((result) => result.type === "create_record")?.createdRecordIds?.[0];
    assert.ok(createdRecordId, "the create action reports the new record");
    const archive = await json<{
      records: { id: string; title: string; pageId: string | null; values: Record<string, unknown> }[];
    }>(await request.get(`/api/databases/${targetDatabase.id}`));
    const createdRecord = archive.records.find((row) => row.id === createdRecordId);
    assert.equal(createdRecord?.title, "Archived after edit");
    assert.equal(createdRecord?.values[targetSource.id], "Created from a task");
    assert.ok(createdRecord?.pageId, "a button-created record gets a page");
    const updatedExisting = archive.records.find((row) => row.id === existingTarget.id);
    assert.equal(updatedExisting?.values[targetSource.id], "Updated existing record");
    await expect(page.getByRole("status").filter({ hasText: "Status: 1 record" })).toBeVisible();
    await expect(page.getByLabel(`Status for ${record.title}`)).toContainText("Done");

    // Every view renders a runnable cell, not a text placeholder.
    await page.goto(`/databases/${database.id}?view=${gallery.id}`);
    await expect(page.getByRole("button", { name: "Run Mark done" })).toBeVisible();
    await page.goto(`/databases/${database.id}?view=${board.id}`);
    await expect(page.getByRole("button", { name: "Run Mark done" })).toBeVisible();
    await page.goto(`/databases/${database.id}?view=${list.id}`);
    await expect(page.getByRole("button", { name: "Run Mark done" })).toBeVisible();

    // View mode locks the select but must leave the button enabled.
    await json(await request.patch(`/api/databases/${database.id}/records/${record.id}`, {
      data: { values: { [status.id]: "Todo" } },
    }));
    await page.goto(`/databases/${database.id}?view=${table.id}&mode=view`);
    const viewModeButton = page.getByRole("button", { name: "Run Mark done" });
    await expect(viewModeButton).toBeEnabled();
    await viewModeButton.click();
    await expect(page.getByRole("status").filter({ hasText: "Status: 1 record" })).toBeVisible();
    const afterViewRun = await json<{ values: Record<string, unknown> }>(
      await request.get(`/api/databases/${database.id}/records/${record.id}`),
    );
    assert.equal(afterViewRun.values[status.id], "Done");

    // The same button is live inside a database embed.
    await json(await request.patch(`/api/databases/${database.id}/records/${record.id}`, {
      data: { values: { [status.id]: "Todo" } },
    }));
    const fixture = await post<{ id: string }>(request, "/api/pages", { title: `${token} page` });
    fixtureId = fixture.id;
    await json(await request.patch(`/api/pages/${fixture.id}`, {
      data: {
        contentJson: {
          type: "doc",
          content: [{
            type: "databaseEmbed",
            attrs: { databaseId: database.id, viewId: table.id },
          }],
        },
      },
    }));
    await page.goto(`/pages/${fixture.id}`);
    const embedded = page.getByRole("button", { name: "Run Mark done" });
    await expect(embedded).toBeVisible();

    // An embedded view can edit the same property settings, not just run it.
    const embeddedSettings = page.getByRole("button", { name: "Configure Mark done button" });
    await expect(embeddedSettings).toBeVisible();
    await embeddedSettings.click();
    await expect(page.getByRole("heading", { name: "Edit “Mark done” actions" })).toBeVisible();
    await page.getByLabel("New record title").fill("Archived from embed");
    const embeddedSave = page.waitForResponse((response) =>
      response.url().includes(`/api/databases/${database.id}/properties/`)
      && response.request().method() === "PATCH",
    );
    await page.getByRole("button", { name: "Save actions" }).click();
    assert.equal((await embeddedSave).status(), 200);
    await expect(page.getByRole("heading", { name: "Edit “Mark done” actions" })).toBeHidden();

    const embeddedRun = page.waitForResponse((response) =>
      response.url().endsWith(`/api/databases/${database.id}/records/${record.id}/button`)
      && response.request().method() === "POST",
    );
    await embedded.click();
    const embeddedRunResponse = await embeddedRun;
    assert.equal(embeddedRunResponse.status(), 200);
    const embeddedRunBody = await embeddedRunResponse.json() as {
      results: { type: string; createdRecordIds?: string[] }[];
    };
    const embeddedCreatedId = embeddedRunBody.results.find((result) => result.type === "create_record")?.createdRecordIds?.[0];
    assert.ok(embeddedCreatedId, "the embedded run reports its new record");
    const embeddedArchive = await json<{ records: { id: string; title: string }[] }>(
      await request.get(`/api/databases/${targetDatabase.id}`),
    );
    assert.equal(embeddedArchive.records.find((row) => row.id === embeddedCreatedId)?.title, "Archived from embed");
    await expect(page.getByRole("status").filter({ hasText: "Status: 1 record" })).toBeVisible();
    const afterEmbedRun = await json<{ values: Record<string, unknown> }>(
      await request.get(`/api/databases/${database.id}/records/${record.id}`),
    );
    assert.equal(afterEmbedRun.values[status.id], "Done");
  } finally {
    if (fixtureId) {
      await request.delete(`/api/pages/${fixtureId}`);
      await request.delete(`/api/trash/${fixtureId}`);
    }
    for (const databaseId of [database.id, targetDatabaseId].filter(Boolean)) {
      const loaded = await request.get(`/api/databases/${databaseId}`);
      if (loaded.ok()) {
        const data = await json<{ records: { pageId: string | null }[] }>(loaded);
        for (const row of data.records) {
          if (!row.pageId) continue;
          await request.delete(`/api/pages/${row.pageId}`);
          await request.delete(`/api/trash/${row.pageId}`);
        }
      }
      await request.delete(`/api/databases/${databaseId}`);
    }
  }
});
