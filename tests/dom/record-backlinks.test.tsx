import "../setup-dom";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { cleanup, render, screen } from "@testing-library/react";
import { RecordBacklinks } from "../../src/components/record-backlinks";

afterEach(cleanup);

test("lists each record that points here with its database and property", () => {
  render(
    <RecordBacklinks
      backlinks={[
        {
          id: "source-1",
          title: "Harvest plan",
          databaseId: "db-1",
          databaseName: "Projects",
          properties: ["Inspiration"],
        },
        {
          id: "source-2",
          title: "Winter backlog",
          databaseId: "db-2",
          databaseName: "Reading",
          properties: ["Follow-up", "Reference"],
        },
      ]}
    />,
  );

  assert.ok(screen.getByRole("heading", { name: "Linked from" }));

  const first = screen.getByRole("link", { name: "Harvest plan" });
  assert.equal(first.getAttribute("href"), "/databases/db-1/records/source-1");
  assert.ok(screen.getByText("Projects · Inspiration"));

  const second = screen.getByRole("link", { name: "Winter backlog" });
  assert.equal(second.getAttribute("href"), "/databases/db-2/records/source-2");
  assert.ok(
    screen.getByText("Reading · Follow-up, Reference"),
    "every property that links the record is shown",
  );
});

test("shows how many records link here", () => {
  render(
    <RecordBacklinks
      backlinks={[
        {
          id: "source-1",
          title: "Harvest plan",
          databaseId: "db-1",
          databaseName: "Projects",
          properties: ["Inspiration"],
        },
      ]}
    />,
  );

  assert.ok(screen.getByText("(1)"));
});

test("explains when nothing links here and falls back for an untitled record", () => {
  render(<RecordBacklinks backlinks={[]} />);

  assert.ok(screen.getByText("No records link here yet."));
  assert.equal(screen.queryAllByRole("link").length, 0);

  cleanup();

  render(
    <RecordBacklinks
      backlinks={[
        {
          id: "source-1",
          title: "",
          databaseId: "db-1",
          databaseName: "Projects",
          properties: ["Inspiration"],
        },
      ]}
    />,
  );

  assert.ok(screen.getByRole("link", { name: "Untitled" }));
});
