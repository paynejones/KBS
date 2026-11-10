import assert from "node:assert/strict";
import test from "node:test";
import {
  CHART_DATE_OFFSET_LIMIT,
  chartData,
  chartDateRangeWindow,
  chartDateSpanLabel,
  chartDateWindow,
  chartDatumRecordsHref,
  chartOutsideGroupRecordsHref,
  chartOutsideRecordsHref,
  chartRangeRecordsHref,
  chartMonthRange,
  chartSeries,
  parseChartDatePreset,
  numericChartValue,
  parseChartDateBound,
  parseChartDateOffset,
  parseChartType,
  pieData,
  type ChartProperty,
} from "../src/lib/database-chart";

const score: ChartProperty = { id: "score", name: "Score", type: "number" };
const status: ChartProperty = {
  id: "status",
  name: "Status",
  type: "select",
  options: { choices: ["Todo", "Done"] },
};

const records = [
  { id: "a", title: "Alpha", values: { score: 10, status: "Done" } },
  { id: "b", title: "Beta", values: { score: 4, status: "Todo" } },
  { id: "c", title: "Gamma", values: { score: "6", status: "Todo" } },
  { id: "d", title: "Delta", values: { score: "not a number", status: "Done" } },
  { id: "e", title: "Epsilon", values: { score: 100, status: "Done" } },
];

test("charts one bar per record, largest first, and counts unchartable values", () => {
  const chart = chartData(records, score);

  assert.deepEqual(
    chart.data.map((datum) => [datum.label, datum.value]),
    [["Epsilon", 100], ["Alpha", 10], ["Gamma", 6], ["Beta", 4]],
  );
  assert.equal(chart.max, 100);
  assert.equal(chart.total, 120);
  assert.equal(chart.skipped, 1);
  assert.equal(chart.hidden, 0);
});

test("groups values by a select choice and keeps choice order in the data", () => {
  const chart = chartData(records, score, { groupBy: status });

  // Sorted by summed value, not by the configured choice order.
  assert.deepEqual(
    chart.data.map((datum) => [datum.label, datum.value, datum.count]),
    [["Done", 110, 2], ["Todo", 10, 2]],
  );
  assert.equal(chart.skipped, 1);
  assert.equal(chart.total, 120);
  assert.ok(chart.data.every((datum) => datum.recordId === null));
});

test("an unmapped choice becomes a No value group", () => {
  const chart = chartData(
    [
      { id: "a", title: "Alpha", values: { score: 5 } },
      { id: "b", title: "Beta", values: { score: 7, status: "Todo" } },
    ],
    score,
    { groupBy: status },
  );

  assert.deepEqual(
    chart.data.map((datum) => [datum.label, datum.value]),
    [["Todo", 7], ["No value", 5]],
  );
});

test("grouped data counts records outside the date window per group", () => {
  const when: ChartProperty = { id: "when", name: "When", type: "date" };
  const chart = chartData(
    [
      { id: "a", title: "Alpha", values: { score: 7, status: "Done", when: "2026-11-20" } },
      { id: "b", title: "Beta", values: { score: 3, status: "Todo", when: "2026-11-10" } },
      { id: "c", title: "Gamma", values: { score: 5, status: "Todo", when: "2026-09-15" } },
      { id: "d", title: "Delta", values: { score: "", status: "Done", when: "2026-09-16" } },
      { id: "e", title: "Epsilon", values: { score: "", status: "Todo", when: "2026-09-17" } },
    ],
    score,
    {
      groupBy: status,
      dateProperty: when,
      dateWindow: { from: "2026-11-01", to: "2026-11-30" },
    },
  );

  assert.deepEqual(
    chart.data.map((datum) => [datum.label, datum.value, datum.count, datum.outside]),
    [["Done", 7, 1, 1], ["Todo", 3, 1, 2]],
  );
  assert.equal(chart.total, 10);
  assert.equal(chart.skipped, 0, "outside records are counted, not skipped");
  assert.deepEqual(chart.outsideOnlyGroups, []);
  assert.deepEqual(
    pieData(chart.data).slices.map((slice) => [slice.label, slice.outside]),
    [["Done", 1], ["Todo", 2]],
  );
});

test("a group with only outside-window records stays off grouped bars and pies", () => {
  const when: ChartProperty = { id: "when", name: "When", type: "date" };
  const chart = chartData(
    [
      { id: "a", title: "Alpha", values: { score: 3, status: "Todo", when: "2026-11-10" } },
      { id: "b", title: "Beta", values: { score: 9, status: "Archived", when: "2026-09-15" } },
      { id: "c", title: "Gamma", values: { score: "", status: "Archived", when: "2026-09-16" } },
      { id: "d", title: "Delta", values: { score: "", status: "Done", when: "2026-11-20" } },
    ],
    score,
    {
      groupBy: status,
      dateProperty: when,
      dateWindow: { from: "2026-11-01", to: "2026-11-30" },
    },
  );

  assert.deepEqual(
    chart.data.map((datum) => [datum.label, datum.value, datum.outside]),
    [["Todo", 3, 0]],
    "an outside-only group must not become a zero-valued bar",
  );
  assert.equal(chart.data.some((datum) => datum.label === "Archived"), false);
  assert.deepEqual(chart.outsideOnlyGroups, [{ label: "Archived", count: 2 }]);
  assert.equal(chart.total, 3);
  assert.equal(chart.skipped, 1, "only the in-window blank value is skipped");
  assert.deepEqual(
    pieData(chart.data).slices.map((slice) => [slice.label, slice.value]),
    [["Todo", 3]],
    "an outside-only group must not become a zero-valued slice",
  );
});

test("the bar limit reports the records it leaves out", () => {
  const chart = chartData(records, score, { limit: 2 });
  assert.equal(chart.data.length, 2);
  assert.equal(chart.hidden, 2);
  assert.equal(chart.max, 100);

  const grouped = chartData(records, score, { groupBy: status, limit: 1 });
  assert.deepEqual(grouped.data.map((datum) => datum.label), ["Done"]);
  assert.equal(grouped.hidden, 2);
});

test("calculated values are read through valueFor", () => {
  const chart = chartData(
    [{ id: "a", title: "Alpha", values: {} }],
    score,
    { valueFor: () => 12.5 },
  );

  assert.equal(chart.data[0].value, 12.5);
  assert.equal(chart.max, 12.5);
});

test("parseChartType accepts pie and line and falls back to bars", () => {
  assert.equal(parseChartType("pie"), "pie");
  assert.equal(parseChartType("line"), "line");
  assert.equal(parseChartType("bars"), "bars");
  assert.equal(parseChartType("radar"), "bars");
  assert.equal(parseChartType(undefined), "bars");
});

test("a line series keeps the view's record order and counts missing values", () => {
  const series = chartSeries(records, score);

  assert.deepEqual(
    series.points.map((point) => [point.label, point.value]),
    [["Alpha", 10], ["Beta", 4], ["Gamma", 6], ["Epsilon", 100]],
  );
  assert.equal(series.min, 0);
  assert.equal(series.max, 100);
  assert.equal(series.skipped, 1);
  assert.equal(series.hidden, 0);

  const limited = chartSeries(records, score, { limit: 2 });
  assert.equal(limited.points.length, 2);
  assert.equal(limited.hidden, 2);
});

test("a line series keeps a negative baseline", () => {
  const series = chartSeries(
    [
      { id: "a", title: "Alpha", values: { score: -4 } },
      { id: "b", title: "Beta", values: { score: 6 } },
    ],
    score,
  );

  assert.equal(series.min, -4);
  assert.equal(series.max, 6);
});

test("pie slices divide the positive total and leave zero or negative values out", () => {
  const pie = pieData(chartData(records, score).data);
  assert.deepEqual(
    pie.slices.map((slice) => [slice.label, slice.value]),
    [["Epsilon", 100], ["Alpha", 10], ["Gamma", 6], ["Beta", 4]],
  );
  assert.equal(pie.total, 120);
  assert.equal(pie.excluded, 0);
  assert.ok(Math.abs(pie.slices[1].percent - (10 / 120) * 100) < 1e-9);

  const mixed = pieData([
    { label: "Negative", value: -5, count: 1, recordId: "a" },
    { label: "Zero", value: 0, count: 1, recordId: "b" },
    { label: "Ten", value: 10, count: 1, recordId: "c" },
  ]);
  assert.deepEqual(mixed.slices.map((slice) => [slice.label, slice.percent]), [["Ten", 100]]);
  assert.equal(mixed.excluded, 2);
});

test("a date-axis line sorts by date and leaves undated values out", () => {
  const when: ChartProperty = { id: "when", name: "When", type: "date" };
  const series = chartSeries(
    [
      { id: "a", title: "Alpha", values: { score: 5, when: "2026-11-20" } },
      { id: "b", title: "Beta", values: { score: 2, when: "2026-11-10" } },
      { id: "c", title: "Gamma", values: { score: 9, when: "" } },
      { id: "d", title: "Delta", values: { score: 4, when: "not a date" } },
      { id: "e", title: "Epsilon", values: { score: "", when: "2026-11-12" } },
    ],
    score,
    { dateProperty: when },
  );

  assert.deepEqual(
    series.points.map((point) => [point.label, point.date]),
    [["Beta", "2026-11-10"], ["Alpha", "2026-11-20"]],
  );
  assert.equal(series.from, "2026-11-10");
  assert.equal(series.to, "2026-11-20");
  assert.equal(series.undated, 2);
  assert.equal(series.skipped, 1);

  const limited = chartSeries(
    [
      { id: "a", title: "Alpha", values: { score: 5, when: "2026-11-20" } },
      { id: "b", title: "Beta", values: { score: 2, when: "2026-11-10" } },
    ],
    score,
    { dateProperty: when, limit: 1 },
  );
  assert.deepEqual(limited.points.map((point) => point.label), ["Beta"]);
  assert.equal(limited.hidden, 1);
});

test("a date window keeps the horizon and counts records outside it", () => {
  const when: ChartProperty = { id: "when", name: "When", type: "date" };
  const series = chartSeries(
    [
      { id: "a", title: "Alpha", values: { score: 5, when: "2026-11-20" } },
      { id: "b", title: "Beta", values: { score: 2, when: "2026-11-10" } },
      { id: "c", title: "Gamma", values: { score: 9, when: "2026-12-20" } },
    ],
    score,
    { dateProperty: when, dateWindow: { from: "2026-11-01", to: "2026-11-15" } },
  );

  assert.deepEqual(series.points.map((point) => point.label), ["Beta"]);
  assert.equal(series.outside, 2);
  assert.equal(series.undated, 0);
  assert.equal(series.inWindow, 1);
  assert.equal(series.from, "2026-11-10");
  assert.equal(series.to, "2026-11-10");

  const withSkippedValue = chartSeries(
    [
      { id: "a", title: "Alpha", values: { score: 5, when: "2026-11-20" } },
      { id: "b", title: "Beta", values: { score: "", when: "2026-11-10" } },
      { id: "c", title: "Gamma", values: { score: "", when: "2026-12-20" } },
    ],
    score,
    { dateProperty: when, dateWindow: { from: "2026-11-01", to: "2026-11-15" } },
  );
  assert.equal(
    withSkippedValue.inWindow,
    1,
    "a record without a value still counts inside the range",
  );
  assert.equal(
    withSkippedValue.outside,
    2,
    "records without a value still count outside the range",
  );
});

test("a date window can shift back over earlier periods", () => {
  assert.deepEqual(chartDateWindow("2026-11-08", 30, 0), {
    from: "2026-11-01",
    to: "2026-12-08",
  });
  assert.deepEqual(chartDateWindow("2026-11-08", 7, -7), {
    from: "2026-10-25",
    to: "2026-11-08",
  });
  assert.equal(parseChartDateOffset(-12.7), -12, "shifts are whole days");
  assert.equal(parseChartDateOffset(30), 0, "a window never starts after today");
  assert.equal(parseChartDateOffset("nope"), 0);
  assert.equal(
    parseChartDateOffset(-CHART_DATE_OFFSET_LIMIT * 2),
    -CHART_DATE_OFFSET_LIMIT,
    "shifts stop after ten years of history",
  );
});

test("an explicit date range replaces the rolling window", () => {
  assert.deepEqual(chartDateRangeWindow("2026-10-31", "2026-10-01"), {
    from: "2026-10-01",
    to: "2026-10-31",
  });
  assert.equal(chartDateRangeWindow("2026-10-01", ""), null, "a half-filled range keeps the window");
  assert.equal(parseChartDateBound("2026-02-31"), null, "impossible dates are rejected");
  assert.deepEqual(
    chartDateWindow("2026-11-08", 7, -7, "2026-10-01", "2026-10-31"),
    { from: "2026-10-01", to: "2026-10-31" },
    "an explicit range wins over the rolling window",
  );
  assert.deepEqual(chartDateWindow("2026-11-08", 7, 0, "", ""), {
    from: "2026-11-01",
    to: "2026-11-15",
  });
});

test("month shortcuts cover the whole current and previous month", () => {
  assert.deepEqual(chartMonthRange("2026-11-09", 0), {
    from: "2026-11-01",
    to: "2026-11-30",
  });
  assert.deepEqual(chartMonthRange("2026-11-09", 1), {
    from: "2026-10-01",
    to: "2026-10-31",
  });
  assert.deepEqual(chartMonthRange("2026-01-15", 1), {
    from: "2025-12-01",
    to: "2025-12-31",
  });
  assert.equal(chartMonthRange("not-a-date"), null);
});

test("month presets follow today and beat saved dates", () => {
  assert.equal(parseChartDatePreset("this-month"), "this-month");
  assert.equal(parseChartDatePreset("bogus"), null);
  assert.deepEqual(
    chartDateWindow("2026-12-15", 7, 0, "2026-10-01", "2026-10-31", "this-month"),
    { from: "2026-12-01", to: "2026-12-31" },
    "the preset follows today instead of the saved dates",
  );
  assert.deepEqual(
    chartDateWindow("2026-02-10", 7, 0, null, null, "last-month"),
    { from: "2026-01-01", to: "2026-01-31" },
  );
  assert.deepEqual(chartDateWindow("2026-11-08", 7, 0, "", "", "bogus"), {
    from: "2026-11-01",
    to: "2026-11-15",
  });
});

test("a chart datum links to the database filtered to its records", () => {
  const record = new URL(
    chartDatumRecordsHref("db-1", {
      recordId: "record-1",
      rangePropertyId: "when",
      rangeStart: "2026-11-01",
      rangeEnd: "2026-11-30",
      viewId: "view-1",
      fromViewId: "chart-1",
      fromDashboard: true,
    }),
    "https://example.test",
  );
  assert.equal(record.pathname, "/databases/db-1");
  assert.equal(record.searchParams.get("record"), "record-1");
  assert.equal(record.searchParams.get("rangeProperty"), "when");
  assert.equal(record.searchParams.get("rangeStart"), "2026-11-01");
  assert.equal(record.searchParams.get("rangeEnd"), "2026-11-30");
  assert.equal(record.searchParams.get("view"), "view-1");
  assert.equal(record.searchParams.get("from"), "chart-1");
  assert.equal(record.searchParams.get("origin"), "dashboard");
  assert.equal(record.searchParams.has("filterProperty"), false);

  const group = new URL(
    chartDatumRecordsHref("db-1", { groupPropertyId: "status", groupLabel: "In progress" }),
    "https://example.test",
  );
  assert.equal(group.searchParams.get("filterProperty"), "status");
  assert.equal(group.searchParams.get("filterValue"), "In progress");
  assert.equal(group.searchParams.has("record"), false);
});

test("a range record count links to a filtered database", () => {
  const href = new URL(
    chartRangeRecordsHref("db-1", "when", "2026-11-01", "2026-11-30", "view-1", "chart-1"),
    "https://example.test",
  );
  assert.equal(href.pathname, "/databases/db-1");
  assert.equal(href.searchParams.get("rangeProperty"), "when");
  assert.equal(href.searchParams.get("rangeStart"), "2026-11-01");
  assert.equal(href.searchParams.get("rangeEnd"), "2026-11-30");
  assert.equal(href.searchParams.get("view"), "view-1");
  assert.equal(href.searchParams.get("from"), "chart-1");
  assert.equal(href.searchParams.has("origin"), false);
  assert.equal(
    new URL(
      chartRangeRecordsHref("db-1", "when", "2026-11-01", "2026-11-30", "view-1", "chart-1", true),
      "https://example.test",
    ).searchParams.get("origin"),
    "dashboard",
  );
  assert.equal(
    new URL(chartRangeRecordsHref("db-1", "when", "2026-11-01", "2026-11-30"), "https://example.test")
      .searchParams.has("view"),
    false,
  );

  const outside = new URL(
    chartOutsideRecordsHref("db-1", "when", "2026-11-01", "2026-11-30", "view-1", "chart-1", true),
    "https://example.test",
  );
  assert.equal(outside.searchParams.get("rangeMode"), "outside");
  assert.equal(outside.searchParams.get("origin"), "dashboard");

  const outsideGroup = new URL(
    chartOutsideGroupRecordsHref(
      "db-1",
      "when",
      "2026-11-01",
      "2026-11-30",
      "status",
      "Archived",
      "view-1",
      "chart-1",
      true,
    ),
    "https://example.test",
  );
  assert.equal(outsideGroup.searchParams.get("filterProperty"), "status");
  assert.equal(outsideGroup.searchParams.get("filterValue"), "Archived");
  assert.equal(outsideGroup.searchParams.get("rangeProperty"), "when");
  assert.equal(outsideGroup.searchParams.get("rangeStart"), "2026-11-01");
  assert.equal(outsideGroup.searchParams.get("rangeEnd"), "2026-11-30");
  assert.equal(outsideGroup.searchParams.get("rangeMode"), "outside");
  assert.equal(outsideGroup.searchParams.get("view"), "view-1");
  assert.equal(outsideGroup.searchParams.get("from"), "chart-1");
  assert.equal(outsideGroup.searchParams.get("origin"), "dashboard");
});

test("a date span reads as a compact label", () => {
  assert.equal(chartDateSpanLabel("2026-11-01", "2026-11-30"), "Nov 1–30, 2026");
  assert.equal(chartDateSpanLabel("2026-10-01", "2026-10-31"), "Oct 1–31, 2026");
  assert.equal(chartDateSpanLabel("2025-12-01", "2026-01-31"), "Dec 1, 2025 – Jan 31, 2026");
  assert.equal(
    chartDateSpanLabel("2026-11-30", "2026-11-01"),
    "Nov 1–30, 2026",
    "reversed bounds read in calendar order",
  );
  assert.equal(chartDateSpanLabel("2026-02-31", "2026-03-01"), "", "invalid dates have no span");
});

test("numericChartValue accepts finite numbers and numeric strings only", () => {
  assert.equal(numericChartValue(3), 3);
  assert.equal(numericChartValue(" 4.5 "), 4.5);
  assert.equal(numericChartValue(""), null);
  assert.equal(numericChartValue("abc"), null);
  assert.equal(numericChartValue(null), null);
  assert.equal(numericChartValue(Number.POSITIVE_INFINITY), null);
});
