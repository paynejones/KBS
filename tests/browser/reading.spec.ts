import assert from "node:assert/strict";
import { expect, test, type APIRequestContext, type APIResponse } from "@playwright/test";

type PageRow = { id: string; title: string };

async function json<T>(response: APIResponse): Promise<T> {
  const text = await response.text();
  assert.ok(response.ok(), `${response.url()} returned ${response.status()}: ${text}`);
  return JSON.parse(text) as T;
}

async function purgePage(request: APIRequestContext, id: string) {
  const trashed = await request.delete(`/api/pages/${id}`);
  if (trashed.ok()) await request.delete(`/api/trash/${id}`);
}

test("tracks a book, its highlights, and its finished status", async ({ page, request }) => {
  const token = `reading-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const title = `${token} field notes`;
  const passage = `${token} a sentence worth keeping`;
  let notesPageId = "";

  try {
    await page.goto("/reading");

    await page.getByLabel("Title", { exact: true }).fill(title);
    await page.getByLabel("Kind").selectOption("book");
    await page.getByLabel("Author or site").fill("A. Reader");
    await page.getByLabel("Link").fill("https://www.example.com/field-notes");
    await page.getByRole("button", { name: "Add to reading list" }).click();

    const card = page.locator("article").filter({ hasText: title });
    await expect(card.getByRole("link", { name: title })).toBeVisible();
    await expect(card.getByText("Book")).toBeVisible();
    await expect(card.getByText("A. Reader")).toBeVisible();

    // Highlights open in place and keep an optional note with the passage.
    await card.locator("summary").click();
    await card.getByLabel(`Highlight from ${title}`).fill(passage);
    await card.getByLabel("Note about this highlight").fill("The argument I want to cite");
    await card.getByRole("button", { name: "Add highlight" }).click();

    await expect(card.getByText(passage)).toBeVisible();
    await expect(card.getByText("The argument I want to cite")).toBeVisible();
    await expect(card.getByText("Highlights (1)")).toBeVisible();

    // The status moves the card into the finished section.
    await card.getByLabel(`Reading status for ${title}`).selectOption("finished");
    await expect(page.getByRole("heading", { name: /Finished/ })).toBeVisible();

    // The notes page outlives the tracked item.
    await card.getByRole("button", { name: `Remove ${title} from the reading list` }).click();
    await page.getByRole("button", { name: "Remove item" }).click();
    await expect(card).toHaveCount(0);

    const pages = await json<PageRow[]>(
      await request.get(`/api/pages?q=${encodeURIComponent(token)}`),
    );
    const notesPage = pages.find((entry) => entry.title === title);
    assert.ok(notesPage, "the notes page should still exist after removing the item");
    notesPageId = notesPage.id;
  } finally {
    if (notesPageId) await purgePage(request, notesPageId);
  }
});
