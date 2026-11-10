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

test("drags a multi-block selection with the grip and moves the whole group", async ({
  page,
  request,
}) => {
  const token = `block-drag-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const fixture = await createPage(request, { title: `${token} page` });

  try {
    await page.goto(`/pages/${fixture.id}`);
    const editor = page.locator(".ProseMirror");
    await expect(editor).toBeEditable();

    await editor.click();
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/pages/${fixture.id}`)
        && response.request().method() === "PATCH",
    );
    await page.keyboard.type("Alpha");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Beta");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Gamma");
    assert.equal((await saved).status(), 200);

    const blocks = editor.locator("p");
    await expect(blocks).toHaveText(["Alpha", "Beta", "Gamma"]);

    // Select from inside "Alpha" to inside "Beta": two blocks, not three.
    await page.evaluate(() => {
      const root = document.querySelector(".ProseMirror");
      if (!root) throw new Error("The editor is not on the page.");
      const paragraphs = root.querySelectorAll("p");
      const range = document.createRange();
      range.setStart(paragraphs[0].firstChild as Text, 2);
      range.setEnd(paragraphs[1].firstChild as Text, 2);
      const selection = window.getSelection();
      if (!selection) throw new Error("The browser exposes no selection.");
      selection.removeAllRanges();
      selection.addRange(range);
    });
    await expect
      .poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ""))
      .toContain("pha");

    // The handle only appears for the block under the pointer.
    await blocks.first().hover();
    const grip = page.locator('[title="Drag to reorder block (Alt+Shift+↑ / ↓)"]');
    await expect(grip).toBeVisible();

    const box = await editor.boundingBox();
    assert.ok(box, "the editor has a layout box");
    await grip.dragTo(editor, {
      targetPosition: { x: 24, y: box.height - 8 },
    });

    // Both selected blocks move below "Gamma" in one drop, and nothing is
    // duplicated or left behind.
    await expect.poll(async () => blocks.allTextContents()).toEqual([
      "Gamma",
      "Alpha",
      "Beta",
    ]);

    // Writing is debounced, so wait for the autosave to catch up with the move.
    await expect
      .poll(async () => (await json<PageRow>(await request.get(`/api/pages/${fixture.id}`))).content)
      .toMatch(/Gamma[\s\S]*Alpha[\s\S]*Beta/);
  } finally {
    await purgePage(request, fixture.id);
  }
});
