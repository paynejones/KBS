import { NextResponse } from "next/server";
import { z } from "zod";
import { readStoredAttachment } from "@/lib/attachment-store";
import { apiErrorResponse } from "@/lib/api-log";
import { isImageMimeType } from "@/lib/media";

type Context = { params: Promise<{ id: string }> };

function contentDisposition(filename: string, mimeType: string) {
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "") || "download";
  // Only formats a browser renders safely preview inline; every other stored
  // type downloads, so an uploaded document never runs on this origin.
  const inline = isImageMimeType(mimeType) || mimeType === "application/pdf";
  return `${inline ? "inline" : "attachment"}; filename="${ascii}"`;
}

export async function GET(request: Request, context: Context) {
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Invalid attachment ID" }, { status: 400 });
  }

  try {
    const attachment = await readStoredAttachment(id);
    if (!attachment) return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
    return new NextResponse(new Uint8Array(attachment.bytes), {
      headers: {
        "Content-Type": attachment.mimeType,
        "Content-Length": String(attachment.bytes.byteLength),
        "Content-Disposition": contentDisposition(attachment.filename, attachment.mimeType),
        "Cache-Control": "private, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return apiErrorResponse(request, "Failed to read attachment", error, { status: 500, logMessage: "Failed to read attachment:" });
  }
}
