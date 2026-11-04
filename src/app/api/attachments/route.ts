import { NextResponse } from "next/server";
import { FILE_MIME_TYPES, IMAGE_MIME_TYPES } from "@/lib/media";
import { storeAttachment } from "@/lib/attachment-store";

export async function POST(request: Request) {
  const formData = await request.formData().catch(() => null);
  if (!formData) return NextResponse.json({ error: "Expected a file upload." }, { status: 400 });
  const file = formData.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a file to upload." }, { status: 400 });

  const purpose = formData.get("purpose");
  const allowed = purpose === "image" ? IMAGE_MIME_TYPES : FILE_MIME_TYPES;

  try {
    const result = await storeAttachment(file, allowed);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.attachment, { status: 201 });
  } catch (error) {
    console.error("Failed to store attachment:", error);
    return NextResponse.json({ error: "Failed to store the file." }, { status: 500 });
  }
}
