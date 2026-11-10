import assert from "node:assert/strict";
import { expect, test, type APIRequestContext, type APIResponse } from "@playwright/test";

function taskDocument(tasks: { text: string; checked: boolean }[]) {
  return {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Milestones" }] },
      {
        type: "taskList",
        content: tasks.map((task) => ({
          type: "taskItem",
          attrs: { checked: task.checked },
          content: [{ type: "paragraph", content: [{ type: "text", text: task.text }] }],
        })),
      },
    ],
  };
}

async function created<T>(response: APIResponse): Promise<T> {
  const text = await response.text();
  assert.equal(response.status(), 201, `${response.url()} returned ${response.status()}: ${text}`);
  return JSON.parse(text) as T;
}

async function purge(request: APIRequestContext, pageId: string) {
  const trashed = await request.delete(`/api/pages/${pageId}`);
  if (trashed.ok()) await request.delete(`/api/trash/${pageId}`);
}

test("gathers a project's tasks and references, and completes one in place", async ({
  page,
  request,
}) => {
  const token = `focus-${Date.now()}`;
  const projectTitle = `${token} launch`;
  const referenceTitle = `${token} brief`;

  const project = await created<{ id: string }>(
    await request.post("/api/pages", {
      data: {
        title: projectTitle,
        contentJson: taskDocument([
          { text: "Draft plan", checked: false },
          { text: "Share plan", checked: true },
        ]),
      },
    }),
  );
  const reference = await created<{ id: string }>(
    await request.post("/api/pages", {
      data: { title: referenceTitle, contentJson: { type: "doc", content: [] } },
    }),
  );
  await request.post(`/api/pages/${project.id}/links`, {
    data: { targetPageId: reference.id },
  });

  try {
    await page.goto(`/focus?page=${project.id}`);

    await expect(page.getByRole("heading", { name: projectTitle })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "Complete Draft plan" })).not.toBeChecked();
    await expect(page.getByRole("checkbox", { name: "Complete Share plan" })).toBeChecked();
    await expect(page.getByText("1 of 2 tasks done")).toBeVisible();

    const resources = page.getByRole("region", { name: "Related resources" });
    await expect(resources.getByRole("link", { name: referenceTitle })).toBeVisible();

    await expect(page.getByRole("link", { name: "Open project" })).toHaveAttribute(
      "href",
      `/pages/${project.id}`,
    );

    await page.getByRole("checkbox", { name: "Complete Draft plan" }).check();
    await expect(page.getByText("2 of 2 tasks done")).toBeVisible();

    // The check-off is stored on the project page, not just in this view.
    await page.reload();
    await expect(page.getByRole("checkbox", { name: "Complete Draft plan" })).toBeChecked();
    await expect(page.getByText("2 of 2 tasks done")).toBeVisible();
  } finally {
    await purge(request, project.id);
    await purge(request, reference.id);
  }
});

test("pins a project and switches back to it from the quick-switch row", async ({
  page,
  request,
}) => {
  const token = `focus-pins-${Date.now()}`;
  const firstTitle = `${token} alpha`;
  const secondTitle = `${token} beta`;

  const first = await created<{ id: string }>(
    await request.post("/api/pages", {
      data: {
        title: firstTitle,
        contentJson: taskDocument([{ text: "First task", checked: false }]),
      },
    }),
  );
  const second = await created<{ id: string }>(
    await request.post("/api/pages", {
      data: {
        title: secondTitle,
        contentJson: taskDocument([{ text: "Second task", checked: false }]),
      },
    }),
  );

  try {
    await page.goto(`/focus?page=${first.id}`);
    await expect(page.getByRole("heading", { name: firstTitle })).toBeVisible();

    await page.getByRole("button", { name: "Pin project" }).click();
    await expect(page.getByRole("button", { name: "Pinned" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    const quickSwitch = page.getByRole("group", { name: "Pinned and recent projects" });
    await expect(quickSwitch.getByRole("button", { name: firstTitle })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // The pin is the page's favorite flag, so it survives a reload.
    await page.reload();
    await expect(quickSwitch.getByRole("button", { name: firstTitle })).toBeVisible();

    // A recently focused project joins the row without being favorited.
    await page.getByLabel(/^Project/).selectOption(second.id);
    await expect(page.getByRole("heading", { name: secondTitle })).toBeVisible();
    await expect(quickSwitch.getByRole("button", { name: secondTitle })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // One click returns to the pinned project.
    await quickSwitch.getByRole("button", { name: firstTitle }).click();
    await expect(page.getByRole("heading", { name: firstTitle })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`page=${first.id}`));
  } finally {
    await purge(request, first.id);
    await purge(request, second.id);
  }
});

test("records a task checked off inside the page editor", async ({ page, request }) => {
  const token = `focus-editor-${Date.now()}`;
  const title = `${token} plan`;

  const project = await created<{ id: string }>(
    await request.post("/api/pages", {
      data: {
        title,
        contentJson: taskDocument([{ text: "Editor checked task", checked: false }]),
      },
    }),
  );
  const pinned = await request.patch(`/api/pages/${project.id}`, {
    data: { isFavorite: true },
  });
  assert.ok(pinned.ok(), "the project is pinned");

  try {
    await page.goto(`/pages/${project.id}`);

    const completion = page.waitForResponse(
      (response) =>
        response.url().includes("/task-completions") &&
        response.request().method() === "POST",
    );
    await page.getByRole("checkbox", { name: "Mark task complete" }).check();
    assert.ok((await completion).ok(), "the check-off is recorded");

    await page.goto("/");
    const section = page.getByRole("region", { name: "Pinned projects" });
    await expect(section.getByText("1 of 1 tasks done")).toBeVisible();
    await expect(section.getByText("Recently finished")).toBeVisible();
    await expect(section.getByText("Editor checked task")).toBeVisible();
  } finally {
    await purge(request, project.id);
  }
});

test("shows a pinned project's remaining work on the home page", async ({ page, request }) => {
  const token = `focus-home-${Date.now()}`;
  const title = `${token} release`;

  const project = await created<{ id: string }>(
    await request.post("/api/pages", {
      data: {
        title,
        contentJson: taskDocument([
          { text: "Write release notes", checked: true },
          { text: "Announce the release", checked: false },
        ]),
      },
    }),
  );
  const pinned = await request.patch(`/api/pages/${project.id}`, {
    data: { isFavorite: true },
  });
  assert.ok(pinned.ok(), "the project is pinned");

  try {
    await page.goto("/");

    const section = page.getByRole("region", { name: "Pinned projects" });
    await expect(section.getByText("1 of 2 tasks done")).toBeVisible();
    await expect(section.getByText("1 open")).toBeVisible();

    // The card checks its next open task off without leaving the home page.
    await section.getByRole("checkbox", { name: "Complete Announce the release" }).click();
    await expect(section.getByText("2 of 2 tasks done")).toBeVisible();
    await expect(section.getByText("All tasks done")).toBeVisible();
    await expect(section.getByText("Recently finished")).toBeVisible();
    await expect(section.getByText("Announce the release")).toBeVisible();

    // The check-off and its history entry are stored, so both survive a reload.
    await page.reload();
    await expect(section.getByText("2 of 2 tasks done")).toBeVisible();
    await expect(section.getByText("All tasks done")).toBeVisible();
    await expect(section.getByText("Recently finished")).toBeVisible();
    await expect(section.getByText("Announce the release")).toBeVisible();

    await section.getByRole("link", { name: title }).click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/focus\\?page=${project.id}`));
  } finally {
    await purge(request, project.id);
  }
});
