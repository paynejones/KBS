import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_SIGN_IN_ATTEMPTS,
  SESSION_TTL_SECONDS,
  UNVERIFIED_ATTEMPT_DELAY_MS,
  SignInAttemptLimiter,
  createSessionToken,
  readAuthConfig,
  recordFailedSignInAttempt,
  requestClientAddress,
  resolveAuthGate,
  safeNextPath,
  sessionCookieOptions,
  shouldUseSecureCookies,
  trustProxyHeaders,
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

test("forwarded addresses are read only from a trusted proxy, nearest hop last", () => {
  const forwarded = new Request("http://localhost/api/auth/login", {
    // The left hop is what the caller sent; the proxy appended the real one.
    headers: { "x-forwarded-for": "1.2.3.4, 203.0.113.9" },
  });

  assert.equal(requestClientAddress(forwarded, { trustProxy: false }), null);
  assert.equal(requestClientAddress(forwarded, { trustProxy: true }), "203.0.113.9");

  const single = new Request("http://localhost/", {
    headers: { "x-forwarded-for": "198.51.100.7" },
  });
  assert.equal(requestClientAddress(single, { trustProxy: true }), "198.51.100.7");

  const realIp = new Request("http://localhost/", {
    headers: { "x-real-ip": "198.51.100.8" },
  });
  assert.equal(requestClientAddress(realIp, { trustProxy: false }), null);
  assert.equal(requestClientAddress(realIp, { trustProxy: true }), "198.51.100.8");
  assert.equal(requestClientAddress(new Request("http://localhost/"), { trustProxy: true }), null);

  assert.equal(trustProxyHeaders({ KBS_TRUST_PROXY: "1" }), true);
  assert.equal(trustProxyHeaders({ KBS_TRUST_PROXY: " true " }), true);
  assert.equal(trustProxyHeaders({ KBS_TRUST_PROXY: "0" }), false);
  assert.equal(trustProxyHeaders({}), false);
});

test("a failed attempt with no address is delayed instead of filling a shared bucket", async () => {
  const limiter = new SignInAttemptLimiter(1, 60_000);
  const startedAt = Date.now();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await recordFailedSignInAttempt(limiter, null, { delayMs: 10 });
  }

  assert.equal(limiter.size, 0, "no shared bucket is created for anonymous callers");
  assert.equal(limiter.isBlocked("unknown"), false);
  assert.ok(Date.now() - startedAt >= 40, "every attempt paid the delay");

  const known = new SignInAttemptLimiter(1, 60_000);
  await recordFailedSignInAttempt(known, "203.0.113.9", { delayMs: 10 });
  assert.equal(known.isBlocked("203.0.113.9"), true, "a known address is counted and blocked");
  assert.equal(known.isBlocked("198.51.100.7"), false, "another address is unaffected");
  assert.equal(UNVERIFIED_ATTEMPT_DELAY_MS, 500);
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
