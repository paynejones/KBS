import assert from "node:assert/strict";
import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type Locator,
  type Page,
} from "@playwright/test";

type PageRow = { id: string; title: string; content: string };
type Database = { id: string; name: string };
type Template = { id: string; name: string };

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

async function createDatabase(
  request: APIRequestContext,
  name: string,
): Promise<Database> {
  return await json<Database>(await request.post("/api/databases", { data: { name } }));
}

async function createTemplate(
  request: APIRequestContext,
  name: string,
  pageId: string,
): Promise<Template> {
  return await json<Template>(
    await request.post("/api/page-templates", { data: { name, pageId } }),
  );
}

async function purgePage(request: APIRequestContext, id: string) {
  const trashed = await request.delete(`/api/pages/${id}`);
  if (trashed.ok()) await request.delete(`/api/trash/${id}`);
}

function dialogContent(page: Page): Locator {
  return page.locator('[data-slot="alert-dialog-content"]');
}

/**
 * Exercises the keyboard contract every destructive confirmation shares:
 * Cancel receives focus, Tab and Shift+Tab stay inside the dialog, Escape
 * closes it, and a second opening can be dismissed with Cancel.
 */
async function exerciseConfirmation(
  page: Page,
  options: {
    open: () => Promise<void>;
    title: string;
    action: string;
    trigger?: Locator;
  },
) {
  const dialog = dialogContent(page);

  await options.open();
  await expect(dialog).toHaveCount(1);
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("role", "alertdialog");
  await expect(dialog.getByText(options.title, { exact: true })).toBeVisible();

  const cancel = dialog.getByRole("button", { name: "Cancel", exact: true });
  const action = dialog.getByRole("button", { name: options.action, exact: true });
  await expect(cancel).toBeFocused();

  await page.keyboard.press("Tab");
  await expect(action).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(action).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  if (options.trigger) await expect(options.trigger).toBeFocused();

  await options.open();
  await expect(dialog).toHaveCount(1);
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click({ timeout: 5_000 });
  await expect(dialog).toHaveCount(0);
  if (options.trigger) await expect(options.trigger).toBeFocused();
}

test("database deletion dialogs keep keyboard focus inside and dismiss cleanly", async ({
  page,
  request,
}) => {
  const token = `dialog-database-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const database = await createDatabase(request, token);

  try {
    await page.goto("/databases");
    const listDelete = page.getByRole("button", {
      name: `Delete ${database.name}`,
      exact: true,
    });

    await exerciseConfirmation(page, {
      open: () => listDelete.click(),
      title: `Delete “${database.name}”?`,
      action: "Delete database",
      trigger: listDelete,
    });

    await page.goto(`/databases/${database.id}`);
    await expect(page.getByLabel("Database name")).toHaveValue(database.name);

    await exerciseConfirmation(page, {
      open: async () => {
        await page.locator("summary").filter({ hasText: "More" }).click();
        await page.getByRole("button", { name: "Delete database", exact: true }).click();
      },
      title: `Delete “${database.name}”?`,
      action: "Delete database",
    });

    assert.equal((await request.get(`/api/databases/${database.id}`)).status(), 200);
  } finally {
    await request.delete(`/api/databases/${database.id}`);
  }
});

test("page, template, and revision dialogs keep keyboard focus inside and dismiss cleanly", async ({
  page,
  request,
}) => {
  const token = `dialog-page-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const pageRecord = await createPage(request, {
    title: `${token} page`,
    content: "Initial body",
  });
  const template = await createTemplate(request, `${token} template`, pageRecord.id);

  try {
    // The API creates a revision of the previous content on the second write.
    assert.equal(
      (await request.patch(`/api/pages/${pageRecord.id}`, {
        data: { content: "Revision body" },
      })).status(),
      200,
    );

    await page.goto("/pages");
    const templateRow = page.locator(`#template-${template.id}`);
    await expect(templateRow).toHaveCount(1);
    await templateRow
      .locator("xpath=ancestor::details")
      .evaluate((node) => {
        (node as HTMLDetailsElement).open = true;
      });

    const templateDelete = page.getByRole("button", {
      name: `Delete the ${template.name} template`,
      exact: true,
    });
    await exerciseConfirmation(page, {
      open: () => templateDelete.click(),
      title: `Delete “${template.name}”?`,
      action: "Delete template",
      trigger: templateDelete,
    });

    const pageDelete = page.getByRole("button", {
      name: `Delete ${pageRecord.title}`,
      exact: true,
    });
    await exerciseConfirmation(page, {
      open: () => pageDelete.click(),
      title: `Move “${pageRecord.title}” to the trash?`,
      action: "Move to trash",
      trigger: pageDelete,
    });

    await page.goto(`/pages/${pageRecord.id}`);
    await page.locator("summary").filter({ hasText: "Page settings" }).click();
    const restore = page.getByRole("button", { name: "Restore", exact: true }).first();
    await expect(restore).toBeVisible();

    await exerciseConfirmation(page, {
      open: () => restore.click(),
      title: "Restore this version?",
      action: "Restore version",
      trigger: restore,
    });

    assert.equal((await request.get(`/api/pages/${pageRecord.id}`)).status(), 200);
  } finally {
    await request.delete(`/api/page-templates/${template.id}`);
    await purgePage(request, pageRecord.id);
  }
});

test("trash and unused-file dialogs keep keyboard focus inside and dismiss cleanly", async ({
  page,
  request,
}) => {
  const token = `dialog-trash-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const pageRecord = await createPage(request, { title: `${token} page` });

  try {
    assert.equal((await request.delete(`/api/pages/${pageRecord.id}`)).status(), 200);
    assert.equal(
      (await request.post("/api/attachments", {
        multipart: {
          file: {
            name: `${token}-orphan.txt`,
            mimeType: "text/plain",
            buffer: Buffer.from(`${token} unused file`),
          },
        },
      })).status(),
      201,
    );

    await page.goto("/trash");
    const row = page.locator("li").filter({ hasText: pageRecord.title });
    const purge = row.getByRole("button", {
      name: `Delete ${pageRecord.title} permanently`,
      exact: true,
    });
    await exerciseConfirmation(page, {
      open: () => purge.click(),
      title: `Delete “${pageRecord.title}” permanently?`,
      action: "Delete forever",
      trigger: purge,
    });

    const clean = page.getByRole("button", { name: "Remove unused files", exact: true });
    await expect(clean).toBeEnabled();
    await exerciseConfirmation(page, {
      open: () => clean.click(),
      title: "Remove unused files?",
      action: "Remove files",
      trigger: clean,
    });
  } finally {
    await request.delete(`/api/trash/${pageRecord.id}`);
    await request.delete("/api/attachments/orphans");
  }
});
