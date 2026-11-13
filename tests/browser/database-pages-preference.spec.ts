import assert from "node:assert/strict";
import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
} from "@playwright/test";

type Database = { id: string; name: string };
type RecordRow = { id: string; title: string; pageId: string };

async function json<T>(response: APIResponse): Promise<T> {
  const text = await response.text();
  assert.ok(
    response.ok(),
    `${response.url()} returned ${response.status()}: ${text}`,
  );
  return JSON.parse(text) as T;
}

async function cleanupDatabase(request: APIRequestContext, databaseId: string) {
  const response = await request.get(`/api/databases/${databaseId}`);
  if (response.ok()) {
    const database = await json<{ records: { pageId: string | null }[] }>(
      response,
    );
    for (const record of database.records) {
      if (!record.pageId) continue;
      const trashed = await request.delete(`/api/pages/${record.pageId}`);
      if (trashed.ok()) await request.delete(`/api/trash/${record.pageId}`);
    }
  }
  await request.delete(`/api/databases/${databaseId}`);
}

test("applies the database-pages preference across the workspace", async ({
  page,
  request,
}) => {
  test.slow();
  const token = `database-pages-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const database = await json<Database>(
    await request.post("/api/databases", {
      data: { name: `${token} database` },
    }),
  );
  const record = await json<RecordRow>(
    await request.post(`/api/databases/${database.id}/records`, {
      data: { title: `${token} record` },
    }),
  );

  try {
    await page.goto("/");
    const sidebar = page.locator("aside");
    const main = page.locator("main");
    const workspaceLink = sidebar.getByRole("link", {
      name: record.title,
      exact: true,
    });
    const pageHref = `a[href="/pages/${record.pageId}"]`;

    await expect(workspaceLink).toHaveCount(0);
    await expect(main.locator(pageHref)).toHaveCount(0);

    await page.getByRole("button", { name: "Edit navigation" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Edit navigation" });
    const toggle = dialog.getByRole("switch", {
      name: "Show database pages",
    });

    await expect(toggle).not.toBeChecked();
    await toggle.check();
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(dialog).toHaveCount(0);

    // The sidebar and home refresh from the same saved preference.
    await expect(workspaceLink).toBeVisible();
    await expect(main.locator(pageHref).first()).toBeVisible();

    await page.getByRole("button", { name: /Quick find/ }).click();
    const palette = page.getByRole("dialog", { name: "Command palette" });
    const paletteSearch = palette.getByRole("combobox", {
      name: "Search or run a command",
    });
    const paletteRecord = palette
      .getByRole("option")
      .filter({ hasText: record.title })
      .filter({ hasText: "Database page" });
    const paletteRecordHit = palette
      .getByRole("option")
      .filter({ hasText: record.title })
      .filter({ hasText: database.name });
    await paletteSearch.fill(record.title);
    await expect(paletteRecord.first()).toBeVisible();
    await expect(paletteRecordHit.first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(palette).toHaveCount(0);

    await page.goto("/pages");
    await expect(page.locator(`main ${pageHref}`)).toBeVisible();

    await page.goto("/graph");
    await expect(
      page.getByRole("option", { name: record.title, exact: true }),
    ).toHaveCount(1);

    // Visiting a record page makes it a recent page; it stays visible while
    // database pages are enabled.
    await page.goto(`/pages/${record.pageId}`);
    await page.waitForFunction((pageId) => {
      try {
        const entries = JSON.parse(
          window.localStorage.getItem("kbs:recent-pages") ?? "[]",
        ) as { id?: string }[];
        return entries.some((entry) => entry.id === pageId);
      } catch {
        return false;
      }
    }, record.pageId);
    await page.goto("/");
    const recents = page.locator(
      'section[aria-labelledby="recent-pages-heading"]',
    );
    await expect(recents.locator(pageHref)).toBeVisible();

    // Turning the preference off hides it again everywhere.
    await page.getByRole("button", { name: "Edit navigation" }).first().click();
    await expect(toggle).toBeChecked();
    await toggle.uncheck();
    await dialog.getByRole("button", { name: "Done" }).click();

    await expect(workspaceLink).toHaveCount(0);
    await expect(main.locator(pageHref)).toHaveCount(0);
    await expect(recents.locator(pageHref)).toHaveCount(0);

    await page.getByRole("button", { name: /Quick find/ }).click();
    await paletteSearch.fill(record.title);
    await expect(paletteRecord).toHaveCount(0);
    await expect(paletteRecordHit).toHaveCount(0);
    await page.keyboard.press("Escape");

    await page.goto("/pages");
    await expect(page.locator(`main ${pageHref}`)).toHaveCount(0);

    await page.goto("/graph");
    await expect(
      page.getByRole("option", { name: record.title, exact: true }),
    ).toHaveCount(0);
  } finally {
    await cleanupDatabase(request, database.id);
  }
});
