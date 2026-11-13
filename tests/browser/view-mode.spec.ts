import assert from "node:assert/strict";
import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
} from "@playwright/test";

type Database = { id: string; name: string; views: { id: string }[] };
type RecordRow = { id: string; title: string; pageId: string | null };

async function json<T>(response: APIResponse): Promise<T> {
  const text = await response.text();
  assert.ok(
    response.ok(),
    `${response.url()} returned ${response.status()}: ${text}`,
  );
  return JSON.parse(text) as T;
}

async function post<T>(
  request: APIRequestContext,
  url: string,
  data: Record<string, unknown>,
): Promise<T> {
  return json<T>(await request.post(url, { data }));
}

async function cleanupDatabase(
  request: APIRequestContext,
  databaseId: string,
) {
  const loaded = await request.get(`/api/databases/${databaseId}`);
  if (loaded.ok()) {
    const database = await json<{ records: RecordRow[] }>(loaded);
    for (const record of database.records) {
      if (!record.pageId) continue;
      const trashed = await request.delete(`/api/pages/${record.pageId}`);
      if (trashed.ok()) await request.delete(`/api/trash/${record.pageId}`);
    }
  }
  await request.delete(`/api/databases/${databaseId}`);
}

test("view mode locks editors but keeps navigation and actions usable", async ({
  page,
  request,
}) => {
  test.slow();
  const token = `view-mode-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const created = await post<{ id: string }>(request, "/api/databases", {
    name: `${token} database`,
  });
  const database = await json<Database>(
    await request.get(`/api/databases/${created.id}`),
  );
  const record = await post<RecordRow>(
    request,
    `/api/databases/${database.id}/records`,
    { title: `${token} record` },
  );
  const score = await post<{ id: string }>(
    request,
    `/api/databases/${database.id}/properties`,
    { name: "Score", type: "number" },
  );

  try {
    assert.ok(record.pageId, "the record must have a page to edit");
    await json(
      await request.patch(
        `/api/databases/${database.id}/records/${record.id}`,
        { data: { values: { [score.id]: 42 } } },
      ),
    );
    await json(
      await request.patch(`/api/pages/${record.pageId}`, {
        data: {
          contentJson: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Locked body copy" }],
              },
            ],
          },
        },
      }),
    );

    await page.goto(
      `/databases/${database.id}/records/${record.id}?mode=view`,
    );

    await expect(
      page.getByRole("heading", { name: record.title }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Record title" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Delete", exact: true }),
    ).toHaveCount(0);
    await expect(page.locator('input[aria-label="Score"]')).toHaveCount(0);
    await expect(page.getByText("42", { exact: true })).toBeVisible();
    await expect(page.getByText("View only", { exact: true })).toBeVisible();
    await expect(page.getByText("Page settings")).toHaveCount(0);
    await expect(page.locator('[aria-label="Page content"]')).toHaveAttribute(
      "contenteditable",
      "false",
    );
    await expect(page.getByText("Locked body copy")).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Open standalone page/ }),
    ).toBeVisible();

    await expect(
      page.getByRole("button", { name: "Back to previous page" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: database.name, exact: true }),
    ).toBeVisible();

    await page.goto(
      `/databases/${database.id}/records/${record.id}?mode=view`,
    );
    await page.getByRole("button", { name: "Edit mode" }).click();
    await expect(page).not.toHaveURL(/mode=view/);
    await expect(
      page.getByRole("textbox", { name: "Record title" }),
    ).toBeVisible();
    await expect(page.locator('input[aria-label="Score"]')).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Delete", exact: true }),
    ).toBeVisible();

    await page.goto(
      `/databases/${database.id}?view=${database.views[0]?.id ?? ""}&mode=view`,
    );
    await expect(
      page.getByRole("heading", { name: database.name }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Database name" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("textbox", { name: "Record name" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "New record" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Add property" }),
    ).toHaveCount(0);
    await expect(page.getByText(record.title, { exact: true })).toBeVisible();
    await expect(page.getByText("42", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("link", {
        name: `Open ${record.title} as a full page`,
      }),
    ).toBeVisible();

    await page.reload();
    await expect(page).toHaveURL(/mode=view/);
    await expect(
      page.getByRole("textbox", { name: "Record name" }),
    ).toHaveCount(0);

    await page.getByRole("button", { name: "Edit mode" }).click();
    await expect(page).not.toHaveURL(/mode=view/);
    await expect(page).toHaveURL(/view=/);
    await expect(
      page.getByRole("textbox", { name: "Record name" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "New record" }).first(),
    ).toBeVisible();
  } finally {
    await cleanupDatabase(request, database.id);
  }
});
