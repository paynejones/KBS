import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { databaseTemplates } from "@/db/schema";
import { apiErrorResponse } from "@/lib/api-log";

type Context = { params: Promise<{ id: string; templateId: string }> };

export async function DELETE(request: Request, context: Context) {
  const { id, templateId } = await context.params;
  if (!z.string().uuid().safeParse(id).success || !z.string().uuid().safeParse(templateId).success) {
    return NextResponse.json({ error: "Invalid template ID" }, { status: 400 });
  }
  try {
    const [template] = await db.delete(databaseTemplates).where(and(
      eq(databaseTemplates.id, templateId),
      eq(databaseTemplates.databaseId, id),
    )).returning({ id: databaseTemplates.id });
    if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    return apiErrorResponse(request, "Failed to delete template", error, { status: 500, logMessage: "Failed to delete database template:" });
  }
}
