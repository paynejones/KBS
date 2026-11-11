import { NextResponse, type NextRequest } from "next/server";
import { REQUEST_ID_HEADER, requestIdFor } from "@/lib/api-log";
import {
  SESSION_COOKIE,
  SIGN_IN_PATH,
  readAuthConfig,
  resolveAuthGate,
  safeNextPath,
  verifySessionToken,
} from "@/lib/auth";
import { readStoredPassword } from "@/lib/password-store";

let warnedAboutMissingAuth = false;

function noStore(response: NextResponse, requestId: string) {
  response.headers.set("Cache-Control", "no-store");
  response.headers.set(REQUEST_ID_HEADER, requestId);

  return response;
}

export function proxy(request: NextRequest) {
  // One ID for the whole request: handlers log it, responses return it, and a
  // caller-supplied value is kept only when it is header-safe.
  const requestId = requestIdFor(request);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(REQUEST_ID_HEADER, requestId);

  // A password changed in Settings is picked up here on the next request, so
  // no restart is needed to enforce it.
  const configResult = readAuthConfig(process.env, readStoredPassword());
  const configured = configResult.ok;
  const session = request.cookies.get(SESSION_COOKIE)?.value;
  const hasSession = configResult.ok && verifySessionToken(session, configResult.config);

  if (!configured && process.env.NODE_ENV !== "production" && !warnedAboutMissingAuth) {
    warnedAboutMissingAuth = true;
    console.warn(
      "KBS_AUTH_PASSWORD and KBS_AUTH_SECRET are not set, so the app is unauthenticated. Production refuses to serve without them.",
    );
  }

  const decision = resolveAuthGate({
    pathname: request.nextUrl.pathname,
    hasSession,
    configured,
    isProduction: process.env.NODE_ENV === "production",
  });

  if (decision === "allow") {
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set(REQUEST_ID_HEADER, requestId);

    return response;
  }

  if (decision === "unavailable") {
    const detail =
      !configResult.ok && configResult.reason === "weak-secret"
        ? "KBS_AUTH_SECRET must be at least 32 characters."
        : "Set KBS_AUTH_PASSWORD and KBS_AUTH_SECRET to enable sign-in.";
    const message = `Authentication is not configured. ${detail}`;

    if (request.nextUrl.pathname.startsWith("/api/")) {
      return noStore(NextResponse.json({ error: message }, { status: 503 }), requestId);
    }

    return noStore(
      new NextResponse(message, {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      }),
      requestId,
    );
  }

  if (decision === "unauthorized") {
    return noStore(
      NextResponse.json({ error: "Authentication required.", requestId }, { status: 401 }),
      requestId,
    );
  }

  if (decision === "redirect-home") {
    const target = safeNextPath(request.nextUrl.searchParams.get("next"));

    return noStore(
      NextResponse.redirect(new URL(target, request.nextUrl.origin)),
      requestId,
    );
  }

  const nextPath = safeNextPath(`${request.nextUrl.pathname}${request.nextUrl.search}`);
  const url = request.nextUrl.clone();
  url.pathname = SIGN_IN_PATH;
  url.search = "";
  if (nextPath !== "/") url.searchParams.set("next", nextPath);

  return noStore(NextResponse.redirect(url), requestId);
}

export const config = {
  // Static build output and the favicon must stay public so the sign-in page
  // can render. Everything else — including the image optimizer and attachments
  // — requires a session.
  matcher: ["/((?!_next/static|_next/webpack-hmr|favicon.ico).*)"],
};
