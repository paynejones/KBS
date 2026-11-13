import assert from "node:assert/strict";
import { expect, test, type APIRequestContext, type APIResponse } from "@playwright/test";

type PageRow = { id: string; title: string; coverPosition: number };

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

test("drags a page cover to a persisted focal point", async ({ page, request }) => {
  const token = `cover-position-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const attachment = await json<{ url: string }>(
    await request.post("/api/attachments", {
      multipart: {
        purpose: "image",
        file: {
          name: `${token}.png`,
          mimeType: "image/png",
          // A 1x1 PNG, so the cover image renders same-origin.
          buffer: Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=",
            "base64",
          ),
        },
      },
    }),
  );
  const created = await json<PageRow>(
    await request.post("/api/pages", {
      data: { title: `${token} page` },
    }),
  );

  try {
    assert.equal(
      (await request.patch(`/api/pages/${created.id}`, {
        data: { coverImageUrl: attachment.url },
      })).status(),
      200,
    );

    await page.goto(`/pages/${created.id}`);

    const cover = page.getByTestId("page-cover");
    const slider = page.getByRole("slider", { name: "Cover image position" });
    await expect(slider).toHaveAttribute("aria-valuenow", "50");

    const coverBox = await cover.boundingBox();
    const sliderBox = await slider.boundingBox();
    assert.ok(coverBox && sliderBox, "the cover and handle must be laid out");

    await page.mouse.move(
      sliderBox.x + sliderBox.width / 2,
      sliderBox.y + sliderBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      coverBox.x + coverBox.width / 2,
      coverBox.y + coverBox.height * 0.2,
      { steps: 8 },
    );
    await page.mouse.up();

    await expect(slider).toHaveAttribute("aria-valuenow", "20");
    await expect
      .poll(async () => {
        const response = await request.get(`/api/pages/${created.id}`);
        return (await json<PageRow>(response)).coverPosition;
      })
      .toBe(20);

    await page.reload();
    await expect(slider).toHaveAttribute("aria-valuenow", "20");
    await expect(cover.locator("img")).toHaveCSS("object-position", "50% 20%");
  } finally {
    await purgePage(request, created.id);
    await request.delete("/api/attachments/orphans");
  }
});
