import { NextResponse } from "next/server";
import { buildWorkspaceExport } from "@/lib/workspace-export";
import { apiErrorResponse } from "@/lib/api-log";

export async function GET(request: Request) {
  try {
    const exportedAt = new Date();
    const payload = await buildWorkspaceExport(exportedAt);
    const filename = `kbs-export-${exportedAt.toISOString().slice(0, 10)}.json`;

    return NextResponse.json(payload, {
      headers: {
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return apiErrorResponse(request, "Failed to export the workspace.", error, { status: 500, logMessage: "Failed to export workspace:" });
  }
}
