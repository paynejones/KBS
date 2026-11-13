import assert from "node:assert/strict";
import { test } from "node:test";
import { galleryCoverForRecord } from "../src/lib/gallery-cover";

function image(url: string) {
  return { attachmentId: null, url, alt: "", filename: "", mimeType: "image/png" };
}

test("a gallery uses the chosen image property before other properties", () => {
  const record = {
    title: "Trip",
    values: {
      first: image("https://example.com/first.png"),
      chosen: image("https://example.com/chosen.png"),
    },
  };

  assert.deepEqual(
    galleryCoverForRecord(record, {
      chosenPropertyId: "chosen",
      filePropertyIds: ["first", "chosen"],
    }),
    { url: "https://example.com/chosen.png", alt: "Trip", propertyId: "chosen" },
  );
});

test("a gallery falls back to the first image property when the chosen one is empty", () => {
  const record = {
    title: "Trip",
    values: {
      first: image("https://example.com/first.png"),
      chosen: null,
    },
  };

  assert.deepEqual(
    galleryCoverForRecord(record, {
      chosenPropertyId: "chosen",
      filePropertyIds: ["first", "chosen"],
    }),
    { url: "https://example.com/first.png", alt: "Trip", propertyId: "first" },
  );
});

test("a gallery falls back to the record page cover when no property holds an image", () => {
  const record = {
    title: "Trip",
    values: {
      attachment: { attachmentId: null, url: "https://example.com/notes.pdf", alt: "", filename: "", mimeType: "application/pdf" },
    },
    pageCoverImageUrl: "https://example.com/page-cover.jpg",
  };

  assert.deepEqual(
    galleryCoverForRecord(record, { filePropertyIds: ["attachment"] }),
    { url: "https://example.com/page-cover.jpg", alt: "Trip", propertyId: "" },
  );
});

test("a gallery ignores an unsafe page cover and reports no cover", () => {
  assert.equal(
    galleryCoverForRecord(
      { title: "Trip", values: {}, pageCoverImageUrl: "javascript:alert(1)" },
      { filePropertyIds: [] },
    ),
    null,
  );
  assert.equal(
    galleryCoverForRecord({ title: "Trip", values: {}, pageCoverImageUrl: null }, { filePropertyIds: [] }),
    null,
  );
});
