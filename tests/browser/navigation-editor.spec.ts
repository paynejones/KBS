import { expect, test } from "@playwright/test";

test("hides a sidebar destination without changing the mobile bar", async ({ page }) => {
  await page.goto("/");

  const workspace = page.getByRole("navigation", { name: "Workspace" });
  await expect(workspace.getByRole("link", { name: "Pages", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Edit navigation" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Edit navigation" });
  await expect(dialog).toBeVisible();

  await dialog.getByRole("button", { name: "Hide Pages from sidebar" }).click();
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toHaveCount(0);

  await expect(
    workspace.getByRole("link", { name: "Pages", exact: true }),
  ).toHaveCount(0);

  // The bottom bar has its own selections and must keep Pages.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByTestId("mobile-navigation").getByRole("link", {
      name: "Pages",
      exact: true,
    }),
  ).toBeVisible();

  // The hidden choice persists on this device.
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.reload();
  await expect(
    page.getByRole("navigation", { name: "Workspace" }).getByRole("link", {
      name: "Pages",
      exact: true,
    }),
  ).toHaveCount(0);
});
