import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { pageTemplates } from "@/db/schema";

type Context = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, context: Context) {
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Invalid template ID" }, { status: 400 });
  }

  try {
    const [template] = await db
      .delete(pageTemplates)
      .where(eq(pageTemplates.id, id))
      .returning({ id: pageTemplates.id });

    if (!template) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete page template:", error);
    return NextResponse.json({ error: "Failed to delete page template." }, { status: 500 });
  }
}
