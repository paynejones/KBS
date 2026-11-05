import assert from "node:assert/strict";
import test from "node:test";
import {
  attachmentIdsInText,
  attachmentUrl,
  FILE_MIME_TYPES,
  fileValueSearchText,
  IMAGE_MIME_TYPES,
  isAllowedMediaUrl,
  isImageMimeType,
  MAX_ATTACHMENT_BYTES,
  parseFilePropertyValue,
} from "../src/lib/media";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

test("attachment references are found in text, JSON, and markup", () => {
  assert.deepEqual(
    attachmentIdsInText(`<img src="/api/attachments/${A}" /><a href="/api/attachments/${B}">x</a>`),
    [A, B],
  );
  assert.deepEqual(
    attachmentIdsInText(JSON.stringify({ image: { src: attachmentUrl(A) }, cover: attachmentUrl(B) })),
    [A, B],
  );
  assert.deepEqual(attachmentIdsInText(attachmentUrl(A).toUpperCase()), [A], "ids are normalized to lower case");
});

test("attachment scanning deduplicates and ignores malformed references", () => {
  assert.deepEqual(
    attachmentIdsInText(`${attachmentUrl(A)} ${attachmentUrl(A)} ${attachmentUrl(B)}`),
    [A, B],
  );
  assert.deepEqual(attachmentIdsInText("/api/attachments/not-a-uuid"), []);
  assert.deepEqual(attachmentIdsInText(`/api/attachments/${A.slice(0, 20)}`), []);
  assert.deepEqual(attachmentIdsInText(""), []);
  assert.deepEqual(attachmentIdsInText(null), []);
  assert.deepEqual(attachmentIdsInText(undefined), []);
});

test("media URLs allow uploaded files and http(s) only", () => {
  assert.equal(isAllowedMediaUrl(attachmentUrl(A)), true);
  assert.equal(isAllowedMediaUrl("https://example.com/cover.png"), true);
  assert.equal(isAllowedMediaUrl("http://example.com/cover.png"), true);
  assert.equal(isAllowedMediaUrl("//example.com/cover.png"), false);
  assert.equal(isAllowedMediaUrl("javascript:alert(1)"), false);
  assert.equal(isAllowedMediaUrl("data:image/png;base64,AAAA"), false);
  assert.equal(isAllowedMediaUrl("ftp://example.com/file.png"), false);
  assert.equal(isAllowedMediaUrl("cover.png"), false);
  assert.equal(isAllowedMediaUrl(` ${attachmentUrl(A)}`), false);
  assert.equal(isAllowedMediaUrl(`${attachmentUrl(A)}?download=1`), false);
  assert.equal(isAllowedMediaUrl(""), false);
});

test("image mime types are limited to the supported formats", () => {
  for (const mimeType of IMAGE_MIME_TYPES) {
    assert.equal(isImageMimeType(mimeType), true);
  }
  assert.equal(isImageMimeType("application/pdf"), false);
  assert.equal(isImageMimeType("image/svg+xml"), false);
  assert.equal(isImageMimeType(""), false);
  assert.ok(FILE_MIME_TYPES.includes("application/pdf"));
  assert.equal(MAX_ATTACHMENT_BYTES, 10 * 1024 * 1024);
});

test("file property values parse uploaded and remote media", () => {
  const uploaded = parseFilePropertyValue({
    url: attachmentUrl(A),
    attachmentId: A,
    alt: "Harvest",
    filename: "harvest.png",
    mimeType: "image/png",
  });
  assert.deepEqual(uploaded, {
    url: attachmentUrl(A),
    attachmentId: A,
    alt: "Harvest",
    filename: "harvest.png",
    mimeType: "image/png",
  });

  const remote = parseFilePropertyValue({ url: "https://example.com/a.png" });
  assert.deepEqual(remote, {
    url: "https://example.com/a.png",
    attachmentId: null,
    alt: "",
    filename: "",
    mimeType: "",
  });

  assert.deepEqual(
    parseFilePropertyValue({ url: " https://example.com/a.png ", alt: 7, filename: null, mimeType: 3 }),
    {
      url: "https://example.com/a.png",
      attachmentId: null,
      alt: "",
      filename: "",
      mimeType: "",
    },
  );
});

test("file property values reject mismatched, unsafe, and oversized payloads", () => {
  assert.equal(parseFilePropertyValue(null), null);
  assert.equal(parseFilePropertyValue(undefined), undefined);
  assert.equal(parseFilePropertyValue("https://example.com/a.png"), undefined);
  assert.equal(parseFilePropertyValue([]), undefined);
  assert.equal(parseFilePropertyValue(42), undefined);
  assert.equal(parseFilePropertyValue({}), undefined);
  assert.equal(parseFilePropertyValue({ url: "   " }), undefined);
  assert.equal(parseFilePropertyValue({ url: "data:text/html,<script>" }), undefined);
  assert.equal(
    parseFilePropertyValue({ url: attachmentUrl(A), attachmentId: B }),
    undefined,
    "an attachment id must match the URL it points at",
  );
  assert.equal(
    parseFilePropertyValue({ url: "https://example.com/a.png", attachmentId: A }),
    undefined,
    "remote files cannot claim a stored attachment id",
  );
  assert.equal(parseFilePropertyValue({ url: attachmentUrl(A), alt: "x".repeat(201) }), undefined);
  assert.equal(parseFilePropertyValue({ url: attachmentUrl(A), filename: "x".repeat(256) }), undefined);
  assert.equal(parseFilePropertyValue({ url: attachmentUrl(A), mimeType: "x".repeat(101) }), undefined);
});

test("file property search text prefers parsed metadata", () => {
  assert.equal(
    fileValueSearchText({
      url: attachmentUrl(A),
      attachmentId: A,
      alt: "A cover",
      filename: "cover.png",
      mimeType: "image/png",
    }),
    `cover.png A cover ${attachmentUrl(A)}`,
  );
  assert.equal(fileValueSearchText(null), "");
  assert.equal(fileValueSearchText(undefined), "");
  assert.equal(fileValueSearchText("legacy value"), "legacy value");
  assert.equal(fileValueSearchText({ url: "javascript:alert(1)" }), "");
  assert.equal(fileValueSearchText(12), "");
});
