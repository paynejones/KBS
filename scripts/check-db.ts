import "dotenv/config";
import { sql } from "drizzle-orm";
import { db, pool } from "../src/db";

async function main() {
  try {
    const result = await db.execute(
      sql`select 1 as connected`
    );

    console.log("Database connection successful:", result);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Database connection failed:", error);
  process.exitCode = 1;
});