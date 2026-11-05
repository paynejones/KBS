import { NextResponse } from "next/server";
import { listOrphanedAttachments, removeOrphanedAttachments } from "@/lib/attachment-cleanup";

export async function GET() {
  try {
    const items = await listOrphanedAttachments();
    return NextResponse.json({
      count: items.length,
      bytes: items.reduce((total, item) => total + item.size, 0),
      items,
    });
  } catch (error) {
    console.error("Failed to scan attachments:", error);
    return NextResponse.json({ error: "Failed to scan stored files." }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const result = await removeOrphanedAttachments();
    return NextResponse.json(result);
  } catch (error) {
    console.error("Failed to remove unused attachments:", error);
    return NextResponse.json({ error: "Failed to remove unused files." }, { status: 500 });
  }
}
