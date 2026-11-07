import assert from "node:assert/strict";
import test from "node:test";
import {
  REQUEST_ID_HEADER,
  apiErrorResponse,
  logApiError,
  normalizeRequestId,
  requestIdFor,
} from "../src/lib/api-log";

function captureConsoleError<T>(action: () => T): { result: T; lines: string[] } {
  const lines: string[] = [];
  const original = console.error;

  console.error = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };

  try {
    return { result: action(), lines };
  } finally {
    console.error = original;
  }
}

test("request IDs are accepted only when header-safe", () => {
  assert.equal(normalizeRequestId("req_01H8XYZ-abc.def:123"), "req_01H8XYZ-abc.def:123");
  assert.equal(normalizeRequestId("  abcdefgh  "), "abcdefgh");
  assert.equal(normalizeRequestId("short"), null);
  assert.equal(normalizeRequestId("has space in it"), null);
  assert.equal(normalizeRequestId("line\nbreak-abc"), null);
  assert.equal(normalizeRequestId("a".repeat(129)), null);
  assert.equal(normalizeRequestId(null), null);
  assert.equal(normalizeRequestId(""), null);
});

test("request IDs come from the proxy header or are generated", () => {
  const forwarded = new Request("https://kbs.example/api/pages", {
    headers: { [REQUEST_ID_HEADER]: "proxy-request-1234" },
  });
  assert.equal(requestIdFor(forwarded), "proxy-request-1234");

  const generated = requestIdFor(new Request("https://kbs.example/api/pages"));
  assert.match(generated, /^[0-9a-f-]{36}$/);

  const unsafe = new Request("https://kbs.example/api/pages", {
    headers: { [REQUEST_ID_HEADER]: "bad id with spaces" },
  });
  assert.notEqual(requestIdFor(unsafe), "bad id with spaces");
});

test("an API failure logs one structured line that matches the response", () => {
  const request = new Request("https://kbs.example/api/pages?q=secret", {
    method: "POST",
    headers: {
      [REQUEST_ID_HEADER]: "request-abc-12345",
      cookie: "kbs_session=secret-session-value",
      authorization: "Bearer secret-token",
    },
  });

  const { result: response, lines } = captureConsoleError(() =>
    apiErrorResponse(request, "Failed to create page.", new Error("column missing")),
  );

  assert.equal(response.status, 500);
  assert.equal(response.headers.get(REQUEST_ID_HEADER), "request-abc-12345");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(lines.length, 1);

  const entry = JSON.parse(lines[0]);

  assert.equal(entry.level, "error");
  assert.equal(entry.requestId, "request-abc-12345");
  assert.equal(entry.method, "POST");
  assert.equal(entry.path, "/api/pages");
  assert.equal(entry.message, "Failed to create page.");
  assert.equal(entry.error.name, "Error");
  assert.equal(entry.error.message, "column missing");
  assert.match(entry.error.stack, /column missing/);
  assert.equal(typeof entry.time, "string");

  // The response and the log must agree, and private request data must stay out.
  assert.equal(lines[0].includes("secret-session-value"), false);
  assert.equal(lines[0].includes("secret-token"), false);
  assert.equal(lines[0].includes("q=secret"), false);
});

test("error responses carry the request ID in the body for support reports", async () => {
  const request = new Request("https://kbs.example/api/backup", {
    headers: { [REQUEST_ID_HEADER]: "request-body-12345" },
  });

  const { result: response } = captureConsoleError(() =>
    apiErrorResponse(request, "Failed to create a backup.", new Error("disk full"), {
      status: 507,
      logMessage: "Backup write failed.",
    }),
  );

  const body = (await response.json()) as { error: string; requestId: string };
  assert.equal(body.error, "Failed to create a backup.");
  assert.equal(body.requestId, "request-body-12345");
});

test("a log call returns the ID it used", () => {
  const request = new Request("https://kbs.example/api/tags", {
    headers: { [REQUEST_ID_HEADER]: "request-log-12345" },
  });

  const { result: id, lines } = captureConsoleError(() =>
    logApiError(request, "Tag failure", "plain string failure"),
  );

  assert.equal(id, "request-log-12345");
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.error.name, "NonError");
  assert.equal(entry.error.message, "plain string failure");
});
