import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { isPasswordHash, verifyPasswordHash } from "@/lib/password-hash";

export const SESSION_COOKIE = "kbs_session";
export const SIGN_IN_PATH = "/signin";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

export const MAX_SIGN_IN_ATTEMPTS = 8;
export const SIGN_IN_ATTEMPT_WINDOW_MS = 10 * 60 * 1000;

const MIN_SECRET_LENGTH = 32;
const TOKEN_VERSION = "kbs.session.v1";

export type AuthConfig = {
  password: string;
  secret: string;
};

export type AuthConfigResult =
  | { ok: true; config: AuthConfig }
  | { ok: false; reason: "missing" | "weak-secret" };

export function readAuthConfig(
  env: Record<string, string | undefined> = process.env,
  storedPassword?: string | null,
): AuthConfigResult {
  const password = env.KBS_AUTH_PASSWORD?.trim() ?? "";
  const secret = env.KBS_AUTH_SECRET?.trim() ?? "";

  // The environment password is what makes sign-in configured; a password set
  // from Settings overrides it but never stands in for it, so removing the
  // stored credential always falls back to a known value.
  if (!password || !secret) return { ok: false, reason: "missing" };
  if (secret.length < MIN_SECRET_LENGTH) return { ok: false, reason: "weak-secret" };

  return { ok: true, config: { password: storedPassword?.trim() || password, secret } };
}

/**
 * Sessions are signed over the password credential as well as the expiry, so
 * changing the password (or the secret) invalidates every cookie immediately.
 * A password set from Settings is signed over its stored hash, which changes
 * with every rotation.
 */
function passwordFingerprint(password: string) {
  return createHash("sha256").update(password, "utf8").digest("base64url");
}

function sessionSignature(expiresAt: number, config: AuthConfig) {
  return createHmac("sha256", config.secret)
    .update(`${TOKEN_VERSION}\n${expiresAt}\n${passwordFingerprint(config.password)}`, "utf8")
    .digest();
}

export function createSessionToken(config: AuthConfig, nowMs = Date.now()): string {
  const expiresAt = Math.floor(nowMs / 1000) + SESSION_TTL_SECONDS;
  return `${expiresAt}.${sessionSignature(expiresAt, config).toString("base64url")}`;
}

export function verifySessionToken(
  token: string | null | undefined,
  config: AuthConfig,
  nowMs = Date.now(),
): boolean {
  if (!token) return false;

  const separator = token.indexOf(".");
  if (separator < 1) return false;

  const expiresPart = token.slice(0, separator);
  const signaturePart = token.slice(separator + 1);
  if (!/^\d{1,12}$/.test(expiresPart) || !/^[A-Za-z0-9_-]{43}$/.test(signaturePart)) {
    return false;
  }

  const expiresAt = Number(expiresPart);
  if (expiresAt * 1000 <= nowMs) return false;

  const expected = sessionSignature(expiresAt, config).toString("base64url");

  // Compare the encoded text, not decoded bytes: the final base64url character
  // carries unused bits, so two different strings can decode to the same bytes.
  return timingSafeEqual(Buffer.from(signaturePart), Buffer.from(expected));
}

export function verifyPassword(input: string, expected: string): boolean {
  // A password set from Settings arrives as its stored hash; the environment
  // password arrives as plain text and is compared by digest.
  if (isPasswordHash(expected)) return verifyPasswordHash(input, expected);

  const provided = createHash("sha256").update(input, "utf8").digest();
  const wanted = createHash("sha256").update(expected, "utf8").digest();

  return timingSafeEqual(provided, wanted);
}

/** Best-effort client identity for per-address sign-in throttling. */
export function requestClientAddress(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }

  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

/** Only same-origin absolute paths may be used as a post-sign-in destination. */
export function safeNextPath(value: string | null | undefined): string {
  if (!value || value.length > 2048) return "/";
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  if (value.includes("\\") || value.includes("\n") || value.includes("\r")) return "/";
  if (normalizePath(value.split("?")[0] ?? "") === SIGN_IN_PATH) return "/";

  return value;
}

function normalizePath(pathname: string) {
  const trimmed = pathname.replace(/\/+$/, "");

  return trimmed || "/";
}

export function isApiPath(pathname: string) {
  return pathname === "/api" || pathname.startsWith("/api/");
}

export function isSignInPath(pathname: string) {
  return normalizePath(pathname) === SIGN_IN_PATH;
}

export function isPublicAuthPath(pathname: string) {
  const path = normalizePath(pathname);

  return (
    path === SIGN_IN_PATH ||
    path === "/api/auth/login" ||
    path === "/api/auth/logout"
  );
}

export type AuthGateDecision =
  | "allow"
  | "redirect-sign-in"
  | "redirect-home"
  | "unauthorized"
  | "unavailable";

/**
 * A single answer for every request: allowed through, sent to the sign-in page,
 * bounced home from it, rejected as an API call, or refused because the server
 * is not configured. Production fails closed rather than serving unauthenticated
 * data; development stays open so local work needs no credentials.
 */
export function resolveAuthGate({
  pathname,
  hasSession,
  configured,
  isProduction,
}: {
  pathname: string;
  hasSession: boolean;
  configured: boolean;
  isProduction: boolean;
}): AuthGateDecision {
  if (!configured) return isProduction ? "unavailable" : "allow";
  if (hasSession) return isSignInPath(pathname) ? "redirect-home" : "allow";
  if (isPublicAuthPath(pathname)) return "allow";

  return isApiPath(pathname) ? "unauthorized" : "redirect-sign-in";
}

export function shouldUseSecureCookies(request: Request): boolean {
  const forwarded = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim()
    .toLowerCase();

  if (forwarded) return forwarded === "https";

  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}

export function sessionCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}

export function expiredSessionCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge: 0,
  };
}

export type AttemptRecord = {
  count: number;
  resetAt: number;
};

/**
 * Best-effort throttle for password guesses. It lives in one server process, so
 * a restarted server forgets the counters; a public host should also rate limit
 * at the proxy.
 */
export class SignInAttemptLimiter {
  private attempts = new Map<string, AttemptRecord>();

  constructor(
    private readonly maxAttempts = MAX_SIGN_IN_ATTEMPTS,
    private readonly windowMs = SIGN_IN_ATTEMPT_WINDOW_MS,
  ) {}

  isBlocked(key: string, nowMs = Date.now()): boolean {
    const record = this.attempts.get(key);
    if (!record) return false;

    if (record.resetAt <= nowMs) {
      this.attempts.delete(key);

      return false;
    }

    return record.count >= this.maxAttempts;
  }

  recordFailure(key: string, nowMs = Date.now()) {
    const record = this.attempts.get(key);

    if (!record || record.resetAt <= nowMs) {
      this.attempts.set(key, { count: 1, resetAt: nowMs + this.windowMs });

      return;
    }

    record.count += 1;
  }

  clear(key: string) {
    this.attempts.delete(key);
  }

  prune(nowMs = Date.now()) {
    for (const [key, record] of this.attempts) {
      if (record.resetAt <= nowMs) this.attempts.delete(key);
    }
  }

  get size() {
    return this.attempts.size;
  }
}
