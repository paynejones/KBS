import { and, desc, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { pages } from "@/db/schema";
import { fetchLinkPreview } from "@/lib/link-preview";
import { apiErrorResponse } from "@/lib/api-log";

const captureSchema = z.object({
  title: z.string().trim().max(200).optional(),
  content: z.string().trim().max(2_000_000).optional(),
  sourceUrl: z.string().trim().url().max(2048).optional().or(z.literal("")),
  selectedText: z.string().trim().max(2_000).optional(),
}).refine((item) => Boolean(item.title || item.content || item.sourceUrl), {
  message: "Add a title, note, or URL to capture.",
}).refine((item) => !item.sourceUrl || /^https?:\/\//i.test(item.sourceUrl), {
  message: "URL must use HTTP or HTTPS.",
});

export async function GET(request: Request) {
  try {
    const items = await db.select().from(pages)
      .where(and(eq(pages.isInbox, true), isNull(pages.deletedAt)))
      .orderBy(desc(pages.capturedAt), desc(pages.createdAt));
    return NextResponse.json(items);
  } catch (error) {
    return apiErrorResponse(request, "Failed to load inbox.", error, { status: 500, logMessage: "Failed to load inbox:" });
  }
}

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const parsed = captureSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid capture." }, { status: 400 });
  }

  const sourceUrl = parsed.data.sourceUrl || null;
  const preview = sourceUrl ? await fetchLinkPreview(sourceUrl) : null;
  const derivedTitle = parsed.data.title || preview?.title || (sourceUrl ? new URL(sourceUrl).hostname : "Quick note");
  const content = parsed.data.content ?? "";
  const contentJson = content
    ? { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: content }] }] }
    : { type: "doc", content: [{ type: "paragraph" }] };

  try {
    const [item] = await db.insert(pages).values({
      title: derivedTitle,
      content,
      contentJson,
      isInbox: true,
      sourceUrl,
      selectedText: parsed.data.selectedText || null,
      linkPreview: preview,
      capturedAt: new Date(),
    }).returning();
    return NextResponse.json(item, { status: 201 });
  } catch (error) {
    return apiErrorResponse(request, "Failed to save capture.", error, { status: 500, logMessage: "Failed to capture inbox item:" });
  }
}
