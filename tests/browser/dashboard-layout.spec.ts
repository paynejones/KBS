import assert from "node:assert/strict";
import { expect, test, type APIRequestContext, type APIResponse, type Page } from "@playwright/test";

type PageRow = { id: string; title: string };

const DEFAULT_ORDER = [
  "resume",
  "queues",
  "pinned-projects",
  "timeline",
  "recent",
  "views",
  "favorites",
  "reading",
  "inbox",
  "saved-searches",
  "databases",
];

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

async function widgetOrder(page: Page): Promise<(string | null)[]> {
  return await page
    .locator("[data-dashboard-widget]")
    .evaluateAll((elements) => elements.map((element) => element.getAttribute("data-dashboard-widget")));
}

test("customizes, reorders, hides, and resets the home dashboard", async ({ page, request }) => {
  test.slow();
  const token = `dashboard-layout-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const seeded = await createPage(request, `${token} page`);

  try {
    await page.goto("/");
    await expect(page.locator("[data-dashboard-widget]").first()).toBeVisible();
    assert.deepEqual(await widgetOrder(page), DEFAULT_ORDER);

    // Entering customize mode adds controls but no arrangement change.
    await page.getByRole("button", { name: "Customize" }).click();
    await expect(page.getByRole("button", { name: "Hide Timeline" })).toBeVisible();

    // Hiding removes the widget and persists across a reload.
    await page.getByRole("button", { name: "Hide Timeline" }).click();
    await expect(page.locator('[data-dashboard-widget="timeline"]')).toHaveCount(0);
    await page.reload();
    await expect(page.locator("[data-dashboard-widget]").first()).toBeVisible();
    await expect(page.locator('[data-dashboard-widget="timeline"]')).toHaveCount(0);

    // Restoring puts it back in its saved position.
    await page.getByRole("button", { name: "Customize" }).click();
    await expect(page.getByRole("heading", { name: "Hidden widgets" })).toBeVisible();
    await page.getByRole("button", { name: "Show Timeline" }).click();
    await expect(page.locator('[data-dashboard-widget="timeline"]')).toBeVisible();
    assert.deepEqual(await widgetOrder(page), DEFAULT_ORDER);

    // A width override is independent of order and survives a reload.
    await page.getByLabel("Width for Jump back in").selectOption("full");
    await expect(page.locator('[data-dashboard-widget="recent"]')).toHaveAttribute(
      "data-widget-span",
      "full",
    );
    await page.reload();
    await expect(page.locator("[data-dashboard-widget]").first()).toBeVisible();
    await expect(page.locator('[data-dashboard-widget="recent"]')).toHaveAttribute(
      "data-widget-span",
      "full",
    );
    await page.getByRole("button", { name: "Customize" }).click();

    // Arrow controls move a widget one slot at a time.
    await page.getByRole("button", { name: "Move Jump back in up" }).click();
    await page.getByRole("button", { name: "Move Jump back in up" }).click();
    assert.deepEqual(await widgetOrder(page), [
      "resume",
      "queues",
      "recent",
      "pinned-projects",
      "timeline",
      "views",
      "favorites",
      "reading",
      "inbox",
      "saved-searches",
      "databases",
    ]);

    // A native drag from the handle onto another widget reorders it.
    await page.evaluate(() => {
      const handle = document.querySelector('[data-widget-drag="views"]');
      const target = document.querySelector('[data-dashboard-widget="resume"]');
      if (!(handle instanceof HTMLElement) || !(target instanceof HTMLElement)) {
        throw new Error("missing dashboard drag nodes");
      }
      const data = new DataTransfer();
      handle.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: data }));
      target.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: data }));
      target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: data }));
      handle.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: data }));
    });
    await expect
      .poll(async () => (await widgetOrder(page))[0])
      .toBe("views");

    // The saved arrangement survives a reload and Reset restores the default.
    await page.reload();
    await expect(page.locator("[data-dashboard-widget]").first()).toBeVisible();
    assert.equal((await widgetOrder(page))[0], "views");
    await page.getByRole("button", { name: "Customize" }).click();
    await page.getByRole("button", { name: "Reset layout" }).click();
    assert.deepEqual(await widgetOrder(page), DEFAULT_ORDER);
    await expect(page.locator('[data-dashboard-widget="recent"]')).toHaveAttribute(
      "data-widget-span",
      "half",
    );

    await page.reload();
    await expect(page.locator("[data-dashboard-widget]").first()).toBeVisible();
    assert.deepEqual(await widgetOrder(page), DEFAULT_ORDER);

    // Locking stops editing, hides every control, and persists.
    await page.getByRole("button", { name: "Customize" }).click();
    await page.getByRole("button", { name: "Lock layout" }).click();
    await expect(page.getByRole("button", { name: "Customize" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Unlock homepage editing" })).toBeVisible();
    await expect(page.locator("[data-widget-drag]")).toHaveCount(0);
    await expect(page.getByLabel("Width for Jump back in")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Lock layout" })).toHaveCount(0);

    await page.reload();
    await expect(page.locator("[data-dashboard-widget]").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Customize" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Unlock homepage editing" })).toBeVisible();
    assert.deepEqual(await widgetOrder(page), DEFAULT_ORDER);

    await page.getByRole("button", { name: "Unlock homepage editing" }).click();
    await expect(page.getByRole("button", { name: "Customize" })).toBeVisible();
  } finally {
    await purgePage(request, seeded.id);
  }
});
