import { NextResponse } from "next/server";
import { z } from "zod";
import { readStoredAttachment } from "@/lib/attachment-store";

type Context = { params: Promise<{ id: string }> };

function contentDispositionFilename(filename: string) {
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "") || "download";
  return `inline; filename="${ascii}"`;
}

export async function GET(_request: Request, context: Context) {
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
        "Content-Disposition": contentDispositionFilename(attachment.filename),
        "Cache-Control": "private, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Failed to read attachment:", error);
    return NextResponse.json({ error: "Failed to read attachment" }, { status: 500 });
  }
}
