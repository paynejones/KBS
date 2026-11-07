import {
  FILE_MIME_TYPES,
  MAX_ATTACHMENT_BYTES,
  attachmentUrl,
  isImageMimeType,
  type CapturedAttachment,
} from "@/lib/media";

/**
 * A captured file is uploaded first and then referenced by the inbox page, the
 * same way a file property points at a stored attachment. The URL is stored
 * with it so orphan cleanup recognises the file as used.
 */
export function toCapturedAttachment(row: {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
}): CapturedAttachment {
  return {
    id: row.id,
    url: attachmentUrl(row.id),
    filename: row.filename,
    mimeType: row.mimeType,
    size: row.size,
  };
}

/** Returns a message when the chosen file cannot be captured, otherwise null. */
export function validateCaptureFile(file: { size: number; type: string }) {
  if (file.size <= 0 || file.size > MAX_ATTACHMENT_BYTES) {
    return `File must be between 1 byte and ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB.`;
  }
  if (!FILE_MIME_TYPES.includes(file.type as (typeof FILE_MIME_TYPES)[number])) {
    return "Choose an image or a PDF.";
  }
  return null;
}

/** `scan.pdf` becomes `scan`, so a captured file gets a page title worth reading. */
export function captureFileTitle(filename: string) {
  const base = filename.replace(/\.[^.]+$/, "").trim();
  return (base || "Captured file").slice(0, 200);
}

/**
 * Builds the page body for an inbox capture. Notes stay as the first paragraph,
 * images become the same `imageEmbed` nodes the editor writes, and other files
 * become a link to the stored bytes so the file is still reachable after the
 * capture is moved out of the inbox.
 */
export function buildCaptureDocument({
  note,
  attachment,
}: {
  note?: string | null;
  attachment?: CapturedAttachment | null;
}) {
  const nodes: Record<string, unknown>[] = [];
  const text: string[] = [];
  const trimmedNote = note?.trim();

  if (trimmedNote) {
    text.push(trimmedNote);
    nodes.push({ type: "paragraph", content: [{ type: "text", text: trimmedNote }] });
  }

  if (attachment) {
    text.push(attachment.filename);
    if (isImageMimeType(attachment.mimeType)) {
      nodes.push({
        type: "imageEmbed",
        attrs: { src: attachment.url, alt: attachment.filename },
      });
    } else {
      nodes.push({
        type: "paragraph",
        content: [
          {
            type: "text",
            text: attachment.filename,
            marks: [{ type: "link", attrs: { href: attachment.url } }],
          },
        ],
      });
    }
  }

  if (nodes.length === 0) nodes.push({ type: "paragraph" });

  return {
    content: text.join("\n\n"),
    contentJson: { type: "doc", content: nodes },
  };
}
