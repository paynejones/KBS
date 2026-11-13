import assert from "node:assert/strict";
import { expect, test, type APIRequestContext, type APIResponse } from "@playwright/test";

async function json<T>(response: APIResponse): Promise<T> {
  const text = await response.text();
  assert.ok(response.ok(), `${response.url()} returned ${response.status()}: ${text}`);
  return JSON.parse(text) as T;
}

async function post<T>(
  request: APIRequestContext,
  url: string,
  data: Record<string, unknown>,
): Promise<T> {
  return await json<T>(await request.post(url, { data }));
}

test("renders saved list, timeline, and chart views", async ({ page, request }) => {
  const token = `views-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const database = await post<{ id: string }>(request, "/api/databases", {
    name: `${token} database`,
  });

  try {
    const when = await post<{ id: string }>(
      request,
      `/api/databases/${database.id}/properties`,
      { name: "When", type: "date" },
    );
    const score = await post<{ id: string }>(
      request,
      `/api/databases/${database.id}/properties`,
      { name: "Score", type: "number" },
    );

    const alpha = `${token} Alpha`;
    const beta = `${token} Beta`;
    const alphaRecord = await post<{ id: string }>(
      request,
      `/api/databases/${database.id}/records`,
      { title: alpha },
    );
    await json(
      await request.patch(`/api/databases/${database.id}/records/${alphaRecord.id}`, {
        data: { values: { [when.id]: "2026-11-20", [score.id]: 7 } },
      }),
    );
    await post(request, `/api/databases/${database.id}/records`, { title: beta });
    const gamma = `${token} Gamma`;
    const gammaRecord = await post<{ id: string }>(
      request,
      `/api/databases/${database.id}/records`,
      { title: gamma },
    );
    await json(
      await request.patch(`/api/databases/${database.id}/records/${gammaRecord.id}`, {
        data: { values: { [when.id]: "2026-11-18", [score.id]: 3 } },
      }),
    );

    await post(request, `/api/databases/${database.id}/views`, {
      name: "List",
      type: "list",
      config: {},
    });
    await post(request, `/api/databases/${database.id}/views`, {
      name: "Timeline",
      type: "timeline",
      config: { datePropertyId: when.id, timelineRange: 30 },
    });
    const chartView = await post<{ id: string }>(request, `/api/databases/${database.id}/views`, {
      name: "Chart",
      type: "chart",
      config: { chartPropertyId: score.id },
    });

    await page.goto(`/databases/${database.id}`);

    await page.getByRole("button", { name: "List", exact: true }).click();
    const list = page.getByRole("region", { name: "List view" });
    await expect(list).toBeVisible();
    await expect(list.getByRole("heading", { name: alpha })).toBeVisible();
    await expect(list.getByText("7", { exact: true })).toBeVisible();
    await expect(list.getByRole("heading", { name: beta })).toBeVisible();

    await page.getByRole("button", { name: "Timeline", exact: true }).click();
    const timeline = page.getByRole("region", { name: "When timeline" });
    await expect(timeline).toBeVisible();
    await expect(timeline.getByRole("link", { name: alpha })).toBeVisible();
    await expect(timeline.getByText("No date")).toBeVisible();
    await expect(timeline.getByRole("link", { name: beta })).toBeVisible();

    await page.getByRole("button", { name: "Chart", exact: true }).click();
    const chart = page.getByRole("region", { name: "Score chart" });
    await expect(chart).toBeVisible();
    await expect(chart.getByRole("link", { name: alpha, exact: true })).toBeVisible();
    await expect(chart.getByText("7", { exact: true })).toBeVisible();
    await expect(chart.getByText("1 record has no Score value.")).toBeVisible();

    await chart.getByLabel("Chart type").selectOption("pie");
    await expect(chart.getByText("70% · 7")).toBeVisible();
    await expect(chart.getByText("30% · 3")).toBeVisible();

    const savedLine = page.waitForResponse((response) =>
      response.url().endsWith(`/api/databases/${database.id}/views/${chartView.id}`)
      && response.request().method() === "PATCH",
    );
    await chart.getByLabel("Chart type").selectOption("line");
    assert.equal((await savedLine).status(), 200);
    await expect(chart.getByText("2 points").first()).toBeVisible();
    await expect(chart.getByText("High 7")).toBeVisible();
    await expect(chart.getByText("Low 0")).toBeVisible();
    await chart.getByText("Show 2 values").click();
    await expect(chart.getByText(gamma, { exact: true })).toBeVisible();
    await expect(chart.getByText("1 record has no Score value.")).toBeVisible();

    // A date property puts the points on a real time axis, earliest first.
    const savedDates = page.waitForResponse((response) =>
      response.url().endsWith(`/api/databases/${database.id}/views/${chartView.id}`)
      && response.request().method() === "PATCH",
    );
    await chart.getByLabel("Chart date property").selectOption(when.id);
    assert.equal((await savedDates).status(), 200);
    await expect(chart.locator("details ol li a")).toHaveText([gamma, alpha]);

    const savedWindow = page.waitForResponse((response) =>
      response.url().endsWith(`/api/databases/${database.id}/views/${chartView.id}`)
      && response.request().method() === "PATCH",
    );
    await chart.getByLabel("Chart date window").selectOption("7");
    assert.equal((await savedWindow).status(), 200);
    await expect(chart.getByLabel("Chart date window")).toHaveValue("7");

    const shiftedWindow = page.waitForResponse((response) =>
      response.url().endsWith(`/api/databases/${database.id}/views/${chartView.id}`)
      && response.request().method() === "PATCH",
    );
    await chart.getByRole("button", { name: "Previous date window" }).click();
    assert.equal((await shiftedWindow).status(), 200);
    await expect(chart.getByText("7 days back")).toBeVisible();

    const rangeStart = page.waitForResponse((response) =>
      response.url().endsWith(`/api/databases/${database.id}/views/${chartView.id}`)
      && response.request().method() === "PATCH",
    );
    await chart.getByLabel("Chart range start").fill("2026-10-01");
    assert.equal((await rangeStart).status(), 200);

    const rangeEnd = page.waitForResponse((response) =>
      response.url().endsWith(`/api/databases/${database.id}/views/${chartView.id}`)
      && response.request().method() === "PATCH",
    );
    await chart.getByLabel("Chart range end").fill("2026-10-31");
    assert.equal((await rangeEnd).status(), 200);
    await expect(chart.getByText("Custom range")).toBeVisible();
    await expect(
      chart.getByText("Custom range · Oct 1–31, 2026 · 0 records · 2 outside"),
    ).toBeVisible();
    await chart.getByRole("link", { name: "2 outside" }).click();
    await expect(page).toHaveURL(/rangeMode=outside/);
    const outsideBanner = page.getByRole("status").filter({
      hasText: "Showing records with When outside",
    });
    await expect(outsideBanner).toBeVisible();
    const outsideNames = page.getByRole("textbox", { name: "Record name" });
    await expect(outsideNames).toHaveCount(2);
    await page.getByRole("link", { name: "Back to Chart", exact: true }).click();
    await expect(chart).toBeVisible();

    const now = new Date();
    const monthKey = (date: Date) =>
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const thisMonthFrom = monthKey(new Date(now.getFullYear(), now.getMonth(), 1));
    const thisMonthTo = monthKey(new Date(now.getFullYear(), now.getMonth() + 1, 0));

    const monthRange = page.waitForResponse((response) =>
      response.url().endsWith(`/api/databases/${database.id}/views/${chartView.id}`)
      && response.request().method() === "PATCH",
    );
    await chart.getByRole("button", { name: "This month" }).click();
    assert.equal((await monthRange).status(), 200);
    await expect(chart.getByLabel("Chart range start")).toHaveValue(thisMonthFrom);
    await expect(chart.getByLabel("Chart range end")).toHaveValue(thisMonthTo);
    const shortMonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthDays = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const expectedRecords = now.getFullYear() === 2026 && now.getMonth() === 10 ? 2 : 0;
    await expect(
      chart.getByText(
        `This month · ${shortMonths[now.getMonth()]} 1–${monthDays}, ${now.getFullYear()} · ${expectedRecords} records`,
      ),
    ).toBeVisible();

    const chartDetail = await json<{
      views: {
        id: string;
        config: {
          chartDatePropertyId?: string;
          chartDateRange?: number;
          chartDateOffset?: number;
          chartDateStart?: string | null;
          chartDateEnd?: string | null;
          chartDatePreset?: string | null;
        };
      }[];
    }>(await request.get(`/api/databases/${database.id}`));
    const savedChartConfig = chartDetail.views.find((view) => view.id === chartView.id)?.config;
    assert.equal(
      savedChartConfig?.chartDatePropertyId,
      when.id,
      "the chosen date axis is saved on the view",
    );
    assert.equal(savedChartConfig?.chartDateRange, 7, "the chosen window is saved on the view");
    assert.equal(
      savedChartConfig?.chartDateOffset,
      -7,
      "stepping back is saved on the view",
    );
    assert.equal(
      savedChartConfig?.chartDatePreset,
      "this-month",
      "the month shortcut is saved as a calendar-following preset",
    );
    assert.equal(savedChartConfig?.chartDateStart, null);
    assert.equal(savedChartConfig?.chartDateEnd, null);

    // The record count opens the database filtered to the same dates, without
    // overwriting the view's own range. October is deterministic across runs.
    const octoberStart = page.waitForResponse((response) =>
      response.url().endsWith(`/api/databases/${database.id}/views/${chartView.id}`)
      && response.request().method() === "PATCH",
    );
    await chart.getByLabel("Chart range start").fill("2026-10-01");
    assert.equal((await octoberStart).status(), 200);
    const octoberEnd = page.waitForResponse((response) =>
      response.url().endsWith(`/api/databases/${database.id}/views/${chartView.id}`)
      && response.request().method() === "PATCH",
    );
    await chart.getByLabel("Chart range end").fill("2026-10-31");
    assert.equal((await octoberEnd).status(), 200);
    await chart.getByRole("link", { name: "0 records" }).click();
    await expect(page).toHaveURL(new RegExp(`rangeProperty=${when.id}`));
    const rangeBanner = page.getByRole("status").filter({ hasText: "Showing records with When in" });
    await expect(rangeBanner).toBeVisible();
    const recordNames = page.getByRole("textbox", { name: "Record name" });
    await expect(recordNames).toHaveCount(0);
    await page.getByRole("button", { name: "Clear date filter" }).click();
    await expect(rangeBanner).toHaveCount(0);
    await expect(page).not.toHaveURL(/rangeProperty=/);
    await expect(recordNames).toHaveCount(3);

    // The chart's own summary clears the date window in one click.
    await page.getByRole("link", { name: "Back to Chart", exact: true }).click();
    await expect(chart).toBeVisible();
    const clearedWindow = page.waitForResponse((response) =>
      response.url().endsWith(`/api/databases/${database.id}/views/${chartView.id}`)
      && response.request().method() === "PATCH",
    );
    await chart.getByRole("button", { name: "Clear date window" }).click();
    assert.equal((await clearedWindow).status(), 200);
    await expect(chart.getByLabel("Chart date property")).toHaveValue("");
    await expect(chart.getByLabel("Chart date window")).toHaveCount(0);
    await expect(chart.getByLabel("Chart range start")).toHaveCount(0);
    await expect(chart.getByText("2 points").first()).toBeVisible();

    const clearedDetail = await json<{
      views: { id: string; config: { chartDatePropertyId?: string; chartDatePreset?: string | null } }[];
    }>(await request.get(`/api/databases/${database.id}`));
    const clearedConfig = clearedDetail.views.find((view) => view.id === chartView.id)?.config;
    assert.equal(clearedConfig?.chartDatePropertyId, "", "the date axis is removed from the view");
    assert.equal(clearedConfig?.chartDatePreset, null, "the preset is removed from the view");
  } finally {
    await request.delete(`/api/databases/${database.id}`);
  }
});

test("bars and pie slices open the database filtered to their records", async ({ page, request }) => {
  const token = `slices-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const database = await post<{ id: string }>(request, "/api/databases", {
    name: `${token} database`,
  });

  try {
    const status = await post<{ id: string }>(
      request,
      `/api/databases/${database.id}/properties`,
      { name: "Status", type: "select", options: { choices: ["Todo", "Done"] } },
    );
    const score = await post<{ id: string }>(
      request,
      `/api/databases/${database.id}/properties`,
      { name: "Score", type: "number" },
    );
    for (const [title, value, choice] of [
      ["Alpha", 2, "Todo"],
      ["Beta", 3, "Todo"],
      ["Gamma", 1, "Done"],
    ] as const) {
      const record = await post<{ id: string }>(
        request,
        `/api/databases/${database.id}/records`,
        { title: `${token} ${title}` },
      );
      await json(
        await request.patch(`/api/databases/${database.id}/records/${record.id}`, {
          data: { values: { [score.id]: value, [status.id]: choice } },
        }),
      );
    }
    const chart = await post<{ id: string }>(request, `/api/databases/${database.id}/views`, {
      name: "Grouped chart",
      type: "chart",
      config: { chartPropertyId: score.id, chartGroupPropertyId: status.id },
    });

    await page.goto(`/databases/${database.id}?view=${chart.id}`);
    const chartRegion = page.getByRole("region", { name: "Score chart" });
    await chartRegion.getByRole("link", { name: "Open database filtered to Todo" }).click();
    await expect(page).toHaveURL(new RegExp(`filterProperty=${status.id}`));
    await expect(page).toHaveURL(new RegExp(`from=${chart.id}`));
    await expect(page.getByRole("status")).toContainText("Showing records with Status is Todo.");
    const recordNames = page.getByRole("textbox", { name: "Record name" });
    await expect(recordNames).toHaveCount(2);
    await page.getByRole("button", { name: "Clear filter" }).click();
    await expect(recordNames).toHaveCount(3);
    await expect(page.getByRole("link", { name: "Back to Grouped chart" })).toBeVisible();
    await page.getByRole("link", { name: "Back to Grouped chart" }).click();
    await expect(page.getByRole("region", { name: "Score chart" })).toBeVisible();

    await page.getByLabel("Chart type").selectOption("pie");
    const pieRegion = page.getByRole("region", { name: "Score chart" });
    await pieRegion.getByRole("link", { name: "Open database filtered to Done" }).click();
    await expect(page).toHaveURL(new RegExp(`filterValue=Done`));
    await expect(recordNames).toHaveCount(1);
    await page.getByRole("link", { name: "Back to Grouped chart" }).click();
    await expect(page.getByRole("region", { name: "Score chart" })).toBeVisible();
  } finally {
    await request.delete(`/api/databases/${database.id}`);
  }
});

test("shows a linked page cover inside an embedded gallery", async ({ page, request }) => {
  const token = `embed-cover-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const database = await post<{ id: string }>(request, "/api/databases", {
    name: `${token} database`,
  });
  let fixtureId = "";

  try {
    const record = await post<{ id: string; pageId: string }>(
      request,
      `/api/databases/${database.id}/records`,
      { title: `${token} record` },
    );
    const gallery = await post<{ id: string }>(request, `/api/databases/${database.id}/views`, {
      name: "Gallery",
      type: "gallery",
      config: {},
    });
    const attachment = await json<{ url: string }>(await request.post("/api/attachments", {
      multipart: {
        purpose: "image",
        file: {
          name: `${token}.png`,
          mimeType: "image/png",
          // A 1x1 PNG, so the embed's image request succeeds same-origin.
          buffer: Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=",
            "base64",
          ),
        },
      },
    }));
    assert.equal((await request.patch(`/api/pages/${record.pageId}`, {
      data: { coverImageUrl: attachment.url },
    })).status(), 200);

    const fixture = await post<{ id: string }>(request, "/api/pages", { title: `${token} page` });
    fixtureId = fixture.id;
    await json(
      await request.patch(`/api/pages/${fixture.id}`, {
        data: {
          contentJson: {
            type: "doc",
            content: [{
              type: "databaseEmbed",
              attrs: { databaseId: database.id, viewId: gallery.id },
            }],
          },
        },
      }),
    );

    await page.goto(`/pages/${fixture.id}`);

    // The embed has no file properties, so the image can only be the linked
    // record page's cover showing through the fallback.
    const cover = page.getByRole("img", { name: `${token} record` });
    await expect(cover).toBeVisible();
    await expect(cover).toHaveAttribute("src", attachment.url);
    await expect(
      page.getByRole("button", { name: `Remove cover for ${token} record` }),
    ).toHaveCount(0);
  } finally {
    if (fixtureId) {
      await request.delete(`/api/pages/${fixtureId}`);
      await request.delete(`/api/trash/${fixtureId}`);
    }
    const loaded = await request.get(`/api/databases/${database.id}`);
    if (loaded.ok()) {
      const data = await json<{ records: { pageId: string | null }[] }>(loaded);
      for (const row of data.records) {
        if (!row.pageId) continue;
        await request.delete(`/api/pages/${row.pageId}`);
        await request.delete(`/api/trash/${row.pageId}`);
      }
    }
    await request.delete(`/api/databases/${database.id}`);
    await request.delete("/api/attachments/orphans");
  }
});

test("renders list, timeline, and chart views inside database embeds", async ({ page, request }) => {
  const token = `embed-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const database = await post<{ id: string }>(request, "/api/databases", {
    name: `${token} database`,
  });
  let fixtureId = "";

  try {
    const when = await post<{ id: string }>(
      request,
      `/api/databases/${database.id}/properties`,
      { name: "When", type: "date" },
    );
    const score = await post<{ id: string }>(
      request,
      `/api/databases/${database.id}/properties`,
      { name: "Score", type: "number" },
    );

    const alpha = `${token} Alpha`;
    const alphaRecord = await post<{ id: string }>(
      request,
      `/api/databases/${database.id}/records`,
      { title: alpha },
    );
    await json(
      await request.patch(`/api/databases/${database.id}/records/${alphaRecord.id}`, {
        data: { values: { [when.id]: "2026-11-20", [score.id]: 7 } },
      }),
    );
    await post(request, `/api/databases/${database.id}/records`, { title: `${token} Beta` });

    const listView = await post<{ id: string }>(request, `/api/databases/${database.id}/views`, {
      name: "List",
      type: "list",
      config: {},
    });
    const timelineView = await post<{ id: string }>(request, `/api/databases/${database.id}/views`, {
      name: "Timeline",
      type: "timeline",
      config: { datePropertyId: when.id, timelineRange: 30 },
    });
    const chartView = await post<{ id: string }>(request, `/api/databases/${database.id}/views`, {
      name: "Chart",
      type: "chart",
      config: { chartPropertyId: score.id },
    });

    const fixture = await post<{ id: string }>(request, "/api/pages", { title: `${token} page` });
    fixtureId = fixture.id;
    await json(
      await request.patch(`/api/pages/${fixture.id}`, {
        data: {
          contentJson: {
            type: "doc",
            content: [listView, timelineView, chartView].map((view) => ({
              type: "databaseEmbed",
              attrs: { databaseId: database.id, viewId: view.id },
            })),
          },
        },
      }),
    );

    await page.goto(`/pages/${fixture.id}`);

    const list = page.getByRole("region", { name: "List view" });
    await expect(list).toBeVisible();
    await expect(list.getByRole("heading", { name: alpha })).toBeVisible();
    await expect(list.getByText("7", { exact: true })).toBeVisible();

    const timeline = page.getByRole("region", { name: "When timeline" });
    await expect(timeline).toBeVisible();
    await expect(timeline.getByRole("link", { name: alpha })).toBeVisible();

    const chart = page.getByRole("region", { name: "Score chart" });
    await expect(chart).toBeVisible();
    await expect(chart.getByRole("link", { name: alpha, exact: true })).toBeVisible();
    await expect(chart.getByText("7", { exact: true })).toBeVisible();
    await expect(chart.getByText("1 record has no Score value.")).toBeVisible();
  } finally {
    if (fixtureId) {
      await request.delete(`/api/pages/${fixtureId}`);
      await request.delete(`/api/trash/${fixtureId}`);
    }
    await request.delete(`/api/databases/${database.id}`);
  }
});
