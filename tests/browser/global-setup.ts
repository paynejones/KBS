import assert from "node:assert/strict";
import { request } from "@playwright/test";
import { BROWSER_AUTH_STATE, BROWSER_TEST_BASE_URL, BROWSER_TEST_PASSWORD } from "./auth";

/**
 * Signs in once through the real login route and stores the session cookie.
 * Playwright applies the saved state to both page and request fixtures, so the
 * specs exercise the same password gate a deployed workspace has.
 */
export default async function globalSetup() {
  const context = await request.newContext({ baseURL: BROWSER_TEST_BASE_URL });

  try {
    const response = await context.post("/api/auth/login", {
      data: { password: BROWSER_TEST_PASSWORD },
    });
    assert.equal(
      response.status(),
      200,
      `browser test sign-in failed with ${response.status()}: ${await response.text()}`,
    );
    await context.storageState({ path: BROWSER_AUTH_STATE });
  } finally {
    await context.dispose();
  }
}
