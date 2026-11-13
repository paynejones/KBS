import assert from "node:assert/strict";
import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type Locator,
  type Page,
} from "@playwright/test";

type PageRow = { id: string; title: string };

async function json<T>(response: APIResponse): Promise<T> {
  const text = await response.text();
  assert.ok(response.ok(), `${response.url()} returned ${response.status()}: ${text}`);
  return JSON.parse(text) as T;
}

async function createPage(request: APIRequestContext, title: string): Promise<PageRow> {
  return await json<PageRow>(await request.post("/api/pages", { data: { title } }));
}

async function purgePage(request: APIRequestContext, id: string) {
  const trashed = await request.delete(`/api/pages/${id}`);
  if (trashed.ok()) await request.delete(`/api/trash/${id}`);
}

test("shows a 4px focus stroke on a graph node reached by keyboard", async ({ page, request }) => {
  const token = `graph-focus-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const source = await createPage(request, `${token} source`);
  const target = await createPage(request, `${token} target`);

  try {
    await json<{ id: string }>(
      await request.post(`/api/pages/${source.id}/links`, {
        data: { targetPageId: target.id },
      }),
    );

    await page.goto("/graph");
    const nodes = page.locator('svg g[role="link"]');
    const firstNode = nodes.first();
    const circle = firstNode.locator("circle");

    await expect(firstNode).toBeVisible();
    await expect(circle).toHaveCSS("stroke-width", "2px");

    // Reset is the last control before the graph, so one Tab reaches the first node.
    await page.getByRole("button", { name: "Reset" }).focus();
    await page.keyboard.press("Tab");

    await expect(firstNode).toBeFocused();
    assert.equal(
      await firstNode.evaluate((element) => element.matches(":focus-visible")),
      true,
      "the graph node should be focus-visible after keyboard navigation",
    );
    await expect(circle).toHaveCSS("stroke-width", "4px");
    await expect(firstNode).toHaveCSS("outline-style", "none");

    // Moving focus away restores the unfocused stroke.
    await page.keyboard.press("Tab");
    await expect(firstNode).not.toBeFocused();
    await expect(circle).toHaveCSS("stroke-width", "2px");
  } finally {
    await purgePage(request, source.id);
    await purgePage(request, target.id);
  }
});

test("activates a focused graph node with Enter and Space", async ({ page, request }) => {
  const token = `graph-keys-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const source = await createPage(request, `${token} source`);
  const target = await createPage(request, `${token} target`);

  try {
    await json<{ id: string }>(
      await request.post(`/api/pages/${source.id}/links`, {
        data: { targetPageId: target.id },
      }),
    );

    await page.goto("/graph");
    const sourceNode = page.getByRole("link", { name: `Open page ${source.title}` });
    await expect(sourceNode).toBeVisible();
    await sourceNode.focus();
    await expect(sourceNode).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/pages/${source.id}$`));

    await page.goto("/graph");
    const targetNode = page.getByRole("link", { name: `Open page ${target.title}` });
    await expect(targetNode).toBeVisible();
    await targetNode.focus();
    await expect(targetNode).toBeFocused();
    await page.keyboard.press("Space");
    await expect(page).toHaveURL(new RegExp(`/pages/${target.id}$`));
  } finally {
    await purgePage(request, source.id);
    await purgePage(request, target.id);
  }
});

test("opens a graph node on click but not after a drag", async ({ page, request }) => {
  const token = `graph-drag-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const source = await createPage(request, `${token} source`);
  const target = await createPage(request, `${token} target`);

  try {
    await json<{ id: string }>(
      await request.post(`/api/pages/${source.id}/links`, {
        data: { targetPageId: target.id },
      }),
    );

    await page.goto("/graph");
    const sourceNode = page.getByRole("link", { name: `Open page ${source.title}` });
    const sourceCircle = sourceNode.locator("circle");
    await expect(sourceNode).toBeVisible();

    // A plain click should follow the node's link.
    await sourceCircle.click();
    await expect(page).toHaveURL(new RegExp(`/pages/${source.id}$`));

    // A drag should move the node without following it.
    await page.goto("/graph");
    const node = page.getByRole("link", { name: `Open page ${source.title}` });
    const circle = node.locator("circle");
    await expect(node).toBeVisible();

    const before = await circle.boundingBox();
    assert.ok(before, "the graph node should be measurable");
    const startX = before.x + before.width / 2;
    const startY = before.y + before.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.waitForTimeout(100);
    await page.mouse.move(startX + 50, startY + 35, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    const after = await circle.boundingBox();
    assert.ok(after, "the dragged node should still be measurable");
    assert.notDeepEqual(after, before, "dragging should move the node");
    await expect(page).toHaveURL(/\/graph$/);
  } finally {
    await purgePage(request, source.id);
    await purgePage(request, target.id);
  }
});

test("releases a graph drag that ends outside the graph", async ({ page, request }) => {
  const token = `graph-outside-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const source = await createPage(request, `${token} source`);
  const target = await createPage(request, `${token} target`);

  try {
    await json<{ id: string }>(
      await request.post(`/api/pages/${source.id}/links`, {
        data: { targetPageId: target.id },
      }),
    );

    await page.goto("/graph");
    const node = page.getByRole("link", { name: `Open page ${source.title}` });
    const circle = node.locator("circle");
    const graph = page.locator('svg[role="application"]');
    await expect(node).toBeVisible();

    const graphBox = await graph.boundingBox();
    const before = await circle.boundingBox();
    assert.ok(graphBox, "the graph should be measurable");
    assert.ok(before, "the graph node should be measurable");

    await page.evaluate(() => {
      const state = window as typeof window & { __graphPointerId?: number };
      document.addEventListener(
        "pointerdown",
        (event) => {
          state.__graphPointerId = event.pointerId;
        },
        { capture: true, once: true },
      );
    });

    const startX = before.x + before.width / 2;
    const startY = before.y + before.height / 2;
    const outsideX = Math.max(10, graphBox.x - 100);
    const outsideY = graphBox.y + graphBox.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.waitForTimeout(100);
    await page.mouse.move(outsideX, outsideY, { steps: 10 });

    const during = await circle.boundingBox();
    assert.ok(during, "the dragged node should be measurable");
    assert.notDeepEqual(during, before, "the node should follow the pointer outside the graph");

    await page.mouse.up();
    await page.waitForTimeout(150);
    await expect(page).toHaveURL(/\/graph$/);

    const capture = await node.evaluate((element) => {
      const state = window as typeof window & { __graphPointerId?: number };
      return {
        pointerId: state.__graphPointerId,
        held:
          state.__graphPointerId !== undefined &&
          element.hasPointerCapture(state.__graphPointerId),
      };
    });
    assert.equal(
      capture.held,
      false,
      `pointer ${capture.pointerId} should be released after the drag`,
    );

    const settled = await circle.boundingBox();
    assert.ok(settled, "the settled node should be measurable");
    await page.mouse.move(outsideX + 80, outsideY + 80);
    await page.waitForTimeout(150);
    const afterMove = await circle.boundingBox();
    assert.ok(afterMove, "the node should remain measurable");
    assert.ok(
      Math.abs(afterMove.x - settled.x) < 0.5 && Math.abs(afterMove.y - settled.y) < 0.5,
      "the node should not keep following the pointer after release",
    );

    // A fresh pointer-down must reset the drag state so the next click follows the link.
    await circle.click();
    await expect(page).toHaveURL(new RegExp(`/pages/${source.id}$`));
  } finally {
    await purgePage(request, source.id);
    await purgePage(request, target.id);
  }
});

test("filters the graph by tag and page group and draws shared-tag edges", async ({ page, request }) => {
  const token = `graph-tags-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const parent = await createPage(request, `${token} parent`);
  const child = await json<PageRow>(
    await request.post("/api/pages", { data: { title: `${token} child`, parentId: parent.id } }),
  );
  const unrelated = await createPage(request, `${token} unrelated`);
  const tag = await json<{ id: string }>(
    await request.post("/api/tags", { data: { name: token } }),
  );

  try {
    for (const pageId of [child.id, unrelated.id]) {
      await json(
        await request.post(`/api/pages/${pageId}/tags`, { data: { tagId: tag.id } }),
      );
    }

    await page.goto("/graph");
    const nodeFor = (title: string) => page.getByRole("link", { name: `Open page ${title}` });
    await expect(nodeFor(child.title)).toBeVisible();

    // A tag filter keeps the tagged pages and hides the untagged parent.
    await page.getByLabel("Filter graph by tag").selectOption(tag.id);
    await expect(nodeFor(child.title)).toBeVisible();
    await expect(nodeFor(unrelated.title)).toBeVisible();
    await expect(nodeFor(parent.title)).toBeHidden();

    // A page group keeps the chosen page with everything beneath it.
    await page.getByLabel("Filter graph by tag").selectOption("");
    await expect(nodeFor(parent.title)).toBeVisible();
    await page.getByLabel("Limit graph to a page group").selectOption(parent.id);
    await expect(nodeFor(child.title)).toBeVisible();
    await expect(nodeFor(unrelated.title)).toBeHidden();

    // Shared tags add their own dotted relation between tagged pages.
    await page.getByLabel("Limit graph to a page group").selectOption("");
    await page.getByLabel("Shared tags").check();
    await expect(
      page.locator('svg[role="application"] path.graph-edge[stroke-dasharray="2 4"]'),
    ).not.toHaveCount(0);
  } finally {
    await purgePage(request, child.id);
    await purgePage(request, parent.id);
    await purgePage(request, unrelated.id);
  }
});

test("replaces the canvas with a filterable page list on small screens", async ({ page, request }) => {
  const token = `graph-mobile-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const source = await createPage(request, `${token} source`);
  const target = await createPage(request, `${token} target`);

  try {
    await json<{ id: string }>(
      await request.post(`/api/pages/${source.id}/links`, {
        data: { targetPageId: target.id },
      }),
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/graph");

    const list = page.getByRole("navigation", { name: "Graph pages list" });
    await expect(list).toBeVisible();
    await expect(list.getByRole("link", { name: source.title })).toBeVisible();
    await expect(list.getByRole("link", { name: target.title })).toBeVisible();
    await expect(page.locator('svg[role="application"]')).toBeHidden();

    const edges = page.locator("svg[role=\"application\"] path.graph-edge");
    await expect(edges).toHaveCount(1);
    await page.getByLabel("Page links").uncheck();
    await page.getByLabel("Parent / child").uncheck();
    await expect(edges).toHaveCount(0);
  } finally {
    await purgePage(request, source.id);
    await purgePage(request, target.id);
  }
});

/** Moves the real pointer onto the middle of an edge's drawn curve. */
async function hoverEdge(page: Page, edge: Locator) {
  const point = await edge.evaluate((element) => {
    const path = element as SVGPathElement;
    const local = path.getPointAtLength(path.getTotalLength() * 0.35);
    const matrix = path.getScreenCTM();
    if (!matrix) throw new Error("graph edge has no screen matrix");
    const screen = local.matrixTransform(matrix);
    return { x: screen.x, y: screen.y };
  });
  await page.mouse.move(point.x, point.y);
}

test("shows relation details when hovering a graph edge", async ({ page, request }) => {
  test.slow();
  // Tooltips clamp page names to 22 characters, so short unique titles keep
  // the expected text readable in the assertion.
  const stamp = Date.now().toString(36);
  const source = await createPage(request, `hover-${stamp} A`);
  const target = await createPage(request, `hover-${stamp} B`);
  const taggedSource = await createPage(request, `tag-${stamp} A`);
  const taggedTarget = await createPage(request, `tag-${stamp} B`);
  const tag = await json<{ id: string }>(
    await request.post("/api/tags", { data: { name: `shared-${stamp}` } }),
  );

  try {
    await json(
      await request.post(`/api/pages/${source.id}/links`, {
        data: { targetPageId: target.id },
      }),
    );
    for (const pageId of [taggedSource.id, taggedTarget.id]) {
      await json(await request.post(`/api/pages/${pageId}/tags`, { data: { tagId: tag.id } }));
    }

    await page.goto("/graph");
    const graph = page.locator('svg[role="application"]');
    await expect(graph).toBeVisible();

    // Link edges are the only undashed lines.
    await hoverEdge(page, page.locator("path.graph-edge:not([stroke-dasharray])").first());
    const linkTooltip = graph
      .locator("text")
      .filter({ hasText: `Page link · ${source.title} → ${target.title}` });
    await expect(linkTooltip).toBeVisible();

    // Leaving the line removes the tooltip.
    const graphBox = await graph.boundingBox();
    assert.ok(graphBox, "the graph should be measurable");
    await page.mouse.move(graphBox.x + 4, graphBox.y + 4);
    await expect(linkTooltip).toHaveCount(0);

    await page.getByLabel("Shared tags").check();
    const tagEdge = page.locator('path.graph-edge[stroke-dasharray="2 4"]').first();
    await expect(tagEdge).toBeVisible();
    await hoverEdge(page, tagEdge);
    const tagTooltip = graph
      .locator("text")
      .filter({ hasText: `Shared tag “shared-${stamp}” · ${taggedSource.title} ↔ ${taggedTarget.title}` });
    await expect(tagTooltip).toBeVisible();
  } finally {
    await purgePage(request, source.id);
    await purgePage(request, target.id);
    await purgePage(request, taggedSource.id);
    await purgePage(request, taggedTarget.id);
  }
});

test("keeps zoomed-in labels clear of nodes and each other", async ({ page, request }) => {
  // Seeds eight pages and their links, so allow the suite's slow-test budget.
  test.slow();
  const token = `graph-labels-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const pages: PageRow[] = [];

  try {
    for (let index = 0; index < 8; index += 1) {
      pages.push(
        await createPage(request, `${token} ${index} label collision page`),
      );
    }
    for (let index = 0; index < pages.length - 1; index += 1) {
      await json(
        await request.post(`/api/pages/${pages[index].id}/links`, {
          data: { targetPageId: pages[index + 1].id },
        }),
      );
    }

    await page.goto("/graph");
    const graph = page.locator('svg[role="application"]');
    await expect(graph).toBeVisible();

    // At rest titles are hover-only; zooming past 130% reveals them.
    await expect(graph.locator("text")).toHaveCount(0);
    for (let click = 0; click < 3; click += 1) {
      await page.getByRole("button", { name: "Zoom in" }).click();
    }
    await expect(graph.locator("text").first()).toBeVisible();

    // Pinning a hovered page guarantees its label even in a tight cluster.
    const pinned = page.getByRole("link", { name: `Open page ${pages[0].title}` });
    const circleBox = await pinned.locator("circle").boundingBox();
    assert.ok(circleBox, "the graph node should be measurable");
    await page.mouse.move(circleBox.x + circleBox.width / 2, circleBox.y + circleBox.height / 2);
    await expect(graph.locator("text").first()).toBeVisible();

    const result = await page.evaluate(() => {
      const svg = document.querySelector('svg[role="application"]');
      if (!svg) throw new Error("graph missing");

      const labels = [...svg.querySelectorAll("text")].map((element) => ({
        text: element.textContent ?? "",
        box: (element as SVGGraphicsElement).getBBox(),
      }));
      const nodes = [...svg.querySelectorAll('g[role="link"] circle')].map((element) =>
        (element as SVGGraphicsElement).getBBox(),
      );
      const overlaps = (first: { x: number; y: number; width: number; height: number }, second: { x: number; y: number; width: number; height: number }) => {
        const width = Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x);
        const height = Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y);
        return width > 3 && height > 3;
      };

      const labelNodeOverlaps = labels
        .filter((label) => nodes.some((node) => overlaps(label.box, node)))
        .map((label) => label.text);
      const labelLabelOverlaps = labels.flatMap((label, index) =>
        labels
          .slice(index + 1)
          .filter((other) => overlaps(label.box, other.box))
          .map((other) => [label.text, other.text] as const),
      );

      return { labels: labels.length, labelNodeOverlaps, labelLabelOverlaps };
    });

    assert.ok(result.labels > 1, "zooming in should reveal several labels");
    assert.deepEqual(result.labelNodeOverlaps, [], "labels must not cover nodes");
    assert.deepEqual(result.labelLabelOverlaps, [], "labels must not stack on each other");
  } finally {
    for (const pageRow of pages) await purgePage(request, pageRow.id);
  }
});
