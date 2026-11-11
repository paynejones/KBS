import assert from "node:assert/strict";
import { expect, test, type APIRequestContext, type APIResponse, type Page } from "@playwright/test";

type PageRow = { id: string; title: string };
type TagRow = { id: string; name: string };

// Touch taps replace hover on touch devices, so the chip's explicit tap toggle needs a touch context.
test.use({ hasTouch: true });

async function json<T>(response: APIResponse): Promise<T> {
  const text = await response.text();
  assert.ok(response.ok(), `${response.url()} returned ${response.status()}: ${text}`);
  return JSON.parse(text) as T;
}

async function createPage(request: APIRequestContext, title: string): Promise<PageRow> {
  return await json<PageRow>(await request.post("/api/pages", { data: { title } }));
}

async function purgePage(request: APIRequestContext, id: string) {
  const trashed = await request.delete(`/api/pages/${id}`);
  if (trashed.ok()) await request.delete(`/api/trash/${id}`);
}

async function createTag(request: APIRequestContext, name: string): Promise<TagRow> {
  return await json<TagRow>(await request.post("/api/tags", { data: { name } }));
}

async function assignTag(request: APIRequestContext, pageId: string, tagId: string) {
  await json<{ success: boolean }>(
    await request.post(`/api/pages/${pageId}/tags`, { data: { tagId } }),
  );
}

type FocusStop = {
  slot: string | null;
  aria: string | null;
  text: string;
  focusVisible: boolean;
  shadow: string;
  ring: number[] | null;
  background: number[] | null;
};

function relativeLuminance([red, green, blue]: number[]) {
  const channel = (value: number) => {
    const ratio = value / 255;
    return ratio <= 0.04045 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
}

function contrastRatio(foreground: number[], background: number[]) {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
}

/** Walks backwards from the tag picker so every chip and its remove button is visited. */
async function collectChipTabStops(page: Page): Promise<FocusStop[]> {
  await page.getByLabel("Add an existing tag to this page").focus();
  const stops: FocusStop[] = [];

  for (let step = 0; step < 8; step += 1) {
    await page.keyboard.press("Shift+Tab");
    stops.push(
      await page.evaluate(() => {
        const active = document.activeElement as HTMLElement | null;
        const shadow = active ? getComputedStyle(active).boxShadow : "none";

        function toRgb(color: string): number[] | null {
          if (!color) return null;
          const canvas = document.createElement("canvas");
          canvas.width = 1;
          canvas.height = 1;
          const context = canvas.getContext("2d");
          if (!context) return null;
          // A sentinel catches colors the canvas cannot parse instead of silently reading black.
          context.fillStyle = "#010203";
          context.fillStyle = color;
          if (context.fillStyle === "#010203") return null;
          context.fillRect(0, 0, 1, 1);
          const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
          return [red, green, blue];
        }

        let background = "transparent";
        for (let node: HTMLElement | null = active; node; node = node.parentElement) {
          const color = getComputedStyle(node).backgroundColor;
          if (color && color !== "transparent" && !/(?:,|\/)\s*0(?:\.0+)?\)$/.test(color)) {
            background = color;
            break;
          }
        }

        const ringColor =
          shadow.match(
            /(?:rgba?|lab|oklch|oklab|hsla?|color)\([^)]*\)(?=\s+0px 0px 0px 2px)/i,
          )?.[0] ?? "";

        return {
          slot: active?.getAttribute("data-slot") ?? null,
          aria: active?.getAttribute("aria-label") ?? null,
          text: active?.textContent?.trim() ?? "",
          focusVisible: active?.matches(":focus-visible") ?? false,
          shadow,
          ring: toRgb(ringColor),
          background: toRgb(background),
        };
      }),
    );
  }

  return stops;
}

test("shows the tag chip tooltip only when the name is truncated", async ({ page, request }) => {
  const token = `tag-chip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const longName = `tip-${Date.now().toString().slice(-6)}${Math.random().toString(36).slice(2, 5)} long tag name for tooltip`;
  // Fits the 734px-wide column at 1280px but overflows the 254px-wide column at
  // 320px by a wide margin: the chip only has ~213px for its label there, so a
  // name this long cannot come close to fitting by a pixel or two. The tag API
  // caps names at 50 characters, which is what limits the length below.
  const mediumName = `${token.slice(-6)}-${"x".repeat(43)}`;
  const shortName = `short-${Math.random().toString(36).slice(2, 8)}`;
  const tagged = await createPage(request, `${token} page`);
  const longTag = await createTag(request, longName);
  const mediumTag = await createTag(request, mediumName);
  const shortTag = await createTag(request, shortName);

  try {
    await assignTag(request, tagged.id, longTag.id);
    await assignTag(request, tagged.id, mediumTag.id);
    await assignTag(request, tagged.id, shortTag.id);

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/pages/${tagged.id}`);
    await page.getByText("Page settings", { exact: true }).click();

    const triggers = page.locator('[data-slot="tooltip-trigger"]');
    const longChip = triggers.filter({ hasText: longName });
    const mediumChip = triggers.filter({ has: page.getByText(mediumName, { exact: true }) });
    const shortChip = triggers.filter({ hasText: shortName });
    const tooltip = page.locator('[data-slot="tooltip-content"]');

    await expect(longChip).toHaveCount(1);
    await expect(mediumChip).toHaveCount(1);
    await expect(shortChip).toHaveCount(1);

    // At desktop width the medium name fits, so it is not a tooltip trigger.
    await expect(mediumChip).not.toHaveAttribute("tabindex");
    await mediumChip.hover();
    await page.waitForTimeout(800);
    await expect(tooltip).toBeHidden();

    // Narrowing the viewport truncates it, which enables the tooltip.
    await page.setViewportSize({ width: 320, height: 900 });
    await expect(mediumChip).toHaveAttribute("tabindex", "0");
    await mediumChip.hover();
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText(mediumName);

    // Widening again closes the open tooltip and disables the trigger.
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(tooltip).toBeHidden();
    await expect(mediumChip).not.toHaveAttribute("tabindex");
    await mediumChip.hover();
    await page.waitForTimeout(800);
    await expect(tooltip).toBeHidden();

    await page.setViewportSize({ width: 320, height: 900 });
    await expect(longChip).toHaveAttribute("tabindex", "0");
    await expect(shortChip).not.toHaveAttribute("tabindex");
    await expect(longChip).not.toHaveAttribute("title");
    await expect(shortChip).not.toHaveAttribute("title");

    await longChip.hover();
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText(longName);
    await page.mouse.move(1, 1);
    await expect(tooltip).toBeHidden();

    await longChip.focus();
    await expect(tooltip).toBeVisible();
    await longChip.evaluate((element) => (element as HTMLElement).blur());
    await expect(tooltip).toBeHidden();

    const longBox = await longChip.boundingBox();
    assert.ok(longBox, "the truncated chip should be measurable");
    await page.touchscreen.tap(longBox.x + 12, longBox.y + 12);
    await expect(tooltip).toBeVisible();
    await page.touchscreen.tap(longBox.x + 12, longBox.y + 12);
    await expect(tooltip).toBeHidden();

    await shortChip.hover();
    await page.waitForTimeout(800);
    await expect(tooltip).toBeHidden();

    const shortBox = await shortChip.boundingBox();
    assert.ok(shortBox, "the short chip should be measurable");
    await page.touchscreen.tap(shortBox.x + 8, shortBox.y + 8);
    await page.waitForTimeout(300);
    await expect(tooltip).toBeHidden();

    // Walking backwards from the tag picker visits every chip; only the truncated
    // chips should add a trigger stop, while all remove buttons stay focusable.
    const focusStops = await collectChipTabStops(page);

    const tabbedTriggers = focusStops.filter((stop) => stop.slot === "tooltip-trigger");
    assert.equal(
      tabbedTriggers.length,
      2,
      `expected only the two truncated chips in the tab order: ${JSON.stringify(tabbedTriggers)}`,
    );
    assert.ok(tabbedTriggers.some((stop) => stop.text.includes(longName)));
    assert.ok(tabbedTriggers.some((stop) => stop.text.includes(mediumName)));
    assert.ok(!tabbedTriggers.some((stop) => stop.text.includes(shortName)));
    assert.ok(
      focusStops.some((stop) => stop.aria === `Remove ${shortName} tag`),
      "the short chip's remove button should stay focusable",
    );

    // Keyboard focus on a truncated chip must show a visible ring with 3:1 non-text contrast.
    for (const trigger of tabbedTriggers) {
      assert.equal(trigger.focusVisible, true, `keyboard focus should be focus-visible on ${trigger.text}`);
      assert.notEqual(trigger.shadow, "none", `the focused chip should render a focus ring: ${trigger.shadow}`);
      assert.ok(trigger.shadow.includes("2px"), `the focus ring should be 2px wide: ${trigger.shadow}`);
      const ring = trigger.ring;
      const background = trigger.background;
      assert.ok(ring && background, `could not read the light focus ring or background: ${trigger.shadow}`);
      const ratio = contrastRatio(ring, background);
      assert.ok(
        ratio >= 3,
        `light focus ring contrast is ${ratio.toFixed(2)}:1, below the WCAG 3:1 minimum`,
      );
    }

    const shortShadow = await shortChip.evaluate((element) => getComputedStyle(element).boxShadow);
    assert.equal(shortShadow, "none", "the non-focusable short chip should not render a focus ring");

    // The dark theme swaps both the ring and card colors, so verify the contrast there too.
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    const darkTriggers = (await collectChipTabStops(page)).filter(
      (stop) => stop.slot === "tooltip-trigger",
    );
    assert.equal(
      darkTriggers.length,
      2,
      `expected only the two truncated chips in the dark tab order: ${JSON.stringify(darkTriggers)}`,
    );

    for (const trigger of darkTriggers) {
      assert.equal(trigger.focusVisible, true, `keyboard focus should be focus-visible on ${trigger.text}`);
      const ring = trigger.ring;
      const background = trigger.background;
      assert.ok(ring && background, `could not read the dark focus ring or background: ${trigger.shadow}`);
      const ratio = contrastRatio(ring, background);
      assert.ok(
        ratio >= 3,
        `dark focus ring contrast is ${ratio.toFixed(2)}:1, below the WCAG 3:1 minimum`,
      );
    }
  } finally {
    await purgePage(request, tagged.id);
  }
});
