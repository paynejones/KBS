import assert from "node:assert/strict";
import { expect, test } from "@playwright/test";

test("collects workspace and browser preferences in Settings", async ({ page }) => {
  await page.goto("/settings");

  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  for (const heading of [
    "Appearance",
    "Navigation & sidebar",
    "Home layout",
    "Database display",
    "Editor & drafts",
    "Data & backups",
    "Security",
    "Workspace password",
  ]) {
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  }

  await expect(page.getByRole("link", { name: "Download JSON" })).toHaveAttribute(
    "href",
    "/api/export",
  );
  await expect(page.getByRole("button", { name: "Change password" })).toBeVisible();

  await page
    .getByRole("region", { name: "Appearance" })
    .getByLabel("Color theme")
    .selectOption("dark");
  assert.equal(
    await page.evaluate(() => window.localStorage.getItem("kbs:theme")),
    "dark",
  );

  const navigationSection = page.getByRole("region", { name: "Navigation & sidebar" });
  const databasePages = navigationSection.getByRole("switch", {
    name: "Show database pages",
  });
  await databasePages.check();
  const navigation = await page.evaluate(() =>
    JSON.parse(window.localStorage.getItem("kbs:navigation") ?? "null") as {
      showDatabasePages: boolean;
    } | null,
  );
  assert.equal(navigation?.showDatabasePages, true);

  await navigationSection.getByRole("button", { name: "Reset navigation" }).click();
  await expect(databasePages).not.toBeChecked();

  await navigationSection.getByRole("button", { name: "Edit navigation" }).click();
  await expect(page.getByRole("dialog", { name: "Edit navigation" })).toBeVisible();
  await page.getByRole("button", { name: "Close navigation editor" }).click();

  const sidebar = navigationSection.getByRole("switch", {
    name: "Collapse sidebar to an icon rail",
  });
  await sidebar.check();
  assert.equal(
    await page.evaluate(() => window.localStorage.getItem("kbs:sidebar-collapsed")),
    "true",
  );
  await sidebar.uncheck();

  const homeSection = page.getByRole("region", { name: "Home layout" });
  await homeSection.getByRole("button", { name: "Lock layout" }).click();
  await expect(homeSection.getByRole("button", { name: "Unlock layout" })).toBeVisible();
  await expect(homeSection.getByRole("button", { name: "Reset layout" })).toBeDisabled();
  assert.equal(
    await page.evaluate(() => {
      const layout = JSON.parse(
        window.localStorage.getItem("kbs:dashboard-layout") ?? "null",
      ) as { locked?: boolean } | null;
      return layout?.locked;
    }),
    true,
  );
  await homeSection.getByRole("button", { name: "Unlock layout" }).click();
  await homeSection.getByRole("button", { name: "Reset layout" }).click();
  assert.equal(
    await page.evaluate(() => window.localStorage.getItem("kbs:dashboard-layout")),
    null,
  );

  await page.evaluate(() => {
    window.localStorage.setItem(
      "kbs:dashboard-layout",
      JSON.stringify({ order: [], hidden: ["reading"], sizes: {}, locked: false }),
    );
  });
  await page.reload();
  await expect(
    homeSection.getByRole("button", { name: "Show Reading list" }),
  ).toBeVisible();
  await homeSection.getByRole("button", { name: "Show Reading list" }).click();
  assert.equal(
    await page.evaluate(() => window.localStorage.getItem("kbs:dashboard-layout")),
    null,
  );

  await page.evaluate(() => {
    window.localStorage.setItem("kbs:database-view:settings-test", "view");
    window.localStorage.setItem("kbs:database-hidden-views:settings-test", "[]");
    window.localStorage.setItem("kbs:page-draft:settings-draft-1", "{}");
    window.localStorage.setItem("kbs:page-draft:settings-draft-2", "{}");
  });
  await page.reload();

  await expect(page.getByText("2 saved database display settings")).toBeVisible();
  await expect(page.getByText("2 recoverable drafts in this browser")).toBeVisible();

  const databaseSection = page.getByRole("region", { name: "Database display" });
  await databaseSection.getByRole("button", { name: "Reset preferences" }).click();
  const resetDialog = page.getByRole("alertdialog", {
    name: "Reset database display preferences?",
  });
  await expect(resetDialog).toBeVisible();
  await resetDialog.getByRole("button", { name: "Reset preferences" }).click();
  await expect(resetDialog).toHaveCount(0);
  await expect(
    databaseSection.getByText("0 saved database display settings", { exact: true }),
  ).toBeVisible();
  assert.equal(
    await page.evaluate(() => window.localStorage.getItem("kbs:database-view:settings-test")),
    null,
  );
  assert.equal(
    await page.evaluate(() =>
      window.localStorage.getItem("kbs:database-hidden-views:settings-test"),
    ),
    null,
  );

  const editorSection = page.getByRole("region", { name: "Editor & drafts" });
  await editorSection.getByRole("button", { name: "Discard drafts" }).click();
  const draftDialog = page.getByRole("alertdialog", { name: "Discard saved drafts?" });
  await expect(draftDialog).toBeVisible();
  await draftDialog.getByRole("button", { name: "Discard drafts" }).click();
  await expect(page.getByText("0 recoverable drafts in this browser")).toBeVisible();
  assert.equal(
    await page.evaluate(() =>
      window.localStorage.getItem("kbs:page-draft:settings-draft-1"),
    ),
    null,
  );
});
