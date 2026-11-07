import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

export const REQUEST_ID_HEADER = "x-request-id";

const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;

/** Accepts a caller-supplied ID only when it is short and header-safe. */
export function normalizeRequestId(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();

  return SAFE_REQUEST_ID.test(trimmed) ? trimmed : null;
}

/**
 * The proxy forwards one ID to every handler, so a response header, an error
 * body, and the matching log line all agree.
 */
export function requestIdFor(request: Request): string {
  return normalizeRequestId(request.headers.get(REQUEST_ID_HEADER)) ?? randomUUID();
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    name: "NonError",
    message: typeof error === "string" ? error : "Unexpected error value",
  };
}

function requestPath(request: Request) {
  try {
    return new URL(request.url).pathname;
  } catch {
    return "unknown";
  }
}

/**
 * One line of JSON per failure so a host's log collector can index by
 * `requestId`, `path`, and `status` without parsing prose. Request headers,
 * cookies, and bodies are deliberately never logged: page content is private.
 */
export function logApiError(
  request: Request,
  message: string,
  error: unknown,
  requestId = requestIdFor(request),
) {
  console.error(
    JSON.stringify({
      level: "error",
      time: new Date().toISOString(),
      requestId,
      method: request.method,
      path: requestPath(request),
      message,
      error: serializeError(error),
    }),
  );

  return requestId;
}

export function apiErrorResponse(
  request: Request,
  message: string,
  error: unknown,
  options: { status?: number; logMessage?: string } = {},
) {
  const { status = 500, logMessage = message } = options;
  const requestId = logApiError(request, logMessage, error);

  return NextResponse.json(
    { error: message, requestId },
    {
      status,
      headers: {
        [REQUEST_ID_HEADER]: requestId,
        "Cache-Control": "no-store",
      },
    },
  );
}
