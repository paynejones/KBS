import "../setup-dom";
import assert from "node:assert/strict";
import { useState } from "react";
import { afterEach, test } from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DatabaseViewControls } from "../../src/components/database-view-controls";
import type { ViewFilter, ViewSort } from "../../src/lib/database-view";

type Property = {
  id: string;
  name: string;
  type: string;
  options?: Record<string, unknown>;
};

afterEach(cleanup);

function Harness({ properties, recordCount = 3 }: { properties: Property[]; recordCount?: number }) {
  const [filterText, setFilterText] = useState("");
  const [filters, setFilters] = useState<ViewFilter[]>([]);
  const [sorts, setSorts] = useState<ViewSort[]>([]);

  return (
    <DatabaseViewControls
      properties={properties}
      filterText={filterText}
      filters={filters}
      sorts={sorts}
      recordCount={recordCount}
      onFilterTextChange={setFilterText}
      onFiltersChange={setFilters}
      onSortsChange={setSorts}
    />
  );
}

const properties: Property[] = [
  { id: "notes", name: "Notes", type: "text" },
  { id: "score", name: "Score", type: "number" },
  { id: "related", name: "Related", type: "relation" },
];

test("DatabaseViewControls adds, reconfigures, and removes a filter", () => {
  render(<Harness properties={properties} />);

  assert.equal(screen.queryByLabelText("Filter property"), null);
  fireEvent.click(screen.getByRole("button", { name: "Filter" }));

  const property = screen.getByLabelText("Filter property") as HTMLSelectElement;
  const operator = screen.getByLabelText("Filter operator") as HTMLSelectElement;
  const value = screen.getByLabelText("Filter value");
  assert.equal(property.value, "notes");
  assert.equal(operator.value, "contains");
  assert.equal(value.getAttribute("type"), "text");
  assert.match(screen.getByText(/records/).textContent ?? "", /3 records · 1 filter/);

  fireEvent.change(property, { target: { value: "score" } });
  assert.equal((screen.getByLabelText("Filter operator") as HTMLSelectElement).value, "is");
  assert.equal(screen.getByLabelText("Filter value").getAttribute("type"), "number");

  fireEvent.change(screen.getByLabelText("Filter operator"), { target: { value: "greater_than" } });
  fireEvent.change(screen.getByLabelText("Filter value"), { target: { value: "10" } });
  assert.equal((screen.getByLabelText("Filter value") as HTMLInputElement).value, "10");

  fireEvent.click(screen.getByRole("button", { name: "Remove filter" }));
  assert.equal(screen.queryByLabelText("Filter property"), null);
  assert.equal(screen.getByText("3 records").textContent, "3 records");
});

test("DatabaseViewControls caps sorting at three rules and keeps one removable", () => {
  render(<Harness properties={properties} />);

  fireEvent.click(screen.getByRole("button", { name: "Sort" }));
  assert.equal((screen.getByLabelText("Sort property") as HTMLSelectElement).value, "title");
  assert.ok(screen.getByRole("button", { name: "Sort descending" }));
  assert.equal((screen.getByRole("button", { name: "Remove sort" }) as HTMLButtonElement).disabled, true);

  fireEvent.click(screen.getByRole("button", { name: "Sort" }));
  assert.equal((screen.getByLabelText("Secondary sort property") as HTMLSelectElement).value, "notes");
  fireEvent.click(screen.getByRole("button", { name: "Sort" }));
  assert.equal(screen.getAllByLabelText("Secondary sort property").length, 2);
  assert.equal((screen.getByRole("button", { name: "Sort" }) as HTMLButtonElement).disabled, true);

  fireEvent.click(screen.getAllByRole("button", { name: "Remove sort" })[0]);
  assert.equal(screen.getAllByRole("button", { name: "Remove sort" }).length, 2);
  assert.equal((screen.getByRole("button", { name: "Sort" }) as HTMLButtonElement).disabled, false);
});

test("DatabaseViewControls uses choices for select filters and hides values for checkboxes", () => {
  render(<Harness properties={[
    { id: "status", name: "Status", type: "select", options: { choices: ["Todo", "Done"] } },
    { id: "done", name: "Done", type: "checkbox" },
  ]} />);

  fireEvent.click(screen.getByRole("button", { name: "Filter" }));
  fireEvent.change(screen.getByLabelText("Filter property"), { target: { value: "status" } });
  const choices = screen.getByLabelText("Filter value") as HTMLSelectElement;
  assert.deepEqual(
    Array.from(choices.options).map((option) => option.textContent),
    ["Choose a value…", "Todo", "Done"],
  );
  fireEvent.change(choices, { target: { value: "Done" } });
  assert.equal((screen.getByLabelText("Filter value") as HTMLSelectElement).value, "Done");

  fireEvent.change(screen.getByLabelText("Filter property"), { target: { value: "done" } });
  assert.equal((screen.getByLabelText("Filter operator") as HTMLSelectElement).value, "is_checked");
  assert.equal(screen.queryByLabelText("Filter value"), null);
});

test("DatabaseViewControls disables filtering when every property is unsupported", () => {
  render(<Harness properties={[
    { id: "related", name: "Related", type: "relation" },
    { id: "total", name: "Rollup", type: "rollup" },
    { id: "file", name: "File", type: "file" },
  ]} />);

  assert.equal((screen.getByRole("button", { name: "Filter" }) as HTMLButtonElement).disabled, true);
  assert.equal((screen.getByRole("button", { name: "Sort" }) as HTMLButtonElement).disabled, false);
});
