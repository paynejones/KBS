import { NextResponse } from "next/server";
import { listBackups, summarizeBackup } from "@/lib/backup";
import { createBackup } from "@/lib/backup-create";
import { apiErrorResponse } from "@/lib/api-log";

export async function GET(request: Request) {
  try {
    return NextResponse.json({ backups: await listBackups() });
  } catch (error) {
    return apiErrorResponse(request, "Failed to list backups.", error, { status: 500, logMessage: "Failed to list backups:" });
  }
}

export async function POST(request: Request) {
  try {
    const { manifest, verification } = await createBackup();
    console.log(
      `Backup ${manifest.id} created: ${manifest.totals.attachments} file(s), verification ${verification.ok ? "passed" : "failed"}.`,
    );

    return NextResponse.json(
      { backup: summarizeBackup(manifest), verification },
      { status: 201 },
    );
  } catch (error) {
    return apiErrorResponse(request, "Failed to create a backup.", error, { status: 500, logMessage: "Failed to create a backup:" });
  }
}
