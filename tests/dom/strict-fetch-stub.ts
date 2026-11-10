import assert from "node:assert/strict";
import { json, restoreFetch, stubFetch, type FetchCall } from "./fetch-stub";

type StrictFetchRoute = (call: FetchCall) => Response | undefined;
type ActiveStub = { label: string; unhandled: FetchCall[] };

const activeStubs: ActiveStub[] = [];

/**
 * Wraps stubFetch with an explicit route table. A route that returns undefined
 * is unhandled: it gets a visible 500 response and fails cleanup with its
 * method and URL instead of silently succeeding.
 */
export function stubStrictFetch(
  label: string,
  route: StrictFetchRoute,
): FetchCall[] {
  const active: ActiveStub = { label, unhandled: [] };
  activeStubs.push(active);

  return stubFetch((call) => {
    const response = route(call);
    if (response) return response;

    active.unhandled.push(call);
    return json(
      { error: `Unhandled ${label} request: ${call.method} ${call.url}` },
      500,
    );
  });
}

export function restoreStrictFetch() {
  const stubs = activeStubs.splice(0);
  restoreFetch();

  const failures = stubs
    .filter((stub) => stub.unhandled.length > 0)
    .map(
      (stub) =>
        `${stub.label} made unhandled requests:\n${stub.unhandled
          .map((call) => `${call.method} ${call.url}`)
          .join("\n")}`,
    );
  if (failures.length > 0) assert.fail(failures.join("\n\n"));
}
