import "../setup-dom";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RelationCell } from "../../src/components/relation-cell";

afterEach(cleanup);

const options = [
  { id: "harvest", title: "Harvest plan" },
  { id: "winter", title: "Winter backlog" },
  { id: "cover", title: "Cover art" },
];

function pointerDownOnBody() {
  fireEvent(document.body, new window.Event("pointerdown", { bubbles: true }));
}

test("relation cell shows a removable chip for every linked record", () => {
  render(
    <RelationCell
      label="Related"
      value={["harvest", "winter"]}
      options={options}
      onChange={() => {}}
    />,
  );

  assert.ok(screen.getByText("Harvest plan"));
  assert.ok(screen.getByText("Winter backlog"));
  assert.ok(screen.getByRole("button", { name: "Remove Harvest plan" }));
  assert.ok(screen.getByRole("button", { name: "Remove Winter backlog" }));
});

test("relation cell opens a searchable list of records that are not linked yet", () => {
  render(
    <RelationCell
      label="Related"
      value={["harvest"]}
      options={options}
      onChange={() => {}}
    />,
  );

  const trigger = screen.getByRole("button", { name: "Related relation: add a record" });
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.equal(screen.queryByRole("listbox"), null);

  fireEvent.click(trigger);

  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  assert.deepEqual(
    screen.getAllByRole("option").map((option) => option.textContent),
    ["Winter backlog", "Cover art"],
  );
  assert.equal(
    document.activeElement,
    screen.getByLabelText("Related relation: search records"),
    "the search field takes focus so the list is keyboard reachable",
  );
});

test("relation cell filters the list by the typed search", () => {
  render(
    <RelationCell label="Related" value={[]} options={options} onChange={() => {}} />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Related relation: add a record" }));
  const search = screen.getByLabelText("Related relation: search records");

  fireEvent.change(search, { target: { value: "COVER" } });
  assert.deepEqual(
    screen.getAllByRole("option").map((option) => option.textContent),
    ["Cover art"],
    "the search ignores case",
  );

  fireEvent.change(search, { target: { value: "zzz" } });
  assert.equal(screen.queryAllByRole("option").length, 0);
  assert.ok(screen.getByText("No matching records."));
});

test("relation cell adds a picked record and closes the list", () => {
  const changes: string[][] = [];
  render(
    <RelationCell
      label="Related"
      value={["harvest"]}
      options={options}
      onChange={(next) => changes.push(next)}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Related relation: add a record" }));
  fireEvent.click(screen.getByRole("option", { name: "Cover art" }));

  assert.deepEqual(changes, [["harvest", "cover"]]);
  assert.equal(screen.queryByRole("listbox"), null);
  assert.equal(
    document.activeElement,
    screen.getByRole("button", { name: "Related relation: add a record" }),
    "focus returns to the add control",
  );
});

test("relation cell removes a chip without opening the picker", () => {
  const changes: string[][] = [];
  render(
    <RelationCell
      label="Related"
      value={["harvest", "winter", "cover"]}
      options={options}
      onChange={(next) => changes.push(next)}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Remove Winter backlog" }));

  assert.deepEqual(changes, [["harvest", "cover"]]);
  assert.equal(screen.queryByRole("listbox"), null);
});

test("relation cell picks a record from the keyboard and dismisses with Escape", () => {
  const changes: string[][] = [];
  render(
    <RelationCell
      label="Related"
      value={[]}
      options={options}
      onChange={(next) => changes.push(next)}
    />,
  );

  const trigger = screen.getByRole("button", { name: "Related relation: add a record" });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "ArrowDown" });

  const search = screen.getByLabelText("Related relation: search records");
  assert.equal(document.activeElement, search);

  fireEvent.keyDown(search, { key: "ArrowDown" });
  fireEvent.keyDown(search, { key: "Enter" });

  assert.deepEqual(changes, [["winter"]], "Enter picks the highlighted record");
  assert.equal(screen.queryByRole("listbox"), null);

  fireEvent.click(trigger);
  fireEvent.keyDown(screen.getByLabelText("Related relation: search records"), { key: "Escape" });
  assert.equal(screen.queryByRole("listbox"), null);
  assert.equal(document.activeElement, trigger, "Escape restores the add control");
});

test("relation cell closes when focus or a pointer leaves it", () => {
  render(
    <RelationCell label="Related" value={[]} options={options} onChange={() => {}} />,
  );

  const trigger = screen.getByRole("button", { name: "Related relation: add a record" });

  fireEvent.click(trigger);
  pointerDownOnBody();
  assert.equal(screen.queryByRole("listbox"), null, "an outside pointer-down closes the picker");

  fireEvent.click(trigger);
  const outside = document.createElement("button");
  document.body.appendChild(outside);
  fireEvent.focusOut(screen.getByLabelText("Related relation: search records"), {
    relatedTarget: outside,
  });
  assert.equal(screen.queryByRole("listbox"), null, "focus leaving closes the picker");
  outside.remove();

  fireEvent.click(trigger);
  assert.ok(screen.getByRole("listbox"), "the control reopens");
  fireEvent.click(trigger);
  assert.equal(screen.queryByRole("listbox"), null, "the trigger toggles the picker");
});

test("relation cell explains an empty target database and a missing record", () => {
  render(
    <RelationCell label="Related" value={[]} options={[]} onChange={() => {}} />,
  );

  const trigger = screen.getByRole("button", {
    name: "Related relation: add a record",
  }) as HTMLButtonElement;
  assert.equal(trigger.disabled, true);
  assert.ok(screen.getByText("No records to link"));

  cleanup();

  render(
    <RelationCell
      label="Related"
      value={["deleted"]}
      options={options}
      onChange={() => {}}
    />,
  );

  assert.ok(screen.getByText("Missing record"));
  assert.ok(screen.getByRole("button", { name: "Remove Missing record" }));
});
