import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeLinkHref } from "../src/lib/link";

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
