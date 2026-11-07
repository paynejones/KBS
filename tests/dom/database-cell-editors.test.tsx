import "../setup-dom";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DateCell, SelectCell } from "../../src/components/database-cell-editors";

afterEach(cleanup);

function chooses(values: string[]) {
  return (value: string) => values.push(value);
}

function pointerDownOnBody() {
  fireEvent(document.body, new window.Event("pointerdown", { bubbles: true }));
}

test("select cell shows a placeholder pill trigger before a value is set", () => {
  render(
    <SelectCell
      label="Status"
      recordTitle="Harvest plan"
      value=""
      choices={["Todo", "Done"]}
      onChange={() => {}}
    />,
  );

  const trigger = screen.getByRole("button", { name: "Status for Harvest plan" });
  assert.equal(trigger.getAttribute("aria-haspopup"), "listbox");
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.equal(trigger.textContent, "Choose…");
  assert.equal(screen.queryByRole("listbox"), null);
});

test("select cell opens a listbox of choices and saves the picked one", () => {
  const changes: string[] = [];
  render(
    <SelectCell
      label="Status"
      recordTitle="Harvest plan"
      value=""
      choices={["Todo", "In progress", "Done"]}
      onChange={chooses(changes)}
    />,
  );

  const trigger = screen.getByRole("button", { name: "Status for Harvest plan" });
  fireEvent.click(trigger);

  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  const options = screen.getAllByRole("option");
  assert.deepEqual(
    options.map((option) => option.getAttribute("aria-selected")),
    ["false", "false", "false"],
  );
  assert.deepEqual(
    options.map((option) => option.textContent),
    ["Todo", "In progress", "Done"],
  );

  fireEvent.click(options[1]);

  assert.deepEqual(changes, ["In progress"]);
  assert.equal(screen.queryByRole("listbox"), null, "picking closes the menu");
});

test("select cell marks the current choice and clears it", () => {
  const changes: string[] = [];
  render(
    <SelectCell
      label="Status"
      recordTitle="Harvest plan"
      value="Done"
      choices={["Todo", "Done"]}
      onChange={chooses(changes)}
    />,
  );

  const trigger = screen.getByRole("button", { name: "Status for Harvest plan" });
  assert.match(trigger.textContent ?? "", /Done/);

  fireEvent.click(trigger);
  const options = screen.getAllByRole("option");
  assert.equal(options[1].getAttribute("aria-selected"), "true");

  fireEvent.click(screen.getByRole("button", { name: "Clear" }));
  assert.deepEqual(changes, [""]);
  assert.equal(screen.queryByRole("listbox"), null);
});

test("select cell offers no clear action while empty", () => {
  render(
    <SelectCell
      label="Status"
      recordTitle="Harvest plan"
      value=""
      choices={["Todo"]}
      onChange={() => {}}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Status for Harvest plan" }));

  assert.equal(screen.queryByRole("button", { name: "Clear" }), null);
});

test("select cell closes on Escape, outside click and a second click, and follows scrolling", () => {
  render(
    <SelectCell
      label="Status"
      recordTitle="Harvest plan"
      value=""
      choices={["Todo"]}
      onChange={() => {}}
    />,
  );

  const trigger = screen.getByRole("button", { name: "Status for Harvest plan" });
  const open = () => fireEvent.click(trigger);

  open();
  fireEvent.keyDown(document, { key: "Escape" });
  assert.equal(screen.queryByRole("listbox"), null, "Escape closes");

  open();
  pointerDownOnBody();
  assert.equal(screen.queryByRole("listbox"), null, "outside pointer-down closes");

  open();
  fireEvent.scroll(window);
  assert.ok(screen.getByRole("listbox"), "scrolling re-anchors instead of closing");
  fireEvent.resize(window);
  assert.ok(screen.getByRole("listbox"), "resizing re-anchors instead of closing");

  open();
  assert.equal(screen.queryByRole("listbox"), null, "the trigger toggles");
});

test("date cell shows a short date instead of an editable field", () => {
  render(
    <DateCell
      label="Due"
      recordTitle="Harvest plan"
      value="2026-11-19"
      onChange={() => {}}
    />,
  );

  const trigger = screen.getByRole("button", { name: "Due for Harvest plan" });
  const text = trigger.textContent ?? "";
  assert.match(text, /19/, "keeps the day");
  assert.ok(!text.includes("2026"), "drops the year");
  assert.ok(!text.includes("2026-11-19"), "does not show the stored ISO value");
  assert.ok(text.length <= 8, `cell text stays short, got "${text}"`);
  assert.equal(screen.queryByRole("textbox"), null, "no always-on date input");
  assert.equal(trigger.getAttribute("aria-haspopup"), "dialog");
});

test("date cell shows a muted placeholder when empty", () => {
  render(
    <DateCell label="Due" recordTitle="Harvest plan" value="" onChange={() => {}} />,
  );

  assert.equal(
    screen.getByRole("button", { name: "Due for Harvest plan" }).textContent,
    "Set date",
  );
});

test("date cell opens a picker seeded with the stored value and saves a change", () => {
  const changes: string[] = [];
  render(
    <DateCell
      label="Due"
      recordTitle="Harvest plan"
      value="2026-11-19"
      onChange={chooses(changes)}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Due for Harvest plan" }));

  const dialog = screen.getByRole("dialog", { name: "Due picker" });
  const input = screen.getByLabelText("Due date") as HTMLInputElement;
  assert.ok(dialog.contains(input));
  assert.equal(input.value, "2026-11-19");

  fireEvent.change(input, { target: { value: "2026-12-01" } });
  assert.deepEqual(changes, ["2026-12-01"]);
  assert.equal(screen.queryByRole("dialog", { name: "Due picker" }), null);
});

test("date cell picker clears and dismisses without saving", () => {
  const changes: string[] = [];
  render(
    <DateCell
      label="Due"
      recordTitle="Harvest plan"
      value="2026-11-19"
      onChange={chooses(changes)}
    />,
  );

  const open = () =>
    fireEvent.click(screen.getByRole("button", { name: "Due for Harvest plan" }));

  open();
  fireEvent.click(screen.getByRole("button", { name: "Clear" }));
  assert.deepEqual(changes, [""]);
  assert.equal(screen.queryByRole("dialog", { name: "Due picker" }), null);

  open();
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  assert.deepEqual(changes, [""], "Done dismisses without a second change");
  assert.equal(screen.queryByRole("dialog", { name: "Due picker" }), null);

  open();
  fireEvent.keyDown(document, { key: "Escape" });
  assert.equal(screen.queryByRole("dialog", { name: "Due picker" }), null);
  assert.deepEqual(changes, [""]);
});

test("select cell opens from the keyboard and moves focus with the arrow keys", () => {
  render(
    <SelectCell
      label="Status"
      recordTitle="Harvest plan"
      value="In progress"
      choices={["Todo", "In progress", "Done"]}
      onChange={() => {}}
    />,
  );

  const trigger = screen.getByRole("button", { name: "Status for Harvest plan" });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "ArrowDown" });

  const options = screen.getAllByRole("option");
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  assert.ok(trigger.getAttribute("aria-controls"));
  assert.equal(document.activeElement, options[1], "focus starts on the current choice");

  fireEvent.keyDown(options[1], { key: "ArrowDown" });
  assert.equal(document.activeElement, options[2]);
  fireEvent.keyDown(options[2], { key: "ArrowDown" });
  assert.equal(document.activeElement, options[0], "ArrowDown wraps");

  fireEvent.keyDown(options[0], { key: "ArrowUp" });
  assert.equal(document.activeElement, options[2], "ArrowUp wraps");

  fireEvent.keyDown(options[2], { key: "Home" });
  assert.equal(document.activeElement, options[0]);
  fireEvent.keyDown(options[0], { key: "End" });
  assert.equal(document.activeElement, options[2]);
});

test("select cell opens at the last choice from ArrowUp on the cell", () => {
  render(
    <SelectCell
      label="Status"
      recordTitle="Harvest plan"
      value=""
      choices={["Todo", "In progress", "Done"]}
      onChange={() => {}}
    />,
  );

  const trigger = screen.getByRole("button", { name: "Status for Harvest plan" });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "ArrowUp" });

  assert.equal(screen.getAllByRole("option")[2], document.activeElement);
});

test("select cell jumps to a choice while typing", () => {
  render(
    <SelectCell
      label="Status"
      recordTitle="Harvest plan"
      value=""
      choices={["Todo", "In progress", "Done"]}
      onChange={() => {}}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Status for Harvest plan" }));
  const options = screen.getAllByRole("option");
  assert.equal(document.activeElement, options[0]);

  fireEvent.keyDown(options[0], { key: "d" });
  assert.equal(document.activeElement, options[2], "D matches Done");

  fireEvent.keyDown(options[2], { key: "t" });
  assert.equal(document.activeElement, options[0], "typing again searches from the next choice");
});

test("select cell returns focus to the cell on Escape and after choosing", () => {
  render(
    <SelectCell
      label="Status"
      recordTitle="Harvest plan"
      value=""
      choices={["Todo", "Done"]}
      onChange={() => {}}
    />,
  );

  const trigger = screen.getByRole("button", { name: "Status for Harvest plan" });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" });

  assert.equal(screen.queryByRole("listbox"), null);
  assert.equal(document.activeElement, trigger, "Escape restores the cell focus");

  fireEvent.click(trigger);
  fireEvent.click(screen.getAllByRole("option")[1]);

  assert.equal(screen.queryByRole("listbox"), null);
  assert.equal(document.activeElement, trigger, "choosing restores the cell focus");
});

test("select cell closes when focus leaves the menu", () => {
  render(
    <SelectCell
      label="Status"
      recordTitle="Harvest plan"
      value=""
      choices={["Todo", "Done"]}
      onChange={() => {}}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Status for Harvest plan" }));
  const outside = document.createElement("button");
  document.body.appendChild(outside);

  fireEvent.focusOut(screen.getAllByRole("option")[0], { relatedTarget: outside });

  assert.equal(screen.queryByRole("listbox"), null);
  outside.remove();
});

test("date cell opens from the keyboard and returns focus on Escape", () => {
  render(
    <DateCell
      label="Due"
      recordTitle="Harvest plan"
      value="2026-11-19"
      onChange={() => {}}
    />,
  );

  const trigger = screen.getByRole("button", { name: "Due for Harvest plan" });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "ArrowDown" });

  const input = screen.getByLabelText("Due date");
  assert.equal(document.activeElement, input, "focus lands in the date field");

  fireEvent.keyDown(input, { key: "Escape" });
  assert.equal(screen.queryByRole("dialog", { name: "Due picker" }), null);
  assert.equal(document.activeElement, trigger);
});

test("date cell returns focus to the cell after Done and closes when focus leaves", () => {
  render(
    <DateCell
      label="Due"
      recordTitle="Harvest plan"
      value="2026-11-19"
      onChange={() => {}}
    />,
  );

  const trigger = screen.getByRole("button", { name: "Due for Harvest plan" });

  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  assert.equal(document.activeElement, trigger, "Done restores the cell focus");

  fireEvent.click(trigger);
  const outside = document.createElement("button");
  document.body.appendChild(outside);
  fireEvent.focusOut(screen.getByLabelText("Due date"), { relatedTarget: outside });

  assert.equal(screen.queryByRole("dialog", { name: "Due picker" }), null);
  outside.remove();
});
