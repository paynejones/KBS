import "../setup-dom";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PageIconPicker } from "../../src/components/page-icon-picker";

afterEach(cleanup);

test("opens the picker and filters the curated icons by name", () => {
  render(<PageIconPicker value="🚀" onSelect={() => {}} onRemove={() => {}} />);

  const trigger = screen.getByRole("button", { name: "Page icon 🚀" });
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  fireEvent.click(trigger);
  assert.equal(trigger.getAttribute("aria-expanded"), "true");

  const search = screen.getByRole("textbox", { name: "Search icons" });
  fireEvent.change(search, { target: { value: "rocket" } });

  assert.ok(screen.getByRole("option", { name: "Rocket" }));
  assert.equal(screen.queryByRole("option", { name: "Page" }), null);
});

test("choosing an icon reports it and closes the picker", () => {
  let selected = "";
  render(<PageIconPicker value="" onSelect={(icon) => { selected = icon; }} onRemove={() => {}} />);

  fireEvent.click(screen.getByRole("button", { name: "Add page icon" }));
  fireEvent.click(screen.getByRole("option", { name: "Rocket" }));

  assert.equal(selected, "🚀");
  assert.equal(screen.queryByRole("dialog"), null);
});

test("removes the current icon and closes the picker", () => {
  let removed = false;
  render(<PageIconPicker value="🚀" onSelect={() => {}} onRemove={() => { removed = true; }} />);

  fireEvent.click(screen.getByRole("button", { name: "Page icon 🚀" }));
  fireEvent.click(screen.getByRole("button", { name: "Remove icon" }));

  assert.equal(removed, true);
  assert.equal(screen.queryByRole("dialog"), null);
});

test("Escape closes the picker and returns focus to the trigger", () => {
  render(<PageIconPicker value="" onSelect={() => {}} onRemove={() => {}} />);

  const trigger = screen.getByRole("button", { name: "Add page icon" });
  fireEvent.click(trigger);
  fireEvent.keyDown(document, { key: "Escape" });

  assert.equal(screen.queryByRole("dialog"), null);
  assert.equal(document.activeElement, trigger);
});

test("explains when the search has no matches", () => {
  render(<PageIconPicker value="" onSelect={() => {}} onRemove={() => {}} />);

  fireEvent.click(screen.getByRole("button", { name: "Add page icon" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Search icons" }), {
    target: { value: "zzzz" },
  });

  assert.ok(screen.getByText("No icons match “zzzz”."));
});
