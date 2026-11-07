import { defineConfig } from "@playwright/test";
import { BROWSER_AUTH_STATE, BROWSER_TEST_BASE_URL } from "./tests/browser/auth";

export default defineConfig({
  testDir: "./tests/browser",
  globalSetup: "./tests/browser/global-setup.ts",
  globalTeardown: "./tests/browser/global-teardown.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  reporter: "line",
  use: {
    baseURL: BROWSER_TEST_BASE_URL,
    headless: true,
    trace: "retain-on-failure",
    // A session saved by the global setup. Without it the password gate would
    // answer every page with a sign-in redirect and every API call with 401.
    storageState: BROWSER_AUTH_STATE,
  },
  webServer: {
    command: "npm run test:browser:server",
    url: BROWSER_TEST_BASE_URL,
    reuseExistingServer: false,
    timeout: 240_000,
  },
});
