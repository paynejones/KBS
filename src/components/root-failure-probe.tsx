"use client";

import { useEffect } from "react";

/**
 * The browser suite aliases this module into the root layout in its own build
 * (see `KBS_BROWSER_TEST` in next.config.ts); normal builds resolve to the
 * disabled component instead. Throwing from an effect rather than during render
 * keeps the failure on the client, where the root error boundary owns it,
 * instead of turning the document request into a server error.
 */
const FAILURE_PATH = "/__root-error";

export function RootFailureProbe() {
  useEffect(() => {
    // Read the location only after mount: a hook that needs URL data would
    // block prerendering for every route that renders the root layout.
    if (window.location.pathname === FAILURE_PATH) {
      throw new Error("Forced root layout failure for the browser suite.");
    }
  }, []);

  return null;
}
