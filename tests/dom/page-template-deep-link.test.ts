import "../setup-dom";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { getTemplateIdFromHash, revealTemplateFromHash } from "../../src/lib/page-template-deep-link";

afterEach(() => {
  document.body.innerHTML = "";
});

test("template deep links parse only template hashes", () => {
  assert.equal(getTemplateIdFromHash("#template-abc"), "abc");
  assert.equal(getTemplateIdFromHash("#other"), null);
  assert.equal(getTemplateIdFromHash("#template-"), null);
});

test("template deep links open the templates panel and scroll the row into view", () => {
  document.body.innerHTML = `<details><div id="template-abc"></div></details>`;
  const panel = document.querySelector<HTMLDetailsElement>("details");
  const row = document.getElementById("template-abc");
  assert.ok(panel);
  assert.ok(row);
  assert.equal(panel.open, false);

  let scrollOptions: ScrollIntoViewOptions | undefined;
  row.scrollIntoView = (options?: boolean | ScrollIntoViewOptions) => {
    scrollOptions = typeof options === "object" ? options : undefined;
  };

  const revealed = revealTemplateFromHash(
    "#template-abc",
    (templateId) => document.getElementById(`template-${templateId}`),
    panel,
  );

  assert.equal(revealed, row);
  assert.equal(panel.open, true);
  assert.deepEqual(scrollOptions, { block: "center" });
});

test("template deep links do not open or scroll when the row is missing", () => {
  document.body.innerHTML = `<details><div id="template-abc"></div></details>`;
  const panel = document.querySelector<HTMLDetailsElement>("details");
  const row = document.getElementById("template-abc");
  assert.ok(panel);
  assert.ok(row);

  let scrolled = false;
  row.scrollIntoView = () => {
    scrolled = true;
  };

  const revealed = revealTemplateFromHash(
    "#template-missing",
    (templateId) => document.getElementById(`template-${templateId}`),
    panel,
  );

  assert.equal(revealed, null);
  assert.equal(panel.open, false);
  assert.equal(scrolled, false);
});
