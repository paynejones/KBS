export type FetchCall = {
  url: string;
  method: string;
  body: unknown;
};

let originalFetch: typeof fetch | null = null;

/** Replaces global fetch, records each parsed request, and returns the call log. */
export function stubFetch(handler: (call: FetchCall) => Response): FetchCall[] {
  originalFetch ??= globalThis.fetch;
  const calls: FetchCall[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    let body: unknown = null;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    const call: FetchCall = {
      url: String(input),
      method: (init?.method ?? "GET").toUpperCase(),
      body,
    };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;

  return calls;
}

export function restoreFetch() {
  if (originalFetch) {
    globalThis.fetch = originalFetch;
    originalFetch = null;
  }
}

export function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}
