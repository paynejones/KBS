import assert from "node:assert/strict";
import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type Page,
} from "@playwright/test";

type PageRow = { id: string; title: string };
type Database = { id: string; name: string };

async function json<T>(response: APIResponse): Promise<T> {
  const text = await response.text();
  assert.ok(
    response.ok(),
    `${response.url()} returned ${response.status()}: ${text}`,
  );
  return JSON.parse(text) as T;
}

async function purgePage(request: APIRequestContext, id: string) {
  const trashed = await request.delete(`/api/pages/${id}`);
  if (trashed.ok()) await request.delete(`/api/trash/${id}`);
}

/**
 * Playwright's mouse-driven dragTo only targets the drag source in this
 * headless Chromium setup. Dispatch the same native events at the intended
 * target so the editor's drop handlers are exercised.
 */
async function touchDragSidebarItem(
  page: Page,
  sourceSelector: string,
  targetSelector: string,
  position: "before" | "after",
) {
  const pointerId = 17;
  const base = {
    bubbles: true,
    cancelable: true,
    pointerId,
    pointerType: "touch",
    isPrimary: true,
  };

  await page.evaluate(
    ({ sourceSelector, base }) => {
      const source = document.querySelector(sourceSelector);
      if (!(source instanceof HTMLElement)) {
        throw new Error("missing touch drag source");
      }
      const rect = source.getBoundingClientRect();
      source.dispatchEvent(
        new PointerEvent("pointerdown", {
          ...base,
          button: 0,
          buttons: 1,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
        }),
      );
    },
    { sourceSelector, base },
  );

  // Hold a finger near the dialog edge until the target scrolls into view.
  for (let step = 0; step < 80; step += 1) {

    const visible = await page.evaluate(
      ({ sourceSelector, targetSelector, base }) => {
        const source = document.querySelector(sourceSelector);
        const target = document.querySelector(targetSelector);
        const dialog = document.querySelector('[role="dialog"]');
        if (
          !(source instanceof HTMLElement) ||
          !(target instanceof HTMLElement) ||
          !(dialog instanceof HTMLElement)
        ) {
          throw new Error("missing touch drag target");
        }

        const targetRect = target.getBoundingClientRect();
        const dialogRect = dialog.getBoundingClientRect();
        const isVisible =
          targetRect.top >= dialogRect.top + 8 &&
          targetRect.bottom <= dialogRect.bottom - 8;
        const clientY =
          targetRect.top < dialogRect.top + 48
            ? dialogRect.top + 40
            : targetRect.bottom > dialogRect.bottom - 48
              ? dialogRect.bottom - 40
              : targetRect.top + 1;

        source.dispatchEvent(
          new PointerEvent("pointermove", {
            ...base,
            buttons: 1,
            clientX: targetRect.left + targetRect.width / 2,
            clientY,
          }),
        );
        return isVisible;
      },
      { sourceSelector, targetSelector, base },
    );
    if (visible) break;
    await page.waitForTimeout(16);
  }

  await page.evaluate(
    ({ sourceSelector, targetSelector, position, base }) => {
      const source = document.querySelector(sourceSelector);
      const target = document.querySelector(targetSelector);
      if (!(source instanceof HTMLElement) || !(target instanceof HTMLElement)) {
        throw new Error("missing touch drag target");
      }
      const rect = target.getBoundingClientRect();
      const point = {
        clientX: rect.left + rect.width / 2,
        clientY: position === "before" ? rect.top + 1 : rect.bottom - 1,
      };
      source.dispatchEvent(
        new PointerEvent("pointermove", { ...base, ...point, buttons: 1 }),
      );
      source.dispatchEvent(
        new PointerEvent("pointerup", {
          ...base,
          ...point,
          button: 0,
          buttons: 0,
        }),
      );
    },
    { sourceSelector, targetSelector, position, base },
  );
}

async function dragSidebarItem(
  page: Page,
  sourceSelector: string,
  targetSelector: string,
  position: "before" | "after",
) {
  await page.evaluate(
    ({ sourceSelector, targetSelector, position }) => {
      const source = document.querySelector(sourceSelector);
      const target = document.querySelector(targetSelector);
      if (!(source instanceof HTMLElement) || !(target instanceof HTMLElement)) {
        throw new Error("missing drag elements");
      }

      const dataTransfer = new DataTransfer();
      source.dispatchEvent(
        new DragEvent("dragstart", {
          bubbles: true,
          cancelable: true,
          dataTransfer,
        }),
      );

      const rect = target.getBoundingClientRect();
      const init = {
        bubbles: true,
        cancelable: true,
        dataTransfer,
        clientX: rect.left + 1,
        clientY: position === "before" ? rect.top + 1 : rect.bottom - 1,
      };
      target.dispatchEvent(new DragEvent("dragover", init));
      target.dispatchEvent(new DragEvent("drop", init));
      source.dispatchEvent(
        new DragEvent("dragend", { bubbles: true, dataTransfer }),
      );
    },
    { sourceSelector, targetSelector, position },
  );
}

test("reorders sections and entries by dragging", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Edit navigation" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Edit navigation" });
  await dialog.getByRole("button", { name: "Add section" }).click();
  await dialog.getByLabel("Section name 2").fill("Project links");

  await dragSidebarItem(
    page,
    '[data-section-name="Project links"] [data-drag-handle="section"]',
    '[aria-label="Section name 1"]',
    "before",
  );

  const addItem = dialog.getByLabel("Add item to Project links");
  await addItem.selectOption("navigation:home");
  await addItem.selectOption("navigation:inbox");

  await dragSidebarItem(
    page,
    '[data-section-name="Project links"] [data-entry-key="navigation:inbox"] [data-drag-handle="entry"]',
    '[data-section-name="Project links"] [data-entry-key="navigation:home"]',
    "before",
  );

  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toHaveCount(0);

  const sidebar = page.locator("aside");
  await expect(
    sidebar.getByRole("heading", { level: 2 }).first(),
  ).toHaveText("Project links");
  const projectLinks = sidebar.getByRole("region", {
    name: "Project links",
  });
  await expect(projectLinks.getByRole("link")).toHaveText([
    "Inbox",
    "Home",
  ]);
});

test("reorders sections and entries with touch pointers", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Edit navigation" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Edit navigation" });
  await dialog.getByRole("button", { name: "Add section" }).click();
  await dialog.getByLabel("Section name 2").fill("Project links");

  await touchDragSidebarItem(
    page,
    '[data-section-name="Project links"] [data-drag-handle="section"]',
    '[aria-label="Section name 1"]',
    "before",
  );

  const addItem = dialog.getByLabel("Add item to Project links");
  await addItem.selectOption("navigation:home");
  await addItem.selectOption("navigation:inbox");

  await touchDragSidebarItem(
    page,
    '[data-section-name="Project links"] [data-entry-key="navigation:inbox"] [data-drag-handle="entry"]',
    '[data-section-name="Project links"] [data-entry-key="navigation:home"]',
    "before",
  );

  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toHaveCount(0);

  const sidebar = page.locator("aside");
  await expect(
    sidebar.getByRole("heading", { level: 2 }).first(),
  ).toHaveText("Project links");
  await expect(
    sidebar.getByRole("region", { name: "Project links" }).getByRole("link"),
  ).toHaveText(["Inbox", "Home"]);
});

test("builds named sidebar sections with pages and databases", async ({
  page,
  request,
}) => {
  test.slow();
  const token = `sidebar-sections-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const pinnedPage = await json<PageRow>(
    await request.post("/api/pages", { data: { title: `${token} page` } }),
  );
  const database = await json<Database>(
    await request.post("/api/databases", {
      data: { name: `${token} database` },
    }),
  );

  try {
    await page.goto("/");
    const sidebar = page.locator("aside");

    await page.getByRole("button", { name: "Edit navigation" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Edit navigation" });
    await dialog.getByRole("button", { name: "Add section" }).click();

    const sectionName = dialog.getByLabel("Section name 2");
    await sectionName.fill("Project links");

    const addItem = dialog.getByLabel("Add item to Project links");
    await expect(
      addItem.locator(`option[value="page:${pinnedPage.id}"]`),
    ).toHaveCount(1);
    await addItem.selectOption(`page:${pinnedPage.id}`);
    await addItem.selectOption(`database:${database.id}`);

    await dialog
      .getByRole("button", { name: "Remove Pages tree from sidebar" })
      .click();
    await addItem.selectOption("page-tree");

    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(dialog).toHaveCount(0);

    const section = sidebar.getByRole("region", { name: "Project links" });
    await expect(section.getByRole("heading", { name: "Project links" })).toBeVisible();
    await expect(
      section.getByRole("link", { name: pinnedPage.title, exact: true }).first(),
    ).toBeVisible();
    await expect(section.getByRole("link", { name: database.name, exact: true })).toBeVisible();
    await expect(section.getByRole("link", { name: "View all" })).toBeVisible();

    await page.reload();
    await expect(
      page
        .locator("aside")
        .getByRole("heading", { name: "Project links" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Edit navigation" }).first().click();
    await page
      .getByRole("button", { name: "Remove section Project links" })
      .click();
    await page.getByRole("button", { name: "Done" }).click();

    await expect(
      page.locator("aside").getByRole("heading", { name: "Project links" }),
    ).toHaveCount(0);
  } finally {
    await purgePage(request, pinnedPage.id);
    await request.delete(`/api/databases/${database.id}`);
  }
});
