import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCaptureDocument,
  captureFileTitle,
  toCapturedAttachment,
  validateCaptureFile,
} from "../src/lib/inbox-capture";

const PDF_ID = "11111111-1111-4111-8111-111111111111";
const IMAGE_ID = "22222222-2222-4222-8222-222222222222";

const pdf = toCapturedAttachment({
  id: PDF_ID,
  filename: "syllabus.pdf",
  mimeType: "application/pdf",
  size: 2048,
});
const image = toCapturedAttachment({
  id: IMAGE_ID,
  filename: "whiteboard.png",
  mimeType: "image/png",
  size: 512,
});

test("a captured file points at the attachment route", () => {
  assert.deepEqual(pdf, {
    id: PDF_ID,
    url: `/api/attachments/${PDF_ID}`,
    filename: "syllabus.pdf",
    mimeType: "application/pdf",
    size: 2048,
  });
});

test("a PDF capture becomes a link to the stored file", () => {
  const { content, contentJson } = buildCaptureDocument({ note: "Read this", attachment: pdf });
  assert.equal(content, "Read this\n\nsyllabus.pdf");
  assert.deepEqual(contentJson, {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Read this" }] },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "syllabus.pdf",
            marks: [{ type: "link", attrs: { href: pdf.url } }],
          },
        ],
      },
    ],
  });
});

test("an image capture becomes the same image embed the editor writes", () => {
  const { content, contentJson } = buildCaptureDocument({ attachment: image });
  assert.equal(content, "whiteboard.png");
  assert.deepEqual(contentJson, {
    type: "doc",
    content: [{ type: "imageEmbed", attrs: { src: image.url, alt: "whiteboard.png" } }],
  });
});

test("a capture without words or a file still yields one empty paragraph", () => {
  assert.deepEqual(buildCaptureDocument({}), {
    content: "",
    contentJson: { type: "doc", content: [{ type: "paragraph" }] },
  });
  assert.deepEqual(buildCaptureDocument({ note: "   " }).contentJson, {
    type: "doc",
    content: [{ type: "paragraph" }],
  });
});

test("a captured file gets its name as the page title", () => {
  assert.equal(captureFileTitle("quarterly report.final.pdf"), "quarterly report.final");
  assert.equal(captureFileTitle(".png"), "Captured file");
  assert.equal(captureFileTitle(`${"a".repeat(300)}.pdf`).length, 200);
});

test("only image and PDF files up to the attachment limit can be captured", () => {
  assert.equal(validateCaptureFile({ size: 2048, type: "application/pdf" }), null);
  assert.equal(validateCaptureFile({ size: 2048, type: "image/png" }), null);
  assert.equal(validateCaptureFile({ size: 2048, type: "text/plain" }), "Choose an image or a PDF.");
  assert.match(validateCaptureFile({ size: 0, type: "image/png" }) ?? "", /between 1 byte and 10 MB/);
  assert.match(validateCaptureFile({ size: 11 * 1024 * 1024, type: "image/png" }) ?? "", /between 1 byte and 10 MB/);
});
