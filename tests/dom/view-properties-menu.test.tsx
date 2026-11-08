import "../setup-dom";
import assert from "node:assert/strict";
import { useState } from "react";
import { afterEach, test } from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ViewPropertiesMenu } from "../../src/components/view-properties-menu";

afterEach(cleanup);

const properties = [
  { id: "status", name: "Status" },
  { id: "due", name: "Due" },
  { id: "owner", name: "Owner" },
];

const changes: string[][] = [];

function Harness({ initial = null }: { initial?: string[] | null }) {
  const [visibleIds, setVisibleIds] = useState<string[] | null>(initial);
  return (
    <ViewPropertiesMenu
      properties={properties}
      visibleIds={visibleIds}
      onChange={(ids) => {
        changes.push(ids);
        setVisibleIds(ids);
      }}
    />
  );
}

function lastChange(): string[] | undefined {
  return changes[changes.length - 1];
}

function openMenu() {
  fireEvent.click(screen.getByTitle("Choose visible properties"));
}

test("the menu starts with every property visible", () => {
  render(<Harness />);
  openMenu();

  assert.ok(screen.getByText("3/3"));
  assert.equal((screen.getByRole("checkbox", { name: "Due" }) as HTMLInputElement).checked, true);
  assert.equal(
    (screen.getByRole("button", { name: "Show all properties" }) as HTMLButtonElement).disabled,
    true,
  );
});

test("hiding and restoring properties reports database order", () => {
  changes.length = 0;
  render(<Harness />);
  openMenu();

  fireEvent.click(screen.getByRole("checkbox", { name: "Due" }));
  assert.deepEqual(lastChange(), ["status", "owner"]);
  assert.ok(screen.getByText("2/3"));
  assert.equal((screen.getByRole("checkbox", { name: "Due" }) as HTMLInputElement).checked, false);

  fireEvent.click(screen.getByRole("checkbox", { name: "Owner" }));
  assert.deepEqual(lastChange(), ["status"]);
  assert.ok(screen.getByText("1/3"));

  fireEvent.click(screen.getByRole("button", { name: "Show all properties" }));
  assert.deepEqual(lastChange(), ["status", "due", "owner"]);
  assert.ok(screen.getByText("3/3"));
});

test("a saved hidden set is respected on load", () => {
  render(<Harness initial={["owner"]} />);
  openMenu();

  assert.ok(screen.getByText("1/3"));
  assert.equal((screen.getByRole("checkbox", { name: "Status" }) as HTMLInputElement).checked, false);
  assert.equal((screen.getByRole("checkbox", { name: "Owner" }) as HTMLInputElement).checked, true);
});
