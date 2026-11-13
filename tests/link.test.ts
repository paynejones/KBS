import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeLinkHref, pageIdFromEditorClick, pageIdFromLinkHref } from "../src/lib/link";
import { diffLinkedPageIds } from "../src/lib/page-link-sync";

test("normalizeLinkHref keeps absolute web addresses and trims whitespace", () => {
  assert.equal(normalizeLinkHref("https://example.com/docs?q=1"), "https://example.com/docs?q=1");
  assert.equal(normalizeLinkHref("  http://example.com  "), "http://example.com/");
  assert.equal(normalizeLinkHref("HTTPS://Example.com/Path"), "https://example.com/Path");
});

test("normalizeLinkHref adds https to a bare domain", () => {
  assert.equal(normalizeLinkHref("example.com"), "https://example.com/");
  assert.equal(normalizeLinkHref("www.example.com/posts/1"), "https://www.example.com/posts/1");
  assert.equal(normalizeLinkHref("localhost"), "https://localhost/");
});

test("normalizeLinkHref keeps site-relative paths and fragments", () => {
  assert.equal(normalizeLinkHref("/pages/2f1c"), "/pages/2f1c");
  assert.equal(normalizeLinkHref("#section-2"), "#section-2");
  assert.equal(normalizeLinkHref("  /inbox  "), "/inbox");
});

test("normalizeLinkHref accepts mailto and tel but rejects empty targets", () => {
  assert.equal(normalizeLinkHref("mailto:me@example.com"), "mailto:me@example.com");
  assert.equal(normalizeLinkHref("tel:+15550100"), "tel:+15550100");
  assert.equal(normalizeLinkHref("mailto:"), null);
});

test("normalizeLinkHref rejects unsafe schemes and protocol-relative links", () => {
  assert.equal(normalizeLinkHref("javascript:alert(1)"), null);
  assert.equal(normalizeLinkHref("data:text/html,<p>hi</p>"), null);
  assert.equal(normalizeLinkHref("vbscript:msgbox(1)"), null);
  assert.equal(normalizeLinkHref("//example.com"), null);
});

test("normalizeLinkHref rejects empty and unusable input", () => {
  assert.equal(normalizeLinkHref(""), null);
  assert.equal(normalizeLinkHref("   "), null);
  assert.equal(normalizeLinkHref("not a url"), null);
  assert.equal(normalizeLinkHref("https://"), null);
});

test("diffLinkedPageIds reports page links that came or went", () => {
  const first = "11111111-1111-4111-8111-111111111111";
  const second = "22222222-2222-4222-8222-222222222222";
  assert.deepEqual(diffLinkedPageIds([first, second], [second]), { added: [], removed: [first] });
  assert.deepEqual(diffLinkedPageIds([first], []), { added: [], removed: [first] });
  assert.deepEqual(diffLinkedPageIds(new Set<string>(), [first]), { added: [first], removed: [] });
  assert.deepEqual(diffLinkedPageIds([first, second], [first, second]), { added: [], removed: [] });
});

test("a plain click on a page link opens that page", () => {
  const id = "11111111-1111-4111-8111-111111111111";

  assert.equal(pageIdFromEditorClick({ href: `/pages/${id}`, selectionEmpty: true }), id);
  assert.equal(pageIdFromEditorClick({ href: ` /pages/${id}/ `, selectionEmpty: true }), id);
});

test("editor link clicks stay editing when selecting, modified, or not a page", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const click = { href: `/pages/${id}`, selectionEmpty: true };

  assert.equal(pageIdFromEditorClick({ ...click, selectionEmpty: false }), null);
  assert.equal(pageIdFromEditorClick({ ...click, ctrlKey: true }), null);
  assert.equal(pageIdFromEditorClick({ ...click, metaKey: true }), null);
  assert.equal(pageIdFromEditorClick({ ...click, shiftKey: true }), null);
  assert.equal(pageIdFromEditorClick({ ...click, altKey: true }), null);
  assert.equal(pageIdFromEditorClick({ ...click, button: 1 }), null);
  assert.equal(pageIdFromEditorClick({ href: "https://example.com", selectionEmpty: true }), null);
  assert.equal(pageIdFromEditorClick({ href: null, selectionEmpty: true }), null);
});

test("pageIdFromLinkHref reads only in-app page paths", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  assert.equal(pageIdFromLinkHref(`/pages/${id}`), id);
  assert.equal(pageIdFromLinkHref(`  /pages/${id}/  `), id);
  assert.equal(pageIdFromLinkHref(`/pages/${id.toUpperCase()}`), id);
  assert.equal(pageIdFromLinkHref("https://example.com/pages/11111111-1111-4111-8111-111111111111"), null);
  assert.equal(pageIdFromLinkHref("/pages/2f1c"), null);
  assert.equal(pageIdFromLinkHref("/pages/not-a-page-id"), null);
  assert.equal(pageIdFromLinkHref(""), null);
  assert.equal(pageIdFromLinkHref(null), null);
  assert.equal(pageIdFromLinkHref(undefined), null);
});
