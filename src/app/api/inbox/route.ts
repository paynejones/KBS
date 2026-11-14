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

/**
 * What an inbox card displays. The listing used to select whole page rows, so
 * every capture's editor document travelled to the inbox and the dashboard for
 * a title, a note, and a source; the document is only needed when the capture
 * is opened.
 */
const inboxColumns = {
  id: pages.id,
  title: pages.title,
  // The note itself is shown in full on the card, unlike the document behind it.
  content: pages.content,
  sourceUrl: pages.sourceUrl,
  selectedText: pages.selectedText,
  linkPreview: pages.linkPreview,
  captureAttachment: pages.captureAttachment,
  capturedAt: pages.capturedAt,
  createdAt: pages.createdAt,
};

/** A summary can ask for the few captures it shows; the inbox wants them all. */
const INBOX_LIMIT_MAX = 50;

export async function GET(request: Request) {
  try {
    const requestedLimit = Number(new URL(request.url).searchParams.get("limit") ?? 0);
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(Math.trunc(requestedLimit), INBOX_LIMIT_MAX)
      : 0;

    const listing = db.select(inboxColumns).from(pages)
      .where(and(eq(pages.isInbox, true), isNull(pages.deletedAt)))
      .orderBy(desc(pages.capturedAt), desc(pages.createdAt));
    const items = limit > 0 ? await listing.limit(limit) : await listing;
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
