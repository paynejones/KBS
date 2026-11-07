import { rm } from "node:fs/promises";
import { BROWSER_AUTH_STATE } from "./auth";
import { dropRecordedTestDatabase } from "./test-database-state";

export default async function globalTeardown() {
  await dropRecordedTestDatabase();
  await rm(BROWSER_AUTH_STATE, { force: true });
}
