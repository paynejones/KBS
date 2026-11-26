import { NextResponse } from "next/server";
import { z } from "zod";
import {
  SESSION_COOKIE,
  SignInAttemptLimiter,
  createSessionToken,
  readAuthConfig,
  recordFailedSignInAttempt,
  requestClientAddress,
  safeNextPath,
  sessionCookieOptions,
  shouldUseSecureCookies,
  verifyPassword,
} from "@/lib/auth";
import { readStoredPassword } from "@/lib/password-store";

const limiter = new SignInAttemptLimiter();

const signInSchema = z.object({
  password: z.string().min(1).max(1024),
  // The sign-in form sends `null` when the URL has no `next` parameter, which
  // is the normal case for a direct visit to /signin. Rejecting it turned
  // every such sign-in into a 400.
  next: z.string().max(2048).nullish(),
});

function tooManyAttempts() {
  return NextResponse.json(
    { error: "Too many attempts. Wait a few minutes and try again." },
    {
      status: 429,
      headers: { "Cache-Control": "no-store", "Retry-After": "600" },
    },
  );
}

export async function POST(request: Request) {
  const configResult = readAuthConfig(process.env, readStoredPassword());
  if (!configResult.ok) {
    return NextResponse.json(
      { error: "Sign-in is not configured on this server." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const client = requestClientAddress(request);
  // A throttled address still gets its password checked: only a wrong guess is
  // refused, so a spent allowance can slow the owner down but never lock them
  // out, and no caller can turn the throttle into a denial of service.
  const throttled = client !== null && limiter.isBlocked(client);

  const body: unknown = await request.json().catch(() => null);
  const parsed = signInSchema.safeParse(body);
  if (!parsed.success) {
    await recordFailedSignInAttempt(limiter, client);
    if (throttled) return tooManyAttempts();

    return NextResponse.json(
      { error: "Enter the workspace password." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (!verifyPassword(parsed.data.password, configResult.config.password)) {
    await recordFailedSignInAttempt(limiter, client);
    if (throttled) return tooManyAttempts();

    return NextResponse.json(
      { error: "That password is not correct." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (client) limiter.clear(client);

  const response = NextResponse.json(
    { redirectTo: safeNextPath(parsed.data.next) },
    { headers: { "Cache-Control": "no-store" } },
  );
  response.cookies.set({
    name: SESSION_COOKIE,
    value: createSessionToken(configResult.config),
    ...sessionCookieOptions(shouldUseSecureCookies(request)),
  });

  return response;
}
