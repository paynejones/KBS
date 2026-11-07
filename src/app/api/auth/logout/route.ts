import { NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  expiredSessionCookieOptions,
  shouldUseSecureCookies,
} from "@/lib/auth";

export async function POST(request: Request) {
  const response = new NextResponse(null, {
    status: 204,
    headers: { "Cache-Control": "no-store" },
  });
  response.cookies.set({
    name: SESSION_COOKIE,
    value: "",
    ...expiredSessionCookieOptions(shouldUseSecureCookies(request)),
  });

  return response;
}
