import { NextResponse } from "next/server";
import { isValidBackupId, summarizeBackup, verifyStoredBackup } from "@/lib/backup";
import { apiErrorResponse } from "@/lib/api-log";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  if (!isValidBackupId(id)) {
    return NextResponse.json({ error: "Invalid backup ID." }, { status: 400 });
  }

  try {
    const { manifest, verification } = await verifyStoredBackup(id);

    return NextResponse.json({ backup: summarizeBackup(manifest), verification });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ error: "Backup not found." }, { status: 404 });
    }
    return apiErrorResponse(request, "Failed to check the backup.", error, { status: 500, logMessage: "Failed to verify a backup:" });
  }
}
