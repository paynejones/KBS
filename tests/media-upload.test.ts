import assert from "node:assert/strict";
import test from "node:test";
import { attachmentUrl, uploadAttachment } from "../src/lib/media";

const ID = "11111111-1111-4111-8111-111111111111";

function sampleFile() {
  return new File([new Uint8Array([1, 2, 3])], "note.txt", { type: "text/plain" });
}

async function withFetch<T>(
  impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  run: () => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = impl as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

test("attachment URLs point at the download route", () => {
  assert.equal(attachmentUrl(ID), `/api/attachments/${ID}`);
});

test("uploadAttachment posts the file and returns the stored metadata", async () => {
  const file = sampleFile();
  let requested: { url?: string; init?: RequestInit } = {};

  const result = await withFetch(async (input, init) => {
    requested = { url: String(input), init };
    return Response.json({
      id: ID,
      url: `/api/attachments/${ID}`,
      filename: "note.txt",
      mimeType: "text/plain",
      size: 3,
    });
  }, () => uploadAttachment(file));

  assert.equal(requested.url, "/api/attachments");
  assert.equal(requested.init?.method, "POST");
  const body = requested.init?.body;
  assert.ok(body instanceof FormData, "upload should use multipart form data");
  assert.equal((body.get("file") as File).name, "note.txt");
  assert.deepEqual(result, {
    id: ID,
    url: `/api/attachments/${ID}`,
    filename: "note.txt",
    mimeType: "text/plain",
    size: 3,
  });
});

test("uploadAttachment falls back to local file details when the response omits them", async () => {
  const file = sampleFile();

  const result = await withFetch(
    async () => Response.json({ id: ID, url: `/api/attachments/${ID}` }),
    () => uploadAttachment(file),
  );

  assert.equal(result.filename, "note.txt");
  assert.equal(result.mimeType, "text/plain");
  assert.equal(result.size, file.size);
});

test("uploadAttachment surfaces the server error message", async () => {
  await withFetch(
    async () => Response.json({ error: "That file type is not supported." }, { status: 400 }),
    async () => {
      await assert.rejects(uploadAttachment(sampleFile()), /That file type is not supported\./);
    },
  );
});

test("uploadAttachment falls back to a generic message for unreadable failures", async () => {
  await withFetch(
    async () => new Response("<html>bad gateway</html>", { status: 502 }),
    async () => {
      await assert.rejects(uploadAttachment(sampleFile()), /Could not upload the file\./);
    },
  );
});

test("uploadAttachment rejects successful responses without a usable id or url", async () => {
  await withFetch(
    async () => Response.json({ id: ID }, { status: 200 }),
    async () => {
      await assert.rejects(uploadAttachment(sampleFile()), /Could not upload the file\./);
    },
  );
});
