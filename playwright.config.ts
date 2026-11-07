import { defineConfig } from "@playwright/test";

const port = process.env.PLAYWRIGHT_PORT?.trim() || "3100";
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/browser",
  globalTeardown: "./tests/browser/global-teardown.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  reporter: "line",
  use: {
    baseURL,
    headless: true,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run test:browser:server",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 240_000,
  },
});
