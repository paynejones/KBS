import { expect, test } from "@playwright/test";
import { BROWSER_TEST_BASE_URL } from "./auth";

test("renders the global error boundary when the root layout fails", async ({ page }) => {
  // The browser-test build compiles a probe into the root layout that throws
  // from an effect on this path, so the failure belongs to the root layout
  // rather than the page.
  await page.goto("/__root-error");

  const heading = page.getByRole("heading", {
    name: "This page couldn’t load",
  });
  await expect(heading).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  const backHome = page.getByRole("button", { name: "Back to home" });
  await expect(backHome).toBeVisible();

  // Retrying at the failing path re-renders the boundary instead of leaving a
  // blank screen; leaving it must recover the app.
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(heading).toBeVisible();

  await backHome.click();
  await expect(page).toHaveURL(`${BROWSER_TEST_BASE_URL}/`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    /Good (morning|afternoon|evening)|Welcome back/,
  );
  await expect(heading).toHaveCount(0);
});
