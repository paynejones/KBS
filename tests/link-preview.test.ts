import assert from "node:assert/strict";
import test from "node:test";
import { extractLinkPreview, fetchLinkPreview, resolvePublicUrl, type PreviewFetch } from "../src/lib/link-preview";

const publicResolver = async () => [{ address: "93.184.216.34" }];
const privateResolver = async () => [{ address: "10.0.0.4" }];
const mixedResolver = async () => [{ address: "93.184.216.34" }, { address: "192.168.1.10" }];

function htmlResponse(body: string, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(body, {
    status: init.status ?? 200,
    headers: { "content-type": "text/html; charset=utf-8", ...init.headers },
  });
}

test("only public HTTP URLs can be fetched", async () => {
  assert.ok(await resolvePublicUrl("https://example.com/read?page=2", publicResolver));
  assert.ok(await resolvePublicUrl("http://93.184.216.34/", publicResolver), "public IP literals need no lookup");

  const refused = [
    "ftp://example.com/file",
    "javascript:alert(1)",
    "file:///etc/passwd",
    "https://user:password@example.com/",
    "http://localhost:3000/",
    "http://app.local/",
    "http://service.internal/",
    "http://printer.home.arpa/",
    "http://127.0.0.1/",
    "http://10.1.2.3/",
    "http://172.20.0.1/",
    "http://192.168.0.10/",
    "http://169.254.169.254/latest/meta-data/",
    "http://100.64.0.1/",
    "http://[::1]/",
    "http://[fe80::1]/",
    "http://[fd00::1]/",
    "not a url",
  ];
  for (const url of refused) {
    assert.equal(await resolvePublicUrl(url, publicResolver), null, `${url} must be refused`);
  }

  assert.equal(await resolvePublicUrl("https://example.com/", privateResolver), null, "private DNS results are refused");
  assert.equal(await resolvePublicUrl("https://example.com/", mixedResolver), null, "one private address is enough to refuse");
  assert.equal(
    await resolvePublicUrl("https://example.com/", async () => { throw new Error("ENOTFOUND"); }),
    null,
    "unresolvable hosts are refused",
  );
});

test("metadata is read from Open Graph, Twitter, and plain head tags", () => {
  const preview = extractLinkPreview(`<!doctype html><html><head>
    <title>Fallback &amp; title</title>
    <meta property="og:title" content="Episode 4 &amp; the long wait" />
    <meta name="twitter:description" content="Twitter description" />
    <meta property="og:description" content="A recap of   the episode." />
    <meta property="og:site_name" content="Example Reads" />
    <meta property="og:image" content="/images/cover.jpg" />
    <link rel="icon" href="/favicon-32.png" />
  </head></html>`, "https://example.com/shows/4");

  assert.equal(preview.title, "Episode 4 & the long wait");
  assert.equal(preview.description, "A recap of the episode.");
  assert.equal(preview.siteName, "Example Reads");
  assert.equal(preview.imageUrl, "https://example.com/images/cover.jpg");
  assert.equal(preview.faviconUrl, "https://example.com/favicon-32.png");
});

test("missing metadata falls back to the document title and default favicon", () => {
  const preview = extractLinkPreview(
    "<html><head><title>  Notes\n on  links </title></head><body>No meta tags</body></html>",
    "https://example.com/a/b",
  );

  assert.equal(preview.title, "Notes on links");
  assert.equal(preview.description, null);
  assert.equal(preview.siteName, null);
  assert.equal(preview.imageUrl, null);
  assert.equal(preview.faviconUrl, "https://example.com/favicon.ico");

  const empty = extractLinkPreview("<html><body>Nothing</body></html>", "https://example.com/");
  assert.deepEqual(empty, {
    title: null,
    description: null,
    siteName: null,
    imageUrl: null,
    faviconUrl: "https://example.com/favicon.ico",
  });
});

test("preview images must be HTTP URLs", () => {
  const unsafe = extractLinkPreview(
    '<html><head><meta property="og:image" content="javascript:alert(1)" /></head></html>',
    "https://example.com/",
  );
  assert.equal(unsafe.imageUrl, null);

  const protocolRelative = extractLinkPreview(
    '<html><head><meta property="og:image" content="//cdn.example.com/shot.png" /></head></html>',
    "https://example.com/",
  );
  assert.equal(protocolRelative.imageUrl, "https://cdn.example.com/shot.png");
});

test("fetching a page returns its preview without following redirects off-host blindly", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher: PreviewFetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return htmlResponse('<html><head><meta property="og:title" content="First" /></head></html>');
  };

  const preview = await fetchLinkPreview("https://example.com/start", { fetchImpl: fetcher, resolve: publicResolver });

  assert.equal(preview?.title, "First");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init?.redirect, "manual");
  assert.equal((calls[0].init?.headers as Record<string, string>)["user-agent"], "KBS link preview");
});

test("a redirect is followed only when the new host is also public", async () => {
  const seen: string[] = [];
  const viaRedirect: PreviewFetch = async (input) => {
    seen.push(String(input));
    return String(input).endsWith("/final")
      ? htmlResponse('<html><head><meta property="og:title" content="Arrived" /></head></html>')
      : new Response(null, { status: 302, headers: { location: "https://example.com/final" } });
  };

  const preview = await fetchLinkPreview("https://example.com/start", { fetchImpl: viaRedirect, resolve: publicResolver });
  assert.equal(preview?.title, "Arrived");
  assert.deepEqual(seen, ["https://example.com/start", "https://example.com/final"]);

  const toPrivate: PreviewFetch = async (input) => {
    seen.push(String(input));
    return new Response(null, { status: 307, headers: { location: "http://127.0.0.1/admin" } });
  };
  seen.length = 0;
  assert.equal(await fetchLinkPreview("https://example.com/start", { fetchImpl: toPrivate, resolve: publicResolver }), null);
  assert.deepEqual(seen, ["https://example.com/start"], "a redirect to a private address is never requested");

  let loops = 0;
  const endless: PreviewFetch = async () => {
    loops += 1;
    return new Response(null, { status: 302, headers: { location: "https://example.com/again" } });
  };
  assert.equal(await fetchLinkPreview("https://example.com/loop", { fetchImpl: endless, resolve: publicResolver }), null);
  assert.equal(loops, 4, "a redirect chain stops after three hops");
});

test("non-HTML, failing, and oversized responses never fail the capture", async () => {
  const pdf: PreviewFetch = async () => htmlResponse("%PDF-1.4", { headers: { "content-type": "application/pdf" } });
  assert.equal(await fetchLinkPreview("https://example.com/file", { fetchImpl: pdf, resolve: publicResolver }), null);

  const missing: PreviewFetch = async () => htmlResponse("gone", { status: 404 });
  assert.equal(await fetchLinkPreview("https://example.com/gone", { fetchImpl: missing, resolve: publicResolver }), null);

  const offline: PreviewFetch = async () => { throw new Error("ECONNREFUSED"); };
  assert.equal(await fetchLinkPreview("https://example.com/", { fetchImpl: offline, resolve: publicResolver }), null);

  const huge = `<html><head><title>Big page</title></head><body>${"x".repeat(700_000)}</body></html>`;
  const oversized: PreviewFetch = async () => htmlResponse(huge);
  const preview = await fetchLinkPreview("https://example.com/big", { fetchImpl: oversized, resolve: publicResolver });
  assert.equal(preview?.title, "Big page");
});

test("a slow page is abandoned at the timeout", async () => {
  const hanging: PreviewFetch = (_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
  });

  assert.equal(
    await fetchLinkPreview("https://example.com/slow", { fetchImpl: hanging, resolve: publicResolver, timeoutMs: 20 }),
    null,
  );
});
