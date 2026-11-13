import {
  devices,
  expect,
  test,
  type Page,
} from "@playwright/test";
import { BROWSER_AUTH_STATE, BROWSER_TEST_BASE_URL } from "./auth";

test.use({ ...devices["Pixel 5"] });

async function expectMobileEditorToFit(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Edit navigation" })
    .first()
    .click();
  const dialog = page.getByRole("dialog", { name: "Edit navigation" });
  await expect(dialog).toBeVisible();

  const metrics = await dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const interactive = Array.from(
      element.querySelectorAll<HTMLElement>("button, input, select"),
    )
      .filter((control) => !control.matches('[role="switch"]'))
      .filter((control) => control.offsetParent !== null)
      .map((control) => {
        const box = control.getBoundingClientRect();
        return {
          label:
            control.getAttribute("aria-label") ||
            control.textContent?.trim().slice(0, 30) ||
            control.tagName,
          width: Math.round(box.width),
          height: Math.round(box.height),
        };
      });
    const handles = Array.from(
      element.querySelectorAll<HTMLElement>("[data-drag-handle]"),
    ).map((handle) => {
      const box = handle.getBoundingClientRect();
      return { width: Math.round(box.width), height: Math.round(box.height) };
    });
    const switchLabel = element
      .querySelector('[role="switch"]')
      ?.closest("label")
      ?.getBoundingClientRect();

    return {
      viewportWidth: window.innerWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      dialogClientWidth: element.clientWidth,
      dialogScrollWidth: element.scrollWidth,
      dialogWithinViewport: rect.left >= 0 && rect.right <= window.innerWidth,
      smallControls: interactive.filter(
        (control) => control.width < 44 || control.height < 44,
      ),
      smallHandles: handles.filter(
        (handle) => handle.width < 44 || handle.height < 44,
      ),
      switchLabelHeight: Math.round(switchLabel?.height ?? 0),
    };
  });

  expect(metrics.documentScrollWidth).toBeLessThanOrEqual(metrics.viewportWidth);
  expect(metrics.dialogScrollWidth).toBeLessThanOrEqual(
    metrics.dialogClientWidth + 1,
  );
  expect(metrics.dialogWithinViewport).toBe(true);
  expect(metrics.smallControls).toEqual([]);
  expect(metrics.smallHandles).toEqual([]);
  expect(metrics.switchLabelHeight).toBeGreaterThanOrEqual(44);
}

test("Pixel 5: navigation editor fits with usable touch targets", async ({
  page,
}) => {
  await expectMobileEditorToFit(page);
});

test("Galaxy S9+: navigation editor fits with usable touch targets", async ({
  browser,
}) => {
  const context = await browser.newContext({
    ...devices["Galaxy S9+"],
    storageState: BROWSER_AUTH_STATE,
    baseURL: BROWSER_TEST_BASE_URL,
  });
  const page = await context.newPage();

  try {
    await expectMobileEditorToFit(page);
  } finally {
    await context.close();
  }
});
