import assert from "node:assert/strict";
import { expect, test } from "@playwright/test";

test("loads data safety on demand, backs up, checks, and removes unused files", async ({
  page,
  request,
}) => {
  test.slow();
  const token = `settings-data-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const upload = await request.post("/api/attachments", {
    multipart: {
      file: {
        name: `${token}-orphan.txt`,
        mimeType: "text/plain",
        buffer: Buffer.from(`${token} unused file`),
      },
    },
  });
  assert.equal(upload.status(), 201);

  const dataRequests: string[] = [];
  page.on("request", (outgoing) => {
    const url = outgoing.url();
    if (url.includes("/api/backup") || url.includes("/api/attachments/orphans")) {
      dataRequests.push(url);
    }
  });

  await page.goto("/settings");
  const data = page.getByRole("region", { name: "Data & backups" });
  await expect(data).toBeVisible();

  // Data-safety requests stay idle until a control asks for them.
  await page.waitForTimeout(500);
  assert.deepEqual(dataRequests, []);

  const historyResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/backup") && response.request().method() === "GET",
  );
  await data.getByRole("button", { name: "Show backup history" }).click();
  assert.equal((await historyResponse).status(), 200);
  await expect(data.getByRole("button", { name: "Show backup history" })).toHaveCount(0);

  const createResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/backup") && response.request().method() === "POST",
  );
  await data.getByRole("button", { name: "Back up now" }).click();
  const created = await createResponse;
  assert.equal(created.status(), 201);
  const payload = (await created.json()) as { backup: { id: string } };
  const row = data.locator("li").filter({ hasText: payload.backup.id });
  await expect(row).toBeVisible();
  await expect(row.getByText("Checked", { exact: true })).toBeVisible();

  const verifyResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/backup/${payload.backup.id}/verify`) &&
      response.request().method() === "POST",
  );
  await row.getByRole("button", { name: `Check backup ${payload.backup.id}` }).click();
  assert.equal((await verifyResponse).status(), 200);
  await expect(
    data.getByText(`Backup ${payload.backup.id} passed the restore check.`),
  ).toBeVisible();

  const scanResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/attachments/orphans") &&
      response.request().method() === "GET",
  );
  await data.getByRole("button", { name: "Scan for unused files" }).click();
  assert.equal((await scanResponse).status(), 200);

  const clean = data.getByRole("button", { name: "Remove unused files" });
  await expect(clean).toBeEnabled();
  await clean.click();
  const cleanDialog = page.getByRole("alertdialog", { name: "Remove unused files?" });
  await expect(cleanDialog).toBeVisible();

  const cleanResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/attachments/orphans") &&
      response.request().method() === "DELETE",
  );
  await cleanDialog.getByRole("button", { name: "Remove files" }).click();
  assert.equal((await cleanResponse).status(), 200);
  await expect(
    data.getByRole("status").filter({ hasText: /Removed \d+ unused file/ }),
  ).toBeVisible();
});

test("signs out from Settings", async ({ page }) => {
  await page.goto("/settings");
  const security = page.getByRole("region", { name: "Security" });
  await security.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/signin(?:$|\?)/);
});
