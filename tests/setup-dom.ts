import { JSDOM } from "jsdom";

/**
 * Installs a jsdom window on the Node globals so React DOM and Testing Library
 * can render client components under `node:test`. Import this module first.
 */
const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});

const scope = globalThis as unknown as Record<string, unknown>;
const jsdomWindow = dom.window as unknown as Record<string, unknown>;

scope.window = dom.window;
scope.document = dom.window.document;
// Next.js client code (request-idle-callback) reads `self` on the global scope.
scope.self = dom.window;

for (const key of [
  "HTMLElement",
  "HTMLInputElement",
  "HTMLSelectElement",
  "HTMLButtonElement",
  "HTMLAnchorElement",
  "SVGElement",
  "Element",
  "Node",
  "NodeList",
  "Event",
  "MouseEvent",
  "KeyboardEvent",
  "CustomEvent",
  "File",
  "FileList",
  "FormData",
  "Blob",
  "MutationObserver",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
]) {
  scope[key] = jsdomWindow[key];
}

for (const key of ["navigator", "localStorage", "sessionStorage"]) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value: jsdomWindow[key],
  });
}

scope.IS_REACT_ACT_ENVIRONMENT = true;
