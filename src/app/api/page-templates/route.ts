import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { pageTemplates, pages } from "@/db/schema";

const createTemplateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  /** Snapshot this page instead of supplying content inline. */
  pageId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(200).optional(),
  content: z.string().max(2_000_000).optional(),
  contentJson: z.record(z.string(), z.unknown()).optional(),
  icon: z.string().max(32).nullable().optional(),
});

export async function GET() {
  try {
    const templates = await db.select().from(pageTemplates).orderBy(asc(pageTemplates.name));
    return NextResponse.json(templates);
  } catch (error) {
    console.error("Failed to fetch page templates:", error);
    return NextResponse.json({ error: "Failed to fetch page templates." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const parsed = createTemplateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid template data" }, { status: 400 });
  }

  try {
    let snapshot = {
      title: parsed.data.title ?? "Untitled",
      content: parsed.data.content ?? "",
      contentJson: parsed.data.contentJson ?? {},
      icon: parsed.data.icon ?? null,
    };

    if (parsed.data.pageId) {
      const [page] = await db
        .select({
          title: pages.title,
          content: pages.content,
          contentJson: pages.contentJson,
          icon: pages.icon,
        })
        .from(pages)
        .where(eq(pages.id, parsed.data.pageId))
        .limit(1);

      if (!page) {
        return NextResponse.json({ error: "Page not found" }, { status: 404 });
      }

      // An unsaved template snapshot is a copy: later page edits must not
      // rewrite it, so the row stores its own content.
      snapshot = {
        title: parsed.data.title ?? page.title,
        content: parsed.data.content ?? page.content,
        contentJson: parsed.data.contentJson ?? page.contentJson,
        icon: parsed.data.icon ?? page.icon,
      };
    }

    const [template] = await db
      .insert(pageTemplates)
      .values({ name: parsed.data.name, ...snapshot })
      .returning();

    return NextResponse.json(template, { status: 201 });
  } catch (error) {
    console.error("Failed to create page template:", error);
    return NextResponse.json({ error: "Failed to create page template." }, { status: 500 });
  }
}
