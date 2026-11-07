import { dropRecordedTestDatabase } from "./test-database-state";

export default async function globalTeardown() {
  await dropRecordedTestDatabase();
}
