import { NextResponse } from "next/server";
import { listOrphanedAttachments, removeOrphanedAttachments } from "@/lib/attachment-cleanup";
import { apiErrorResponse } from "@/lib/api-log";

export async function GET(request: Request) {
  try {
    const items = await listOrphanedAttachments();
    return NextResponse.json({
      count: items.length,
      bytes: items.reduce((total, item) => total + item.size, 0),
      items,
    });
  } catch (error) {
    return apiErrorResponse(request, "Failed to scan stored files.", error, { status: 500, logMessage: "Failed to scan attachments:" });
  }
}

export async function DELETE(request: Request) {
  try {
    const result = await removeOrphanedAttachments();
    return NextResponse.json(result);
  } catch (error) {
    return apiErrorResponse(request, "Failed to remove unused files.", error, { status: 500, logMessage: "Failed to remove unused attachments:" });
  }
}
