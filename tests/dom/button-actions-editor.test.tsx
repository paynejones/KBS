import "../setup-dom";
import assert from "node:assert/strict";
import { useState } from "react";
import { afterEach, test } from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ButtonActionsEditor } from "../../src/components/button-actions-editor";
import type { ButtonAction } from "../../src/lib/database-button";

afterEach(cleanup);

const properties = [
  { id: "due", name: "Due", type: "date", options: {} },
  { id: "next", name: "Next", type: "formula", options: { expression: "{Due} + 7" } },
  { id: "sum", name: "Sum", type: "formula", options: { expression: "1 + 2" } },
  { id: "count", name: "Count", type: "number", options: {} },
  { id: "when", name: "When", type: "date", options: {} },
];

function action(propertyId: string, expression: string): ButtonAction {
  return { type: "set_property", propertyId, value: { expression } };
}

function Harness({ initial }: { initial: ButtonAction[] }) {
  const [actions, setActions] = useState(initial);
  return (
    <ButtonActionsEditor
      actions={actions}
      onChange={setActions}
      properties={properties}
      relationProperties={[]}
      relatedProperties={{}}
      currentDatabaseId="database"
      databases={[]}
      databaseProperties={{}}
      databaseRecords={{}}
      onLoadDatabase={() => {}}
    />
  );
}

test("ButtonActionsEditor warns when an expression samples as a date", () => {
  render(<Harness initial={[action("count", "{Next}")]} />);

  const warning = screen.getByRole("status");
  assert.match(warning.textContent ?? "", /can compute a date/);
  assert.match(warning.className, /text-amber-600/);

  fireEvent.change(screen.getByLabelText("Button action value"), {
    target: { value: "{Sum}" },
  });
  assert.equal(screen.queryByRole("status"), null, "a numeric formula stays quiet");
});

test("ButtonActionsEditor does not warn about a date target", () => {
  render(<Harness initial={[action("when", "{Next}")]} />);

  const input = screen.getByLabelText("Button action value") as HTMLInputElement;
  assert.equal(input.value, "{Next}");
  assert.equal(screen.queryByRole("status"), null);
});
