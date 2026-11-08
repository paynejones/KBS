import assert from "node:assert/strict";
import { test } from "@playwright/test";

const THEMES = ["light", "dark", "warm", "forest"] as const;
const SURFACES = [
  "--background",
  "--card",
  "--popover",
  "--muted",
  "--secondary",
  "--accent",
  "--sidebar",
  "--sidebar-accent",
] as const;

for (const theme of THEMES) {
  test(`${theme} theme focus rings meet 3:1 non-text contrast`, async ({ page }) => {
    await page.addInitScript((value) => {
      window.localStorage.setItem("kbs:theme", value);
    }, theme);
    await page.goto("/");

    const result = await page.evaluate((surfaces) => {
      const root = document.documentElement;
      const styles = getComputedStyle(root);
      const token = (name: string) => styles.getPropertyValue(name).trim();

      function toRgb(color: string): number[] {
        const canvas = document.createElement("canvas");
        canvas.width = 1;
        canvas.height = 1;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas 2D is unavailable.");
        // A sentinel catches colors the canvas cannot parse instead of silently reading black.
        context.fillStyle = "#010203";
        context.fillStyle = color;
        if (context.fillStyle === "#010203") throw new Error(`Could not parse color: ${color}`);
        context.fillRect(0, 0, 1, 1);
        const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
        return [red, green, blue];
      }

      function luminance([red, green, blue]: number[]) {
        const channel = (value: number) => {
          const ratio = value / 255;
          return ratio <= 0.04045 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
      }

      function contrast(first: string, second: string) {
        const firstLuminance = luminance(toRgb(first));
        const secondLuminance = luminance(toRgb(second));
        return Number(
          (
            (Math.max(firstLuminance, secondLuminance) + 0.05) /
            (Math.min(firstLuminance, secondLuminance) + 0.05)
          ).toFixed(2),
        );
      }

      const ring = token("--ring");
      const sidebarRing = token("--sidebar-ring");

      return {
        theme: root.dataset.theme,
        dark: root.classList.contains("dark"),
        ring,
        sidebarRing,
        checks: surfaces.map((surface) => {
          const color = token(surface);
          return {
            surface,
            color,
            ring: contrast(ring, color),
            sidebarRing: contrast(sidebarRing, color),
          };
        }),
      };
    }, [...SURFACES]);

    assert.equal(result.theme, theme);
    assert.equal(result.dark, theme === "dark");

    // Controls that opt out of the native outline must still receive the 2px fallback.
    const themeSelect = page.getByLabel("Color theme");
    await themeSelect.focus();
    const fallback = await themeSelect.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        focusVisible: element.matches(":focus-visible"),
        outlineStyle: style.outlineStyle,
        outlineWidth: Number.parseFloat(style.outlineWidth),
      };
    });
    assert.equal(fallback.focusVisible, true);
    assert.equal(fallback.outlineStyle, "solid");
    assert.ok(fallback.outlineWidth >= 2, `fallback outline is ${fallback.outlineWidth}px`);

    for (const check of result.checks) {
      assert.ok(
        check.ring >= 3,
        `${theme}: --ring ${result.ring} against ${check.surface} ${check.color} is ${check.ring}:1`,
      );
      assert.ok(
        check.sidebarRing >= 3,
        `${theme}: --sidebar-ring ${result.sidebarRing} against ${check.surface} ${check.color} is ${check.sidebarRing}:1`,
      );
    }
  });
}
