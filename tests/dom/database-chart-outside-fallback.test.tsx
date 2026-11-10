import "../setup-dom";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { cleanup, render, screen } from "@testing-library/react";
import { ChartBars, ChartPie } from "../../src/components/database-chart";
import type { ChartData } from "../../src/lib/database-chart";

afterEach(cleanup);

const chart: ChartData = {
  data: [
    { label: "Todo", value: 8, count: 2, recordId: null, outside: 1 },
    { label: "Done", value: 2, count: 1, recordId: null },
  ],
  max: 8,
  total: 10,
  skipped: 0,
  hidden: 0,
  outsideOnlyGroups: [],
};

const groupProperty = { id: "status", name: "Status" };

function expectNoOutsideCountLinks() {
  assert.equal(screen.queryByRole("link", { name: "1 outside" }), null);
  assert.equal(
    screen.queryByRole("link", { name: /outside this date window/i }),
    null,
  );
}

test("outside counts stay plain text when no date window is configured", () => {
  render(
    <ChartBars
      databaseId="db-1"
      chart={chart}
      groupProperty={groupProperty}
      sourceViewId="view-1"
      datePropertyId="when"
      fromDashboard
    />,
  );
  assert.equal(screen.getByText(/1 outside/).closest("a"), null);
  expectNoOutsideCountLinks();

  cleanup();

  render(
    <ChartPie
      databaseId="db-1"
      chart={chart}
      groupProperty={groupProperty}
      sourceViewId="view-1"
      datePropertyId="when"
      fromDashboard
    />,
  );
  assert.equal(screen.getByText(/1 outside/).closest("a"), null);
  expectNoOutsideCountLinks();
});
