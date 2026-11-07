import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_SIGN_IN_ATTEMPTS,
  SESSION_TTL_SECONDS,
  SignInAttemptLimiter,
  createSessionToken,
  readAuthConfig,
  resolveAuthGate,
  safeNextPath,
  sessionCookieOptions,
  shouldUseSecureCookies,
  verifyPassword,
  verifySessionToken,
  type AuthConfig,
} from "../src/lib/auth";

const config: AuthConfig = {
  password: "correct horse battery staple",
  secret: "0123456789abcdef0123456789abcdef",
};

test("auth configuration needs both values and a long secret", () => {
  assert.deepEqual(readAuthConfig({}), { ok: false, reason: "missing" });
  assert.deepEqual(readAuthConfig({ KBS_AUTH_PASSWORD: "pw" }), {
    ok: false,
    reason: "missing",
  });
  assert.deepEqual(
    readAuthConfig({ KBS_AUTH_PASSWORD: "pw", KBS_AUTH_SECRET: "short" }),
    { ok: false, reason: "weak-secret" },
  );
  assert.deepEqual(
    readAuthConfig({
      KBS_AUTH_PASSWORD: "  pw  ",
      KBS_AUTH_SECRET: "x".repeat(32),
    }),
    { ok: true, config: { password: "pw", secret: "x".repeat(32) } },
  );
});

test("password comparison accepts the configured password only", () => {
  assert.equal(verifyPassword(config.password, config.password), true);
  assert.equal(verifyPassword("Correct horse battery staple", config.password), false);
  assert.equal(verifyPassword("", config.password), false);
  assert.equal(verifyPassword(config.password, "different"), false);
});

test("session tokens round trip and expire after thirty days", () => {
  const now = 1_700_000_000_000;
  const token = createSessionToken(config, now);

  assert.equal(verifySessionToken(token, config, now), true);
  assert.equal(
    verifySessionToken(token, config, now + (SESSION_TTL_SECONDS - 1) * 1000),
    true,
  );
  assert.equal(
    verifySessionToken(token, config, now + SESSION_TTL_SECONDS * 1000),
    false,
  );
});

test("session tokens reject tampering, other secrets, and password changes", () => {
  const now = 1_700_000_000_000;
  const token = createSessionToken(config, now);
  const [expiresPart, signaturePart] = token.split(".");
  const flipped = signaturePart.endsWith("A")
    ? `${signaturePart.slice(0, -1)}B`
    : `${signaturePart.slice(0, -1)}A`;

  assert.equal(verifySessionToken(`${Number(expiresPart) + 60}.${signaturePart}`, config, now), false);
  assert.equal(verifySessionToken(`${expiresPart}.${flipped}`, config, now), false);
  assert.equal(verifySessionToken(`${expiresPart}`, config, now), false);
  assert.equal(verifySessionToken("not-a-token", config, now), false);
  assert.equal(verifySessionToken("", config, now), false);
  assert.equal(verifySessionToken(undefined, config, now), false);
  assert.equal(
    verifySessionToken(token, { ...config, secret: "y".repeat(32) }, now),
    false,
  );
  assert.equal(
    verifySessionToken(token, { ...config, password: "a new password" }, now),
    false,
  );
});

test("post-sign-in redirects stay on this origin", () => {
  assert.equal(safeNextPath("/pages/123?tab=content"), "/pages/123?tab=content");
  assert.equal(safeNextPath("/"), "/");
  assert.equal(safeNextPath(null), "/");
  assert.equal(safeNextPath(""), "/");
  assert.equal(safeNextPath("//evil.example"), "/");
  assert.equal(safeNextPath("https://evil.example"), "/");
  assert.equal(safeNextPath("/\\evil.example"), "/");
  assert.equal(safeNextPath("/signin"), "/");
  assert.equal(safeNextPath("/signin?next=/pages"), "/");
  assert.equal(safeNextPath(`/${"a".repeat(2048)}`), "/");
});

test("the gate redirects pages, rejects API calls, and lets sign-in through", () => {
  const gate = (overrides: Partial<Parameters<typeof resolveAuthGate>[0]>) =>
    resolveAuthGate({
      pathname: "/",
      hasSession: false,
      configured: true,
      isProduction: true,
      ...overrides,
    });

  assert.equal(gate({ pathname: "/pages/123" }), "redirect-sign-in");
  assert.equal(gate({ pathname: "/api/pages" }), "unauthorized");
  assert.equal(gate({ pathname: "/api" }), "unauthorized");
  assert.equal(gate({ pathname: "/api/attachments/abc" }), "unauthorized");
  assert.equal(gate({ pathname: "/signin" }), "allow");
  assert.equal(gate({ pathname: "/signin/" }), "allow");
  assert.equal(gate({ pathname: "/api/auth/login" }), "allow");
  assert.equal(gate({ pathname: "/api/auth/logout" }), "allow");
  assert.equal(gate({ pathname: "/signin", hasSession: true }), "redirect-home");
  assert.equal(gate({ pathname: "/pages/123", hasSession: true }), "allow");
  assert.equal(gate({ pathname: "/", configured: false }), "unavailable");
  assert.equal(
    gate({ pathname: "/api/pages", configured: false }),
    "unavailable",
  );
  assert.equal(
    gate({ pathname: "/", configured: false, isProduction: false }),
    "allow",
  );
  assert.equal(
    gate({ pathname: "/api/pages", configured: false, isProduction: false }),
    "allow",
  );
});

test("sign-in attempts are throttled per client and reset with the window", () => {
  const limiter = new SignInAttemptLimiter(2, 1000);

  limiter.recordFailure("1.2.3.4", 0);
  limiter.recordFailure("1.2.3.4", 100);
  assert.equal(limiter.isBlocked("1.2.3.4", 200), true);
  assert.equal(limiter.isBlocked("5.6.7.8", 200), false);
  assert.equal(limiter.isBlocked("1.2.3.4", 1200), false);

  limiter.recordFailure("5.6.7.8", 200);
  limiter.clear("5.6.7.8");
  assert.equal(limiter.isBlocked("5.6.7.8", 300), false);

  const defaultLimiter = new SignInAttemptLimiter();
  for (let attempt = 0; attempt < MAX_SIGN_IN_ATTEMPTS; attempt += 1) {
    defaultLimiter.recordFailure("9.9.9.9", 0);
  }
  assert.equal(defaultLimiter.isBlocked("9.9.9.9", 1), true);
});

test("session cookies are httpOnly, lax, and secure only over HTTPS", () => {
  const options = sessionCookieOptions(true);

  assert.equal(options.httpOnly, true);
  assert.equal(options.sameSite, "lax");
  assert.equal(options.path, "/");
  assert.equal(options.maxAge, SESSION_TTL_SECONDS);
  assert.equal(options.secure, true);
  assert.equal(sessionCookieOptions(false).secure, false);

  assert.equal(shouldUseSecureCookies(new Request("http://localhost:3000/")), false);
  assert.equal(shouldUseSecureCookies(new Request("https://example.com/")), true);
  assert.equal(
    shouldUseSecureCookies(
      new Request("http://internal:3000/", { headers: { "x-forwarded-proto": "https" } }),
    ),
    true,
  );
  assert.equal(
    shouldUseSecureCookies(
      new Request("https://internal/", { headers: { "x-forwarded-proto": "http" } }),
    ),
    false,
  );
});
