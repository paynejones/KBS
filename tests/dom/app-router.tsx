import type { ReactNode } from "react";
import {
  AppRouterContext,
  type AppRouterInstance,
} from "next/dist/shared/lib/app-router-context.shared-runtime";

/**
 * Next's `useRouter()` throws unless the app router context is mounted. DOM
 * tests render components outside a Next app, so they supply that same context
 * with no-op navigation. A test that cares about navigation can override push.
 */
export function withAppRouter(
  node: ReactNode,
  router: Partial<AppRouterInstance> = {},
) {
  const instance: AppRouterInstance = {
    back: () => {},
    forward: () => {},
    refresh: () => {},
    push: () => {},
    replace: () => {},
    prefetch: () => {},
    bfcacheId: "_test_",
    ...router,
  };

  return (
    <AppRouterContext.Provider value={instance}>
      {node}
    </AppRouterContext.Provider>
  );
}
