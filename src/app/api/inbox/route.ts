import { and, desc, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { attachments, pages } from "@/db/schema";
import { fetchLinkPreview } from "@/lib/link-preview";
import { apiErrorResponse } from "@/lib/api-log";
import {
  buildCaptureDocument,
  captureFileTitle,
  toCapturedAttachment,
} from "@/lib/inbox-capture";

const captureSchema = z.object({
  title: z.string().trim().max(200).optional(),
  content: z.string().trim().max(2_000_000).optional(),
  sourceUrl: z.string().trim().url().max(2048).optional().or(z.literal("")),
  selectedText: z.string().trim().max(2_000).optional(),
  // A file capture uploads first, then references the stored attachment here.
  attachmentId: z.string().uuid().optional(),
}).refine((item) => Boolean(item.title || item.content || item.sourceUrl || item.attachmentId), {
  message: "Add a title, note, link, or file to capture.",
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

  try {
    // Only files the upload route already stored can be attached.
    const attachment = parsed.data.attachmentId
      ? await db.select({ id: attachments.id, filename: attachments.filename, mimeType: attachments.mimeType, size: attachments.size })
        .from(attachments)
        .where(eq(attachments.id, parsed.data.attachmentId))
        .limit(1)
        .then(([row]) => (row ? toCapturedAttachment(row) : null))
      : null;
    if (parsed.data.attachmentId && !attachment) {
      return NextResponse.json({ error: "That upload could not be found. Attach the file again." }, { status: 400 });
    }

    const sourceUrl = parsed.data.sourceUrl || null;
    const preview = sourceUrl ? await fetchLinkPreview(sourceUrl) : null;
    const derivedTitle = parsed.data.title
      || preview?.title
      || (attachment ? captureFileTitle(attachment.filename) : null)
      || (sourceUrl ? new URL(sourceUrl).hostname : "Quick note");
    const document = buildCaptureDocument({ note: parsed.data.content, attachment });

    const [item] = await db.insert(pages).values({
      title: derivedTitle,
      content: document.content,
      contentJson: document.contentJson,
      isInbox: true,
      sourceUrl,
      selectedText: parsed.data.selectedText || null,
      linkPreview: preview,
      captureAttachment: attachment,
      capturedAt: new Date(),
    }).returning();
    return NextResponse.json(item, { status: 201 });
  } catch (error) {
    return apiErrorResponse(request, "Failed to save capture.", error, { status: 500, logMessage: "Failed to capture inbox item:" });
  }
}
