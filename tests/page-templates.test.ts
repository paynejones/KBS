import assert from "node:assert/strict";
import { test } from "node:test";
import { documentText, starterPageTemplates } from "../src/lib/page-templates";

test("starter templates cover the recurring structures as valid documents", () => {
  const starters = starterPageTemplates();

  assert.deepEqual(starters.map((template) => template.name), ["Decision journal", "Project kickoff"]);

  for (const starter of starters) {
    assert.equal(starter.contentJson.type, "doc");
    assert.ok(Array.isArray(starter.contentJson.content));
    assert.ok(starter.icon, "starter templates keep an icon");
    assert.ok(starter.content.length > 0, "plain text is filled for page search");
    assert.equal(starter.title, starter.name);
  }
});

test("starter templates include their guidance sections", () => {
  const [decision, kickoff] = starterPageTemplates();

  assert.match(decision.content, /Options considered/);
  assert.match(decision.content, /Review date/);
  assert.match(kickoff.content, /Milestones/);
  assert.match(kickoff.content, /Risks/);
});

test("starter templates are returned as fresh copies", () => {
  const first = starterPageTemplates();
  const second = starterPageTemplates();

  assert.notEqual(first, second);
  assert.notEqual(first[0].contentJson, second[0].contentJson);
});

test("documentText flattens nested documents and ignores empty blocks", () => {
  assert.equal(
    documentText({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Hello" }] },
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "World" }] },
        { type: "paragraph" },
      ],
    }),
    "Hello World",
  );
  assert.equal(documentText(undefined), "");
  assert.equal(documentText({ type: "paragraph" }), "");
});
