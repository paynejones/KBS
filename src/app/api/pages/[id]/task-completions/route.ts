import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { pages, taskCompletions } from "@/db/schema";
import { apiErrorResponse } from "@/lib/api-log";

type Context = { params: Promise<{ id: string }> };
const idSchema = z.string().uuid();

const completionSchema = z.object({
  text: z.string().trim().min(1).max(400),
  checked: z.boolean(),
});

/**
 * Keeps the small "recently finished" history shown on pinned project cards.
 * Checking a task replaces any earlier entry for the same text on the page;
 * unchecking it drops the entry because the work is open again. Task text is
 * the key because task lists are editor content with no stable ids.
 */
export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ error: "Invalid page ID" }, { status: 400 });
  }

  const parsed = completionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid task completion" }, { status: 400 });
  }

  try {
    const [page] = await db
      .select({ id: pages.id })
      .from(pages)
      .where(and(eq(pages.id, id), isNull(pages.deletedAt)))
      .limit(1);
    if (!page) {
      return NextResponse.json({ error: "Page not found" }, { status: 404 });
    }

    if (parsed.data.checked) {
      await db.transaction(async (tx) => {
        await tx
          .delete(taskCompletions)
          .where(
            and(
              eq(taskCompletions.pageId, id),
              eq(taskCompletions.text, parsed.data.text),
            ),
          );
        await tx
          .insert(taskCompletions)
          .values({ pageId: id, text: parsed.data.text });
      });
    } else {
      await db
        .delete(taskCompletions)
        .where(
          and(
            eq(taskCompletions.pageId, id),
            eq(taskCompletions.text, parsed.data.text),
          ),
        );
    }

    return NextResponse.json({ recorded: parsed.data.checked });
  } catch (error) {
    return apiErrorResponse(request, "Failed to record the task completion", error, {
      status: 500,
      logMessage: "Failed to record the task completion:",
    });
  }
}
