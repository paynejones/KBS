import assert from "node:assert/strict";
import { expect, test, type APIRequestContext, type APIResponse } from "@playwright/test";

async function json<T>(response: APIResponse): Promise<T> {
  const text = await response.text();
  assert.ok(response.ok(), `${response.url()} returned ${response.status()}: ${text}`);
  return JSON.parse(text) as T;
}

async function purgePage(request: APIRequestContext, id: string) {
  const trashed = await request.delete(`/api/pages/${id}`);
  if (trashed.ok()) await request.delete(`/api/trash/${id}`);
}

test("hides individual properties and the whole properties block on an entry page", async ({ page, request }) => {
  const token = `record-properties-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const database = await json<{ id: string }>(await request.post("/api/databases", {
    data: { name: `${token} database` },
  }));
  const status = await json<{ id: string }>(
    await request.post(`/api/databases/${database.id}/properties`, {
      data: { name: "Status", type: "select", options: { choices: ["Todo", "Done"] } },
    }),
  );
  const owner = await json<{ id: string }>(
    await request.post(`/api/databases/${database.id}/properties`, {
      data: { name: "Owner", type: "text" },
    }),
  );
  const record = await json<{ id: string; pageId: string }>(
    await request.post(`/api/databases/${database.id}/records`, {
      data: { title: `${token} entry` },
    }),
  );

  try {
    await json(await request.patch(`/api/databases/${database.id}/records/${record.id}`, {
      data: { values: { [status.id]: "Todo", [owner.id]: "Ada" } },
    }));

    await page.goto(`/pages/${record.pageId}`);
    await expect(page.getByLabel("Record title")).toBeVisible();

    const properties = page.locator("#record-properties");
    const statusRow = page.locator(`[data-record-property="${status.id}"]`);
    const ownerRow = page.locator(`[data-record-property="${owner.id}"]`);
    await expect(properties).toBeVisible();
    await expect(statusRow).toBeVisible();
    await expect(ownerRow).toBeVisible();

    await page.getByRole("button", { name: "Hide Status" }).click();
    await expect(statusRow).toBeHidden();
    await expect(ownerRow).toBeVisible();
    await expect(page.locator("summary").filter({ hasText: "Hidden properties" })).toBeVisible();

    // The per-database preference survives a reload.
    await page.reload();
    await expect(page.getByLabel("Record title")).toBeVisible();
    await expect(ownerRow).toBeVisible();
    await expect(statusRow).toBeHidden();

    await page.locator("summary").filter({ hasText: "Hidden properties" }).click();
    await page.getByRole("button", { name: "Show Status" }).click();
    await expect(statusRow).toBeVisible();
    await expect(page.locator("summary").filter({ hasText: "Hidden properties" })).toHaveCount(0);

    await expect(page.getByRole("button", { name: "Hide properties" })).toBeVisible();
    await page.getByRole("button", { name: "Hide properties" }).click();
    await expect(properties).toBeHidden();
    await expect(page.getByRole("button", { name: "Show properties" })).toBeVisible();
    await expect(page.getByLabel("Record title")).toBeVisible();

    await page.getByRole("button", { name: "Show properties" }).click();
    await expect(properties).toBeVisible();
    await expect(page.getByRole("button", { name: "Hide properties" })).toBeVisible();
  } finally {
    await purgePage(request, record.pageId);
    await request.delete(`/api/databases/${database.id}`);
  }
});
