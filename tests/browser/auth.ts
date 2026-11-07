import path from "node:path";

/**
 * Credentials for the browser suite's server. `next start` runs in production
 * mode, where the app refuses to serve anything unless sign-in is configured,
 * so the suite boots its own throwaway password instead of disabling the gate.
 */
export const BROWSER_TEST_PASSWORD = "kbs-browser-test-password";
export const BROWSER_TEST_SECRET = "kbs-browser-test-secret-4f8c2a9e1b7d6350";

export const BROWSER_TEST_PORT = process.env.PLAYWRIGHT_PORT?.trim() || "3100";
export const BROWSER_TEST_BASE_URL = `http://127.0.0.1:${BROWSER_TEST_PORT}`;

/** The signed-in session the global setup captures and every test reuses. */
export const BROWSER_AUTH_STATE = path.join(process.cwd(), "tests", ".browser-auth-state.json");
