import { NextResponse } from "next/server";
import { IMAGE_MIME_TYPES, LINKED_FILE_MIME_TYPES } from "@/lib/media";
import { storeAttachment } from "@/lib/attachment-store";
import { apiErrorResponse } from "@/lib/api-log";

export async function POST(request: Request) {
  const formData = await request.formData().catch(() => null);
  if (!formData) return NextResponse.json({ error: "Expected a file upload." }, { status: 400 });
  const file = formData.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a file to upload." }, { status: 400 });

  const purpose = formData.get("purpose");
  const allowed = purpose === "image" ? IMAGE_MIME_TYPES : LINKED_FILE_MIME_TYPES;

  try {
    const result = await storeAttachment(file, allowed);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.attachment, { status: 201 });
  } catch (error) {
    return apiErrorResponse(request, "Failed to store the file.", error, { status: 500, logMessage: "Failed to store attachment:" });
  }
}
