import "dotenv/config";
import { pool } from "@/db";
import { groupRecordPages } from "@/lib/database-page";

async function groupExistingRecordPages() {
  console.log("Grouping existing record pages under their database pages...");

  const summary = await groupRecordPages();

  console.log(
    `Grouped ${summary.movedPages} record page(s) across ${summary.databases} database(s); created ${summary.createdPages} database page(s).`,
  );
}

groupExistingRecordPages()
  .catch((error) => {
    console.error("Failed to group record pages:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
