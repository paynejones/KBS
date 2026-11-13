/**
 * Normal builds resolve `@/components/root-failure-probe` here (see
 * next.config.ts), so the browser suite's failure probe never ships.
 */
export function RootFailureProbe() {
  return null;
}
