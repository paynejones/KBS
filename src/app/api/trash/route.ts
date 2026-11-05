import { NextResponse } from "next/server";
import { desc, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { pages } from "@/db/schema";
import { descendantCount, trashedRoots } from "@/lib/trash";

type TrashItem = {
  id: string;
  title: string;
  deletedAt: Date | null;
  isInbox: boolean;
  updatedAt: Date;
  descendantCount: number;
};

export async function GET() {
  try {
    const [trashed, hierarchy] = await Promise.all([
      db
        .select({
          id: pages.id,
          title: pages.title,
          deletedAt: pages.deletedAt,
          isInbox: pages.isInbox,
          updatedAt: pages.updatedAt,
        })
        .from(pages)
        .where(isNotNull(pages.deletedAt))
        .orderBy(desc(pages.deletedAt)),
      db
        .select({ id: pages.id, parentId: pages.parentId, deletedAt: pages.deletedAt })
        .from(pages),
    ]);

    const byId = new Map(trashed.map((page) => [page.id, page]));
    const items: TrashItem[] = [];

    for (const root of trashedRoots(hierarchy)) {
      const page = byId.get(root.id);
      if (!page) continue;
      items.push({ ...page, descendantCount: descendantCount(hierarchy, page.id) });
    }

    return NextResponse.json({ items, totalTrashed: trashed.length });
  } catch (error) {
    console.error("Failed to load trash:", error);
    return NextResponse.json({ error: "Failed to load trash." }, { status: 500 });
  }
}
