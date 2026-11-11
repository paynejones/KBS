import { NextResponse } from "next/server";
import { z } from "zod";
import { apiErrorResponse } from "@/lib/api-log";
import {
  SESSION_COOKIE,
  SignInAttemptLimiter,
  createSessionToken,
  readAuthConfig,
  requestClientAddress,
  sessionCookieOptions,
  shouldUseSecureCookies,
  verifyPassword,
} from "@/lib/auth";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@/lib/password-policy";
import { readStoredPassword, writeStoredPassword } from "@/lib/password-store";

const limiter = new SignInAttemptLimiter();

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(MAX_PASSWORD_LENGTH),
  newPassword: z
    .string()
    .min(MIN_PASSWORD_LENGTH)
    .max(MAX_PASSWORD_LENGTH)
    .refine((value) => value.trim().length >= MIN_PASSWORD_LENGTH, {
      message: `Use at least ${MIN_PASSWORD_LENGTH} characters`,
    }),
});

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  const currentConfig = readAuthConfig(process.env, readStoredPassword());
  if (!currentConfig.ok) {
    return noStore({ error: "Sign-in is not configured on this server." }, 503);
  }

  const client = requestClientAddress(request);
  if (limiter.isBlocked(client)) {
    return NextResponse.json(
      { error: "Too many attempts. Wait a few minutes and try again." },
      {
        status: 429,
        headers: { "Cache-Control": "no-store", "Retry-After": "600" },
      },
    );
  }

  const body: unknown = await request.json().catch(() => null);
  const parsed = changePasswordSchema.safeParse(body);
  if (!parsed.success) {
    return noStore(
      { error: `Choose a new password of at least ${MIN_PASSWORD_LENGTH} characters.` },
      400,
    );
  }

  const { currentPassword, newPassword } = parsed.data;

  if (!verifyPassword(currentPassword, currentConfig.config.password)) {
    limiter.recordFailure(client);
    if (limiter.size > 1000) limiter.prune();

    return noStore({ error: "That password is not correct." }, 401);
  }

  if (verifyPassword(newPassword, currentConfig.config.password)) {
    return noStore(
      { error: "The new password must be different from the current one." },
      400,
    );
  }

  let stored: { material: string; updatedAt: string };
  try {
    stored = writeStoredPassword(newPassword);
  } catch (error) {
    return apiErrorResponse(request, "Could not save the new password", error, {
      status: 500,
      logMessage: "Failed to store the password credential:",
    });
  }

  limiter.clear(client);

  const nextConfig = readAuthConfig(process.env, stored.material);
  if (!nextConfig.ok) {
    return apiErrorResponse(
      request,
      "Could not save the new password",
      new Error("The stored credential did not produce a usable configuration"),
      { status: 500 },
    );
  }

  // The cookie is signed over the credential, so this is also the one browser
  // that stays signed in after a change.
  const response = noStore({ ok: true, updatedAt: stored.updatedAt });
  response.cookies.set({
    name: SESSION_COOKIE,
    value: createSessionToken(nextConfig.config),
    ...sessionCookieOptions(shouldUseSecureCookies(request)),
  });

  return response;
}
