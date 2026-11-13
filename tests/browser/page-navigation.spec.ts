import assert from "node:assert/strict";
import { expect, test, type APIRequestContext, type APIResponse } from "@playwright/test";

type PageRow = { id: string; title: string; content: string };

async function json<T>(response: APIResponse): Promise<T> {
  const text = await response.text();
  assert.ok(response.ok(), `${response.url()} returned ${response.status()}: ${text}`);
  return JSON.parse(text) as T;
}

async function createPage(
  request: APIRequestContext,
  data: Record<string, unknown>,
): Promise<PageRow> {
  return await json<PageRow>(await request.post("/api/pages", { data }));
}

async function purgePage(request: APIRequestContext, id: string) {
  const trashed = await request.delete(`/api/pages/${id}`);
  if (trashed.ok()) await request.delete(`/api/trash/${id}`);
}

test("rapid page navigation still renders the destination editor", async ({ page, request }) => {
  const token = `rapid-nav-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const fixtures: PageRow[] = [];

  try {
    for (let index = 0; index < 4; index += 1) {
      fixtures.push(
        await createPage(request, {
          title: `${token} ${index}`,
          content: `<p>${token} body ${index}</p>`,
        }),
      );
    }

    await page.goto("/pages");

    // The sidebar's tree is the navigation surface the report came from.
    for (const fixture of fixtures) {
      await expect(
        page.locator(`aside a[href="/pages/${fixture.id}"]`),
      ).toBeVisible();
    }

    // Click straight through the pages without waiting for a navigation to
    // settle, so several route transitions overlap.
    await page.evaluate(async (ids) => {
      for (const id of ids) {
        document
          .querySelector<HTMLAnchorElement>(`aside a[href="/pages/${id}"]`)
          ?.click();
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }, fixtures.map((fixture) => fixture.id));

    // Overlapping transitions may commit any of the clicked pages, so assert
    // that whichever one won still renders its own editor rather than a stale
    // fallback or the global error page.
    const destinationIndex = fixtures.findIndex((fixture) =>
      page.url().endsWith(`/pages/${fixture.id}`),
    );
    assert.notEqual(destinationIndex, -1, "navigation ended on a clicked page");

    const editor = page.locator(".ProseMirror");
    await expect(editor).toBeEditable();
    await expect(editor).toContainText(`${token} body ${destinationIndex}`);
    await expect(
      page.getByRole("heading", { name: /this page couldn.t load/i }),
    ).toHaveCount(0);
    await expect(page.getByText("Reload to try again")).toHaveCount(0);
  } finally {
    for (const fixture of fixtures) await purgePage(request, fixture.id);
  }
});
