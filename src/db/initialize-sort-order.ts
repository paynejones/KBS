
import "dotenv/config";
import { asc, eq, isNull } from "drizzle-orm";
import { db, pool } from "@/db";
import { pages } from "@/db/schema";

async function initializeSortOrder() {
  console.log("Initializing page sort order...");

  // Fetch all pages in a stable order.
  const allPages = await db
    .select({
      id: pages.id,
      parentId: pages.parentId,
      createdAt: pages.createdAt,
    })
    .from(pages)
    .orderBy(asc(pages.createdAt), asc(pages.id));

  // Group pages by their parent.
  const groups = new Map<string | null, typeof allPages>();

  for (const page of allPages) {
    const siblings = groups.get(page.parentId) ?? [];
    siblings.push(page);
    groups.set(page.parentId, siblings);
  }

  // Assign sequential positions within each group.
  await db.transaction(async (tx) => {
    for (const siblings of groups.values()) {
      for (const [index, page] of siblings.entries()) {
        await tx
          .update(pages)
          .set({ sortOrder: index })
          .where(eq(pages.id, page.id));
      }
    }
  });

  console.log(`Initialized ${allPages.length} pages.`);
}

initializeSortOrder()
  .catch((error) => {
    console.error("Failed to initialize sort order:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });