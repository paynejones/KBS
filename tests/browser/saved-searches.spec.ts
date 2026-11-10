import assert from "node:assert/strict";
import { expect, test, type APIRequestContext, type APIResponse } from "@playwright/test";

type PageRow = { id: string; title: string };

async function json<T>(response: APIResponse): Promise<T> {
  const text = await response.text();
  assert.ok(response.ok(), `${response.url()} returned ${response.status()}: ${text}`);
  return JSON.parse(text) as T;
}

async function createPage(request: APIRequestContext, title: string): Promise<PageRow> {
  return await json<PageRow>(await request.post("/api/pages", { data: { title } }));
}

async function purgePage(request: APIRequestContext, id: string) {
  const trashed = await request.delete(`/api/pages/${id}`);
  if (trashed.ok()) await request.delete(`/api/trash/${id}`);
}

test("keeps a saved search as a live collection", async ({ page, request }) => {
  const token = `collection-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const first = await createPage(request, `${token} first note`);
  const second = await createPage(request, `${token} second note`);
  let third: PageRow | null = null;

  try {
    await page.goto("/searches");
    await page.getByLabel("Collection name").fill(token);
    await page.getByLabel("Search terms").fill(token);
    await page.getByRole("button", { name: "Save search" }).click();

    const card = page.locator("article").filter({ hasText: token });
    await expect(card.getByRole("heading", { name: token })).toBeVisible();
    await expect(card.getByRole("link", { name: first.title })).toBeVisible();
    await expect(card.getByRole("link", { name: second.title })).toBeVisible();
    await expect(card.getByText("2 pages match right now")).toBeVisible();

    // A page saved later joins the collection without editing the search.
    third = await createPage(request, `${token} third note`);
    await page.reload();
    const reloaded = page.locator("article").filter({ hasText: token });
    await expect(reloaded.getByRole("link", { name: third.title })).toBeVisible();
    await expect(reloaded.getByText("3 pages match right now")).toBeVisible();

    await reloaded.getByRole("button", { name: `Delete ${token}` }).click();
    await page.getByRole("button", { name: "Delete search" }).click();
    await expect(card).toHaveCount(0);

    // The matched pages outlive the collection.
    assert.equal((await request.get(`/api/pages/${first.id}`)).status(), 200);
  } finally {
    if (third) await purgePage(request, third.id);
    await purgePage(request, first.id);
    await purgePage(request, second.id);
  }
});
