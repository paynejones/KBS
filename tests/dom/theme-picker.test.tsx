import "../setup-dom";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ThemePicker } from "../../src/components/theme-picker";

beforeEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  document.documentElement.classList.remove("dark");
});

afterEach(cleanup);

function themeSelect() {
  return screen.getByRole("combobox", { name: "Color theme" }) as HTMLSelectElement;
}

test("ThemePicker defaults to the light theme and applies it to the document", () => {
  render(<ThemePicker />);

  assert.equal(themeSelect().value, "light");
  assert.equal(document.documentElement.dataset.theme, "light");
  assert.equal(document.documentElement.classList.contains("dark"), false);
  assert.deepEqual(
    Array.from(themeSelect().options).map((option) => option.textContent),
    ["Light", "Dark", "Warm paper", "Forest", "Slate", "Rose", "Midnight"],
  );
});

test("choosing the dark theme applies it and remembers the choice", () => {
  render(<ThemePicker />);

  fireEvent.change(themeSelect(), { target: { value: "dark" } });

  assert.equal(themeSelect().value, "dark");
  assert.equal(document.documentElement.dataset.theme, "dark");
  assert.equal(document.documentElement.classList.contains("dark"), true);
  assert.equal(window.localStorage.getItem("kbs:theme"), "dark");
});

test("a saved theme is restored on mount", () => {
  window.localStorage.setItem("kbs:theme", "forest");

  render(<ThemePicker />);

  assert.equal(themeSelect().value, "forest");
  assert.equal(document.documentElement.dataset.theme, "forest");
  assert.equal(document.documentElement.classList.contains("dark"), false);
});

test("an unknown saved theme falls back to light", () => {
  window.localStorage.setItem("kbs:theme", "neon");

  render(<ThemePicker />);

  assert.equal(themeSelect().value, "light");
  assert.equal(document.documentElement.dataset.theme, "light");
});
