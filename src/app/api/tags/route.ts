import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { tags } from "@/db/schema";
import { z } from "zod";

const createTagSchema = z.object({
  name: z.string().trim().min(1).max(50),
});

export async function GET() {
  try {
    const results = await db
      .select()
      .from(tags)
      .orderBy(asc(tags.name));

    return Response.json(results);
  } catch (error) {
    console.error("Failed to fetch tags:", error);

    return Response.json(
      { error: "Failed to fetch tags." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = createTagSchema.safeParse(body);

    if (!parsed.success) {
      return Response.json(
        { error: "Tag name must be between 1 and 50 characters." },
        { status: 400 }
      );
    }

    const name = parsed.data.name;

    const [existingTag] = await db
      .select()
      .from(tags)
      .where(eq(tags.name, name))
      .limit(1);

    if (existingTag) {
      return Response.json(existingTag);
    }

    const [newTag] = await db
      .insert(tags)
      .values({ name })
      .returning();

    return Response.json(newTag, { status: 201 });
  } catch (error) {
    console.error("Failed to create tag:", error);

    return Response.json(
      { error: "Failed to create tag." },
      { status: 500 }
    );
  }
}