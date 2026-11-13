"use client";

import { useEffect } from "react";

// The global boundary replaces the root layout, so it cannot rely on the app's
// stylesheet or theme. Everything here is inline and follows the OS scheme.
export default function GlobalError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const digest =
    typeof error === "object" && error !== null && "digest" in error
      ? (error as { digest?: unknown }).digest
      : undefined;

  return (
    <html lang="en">
      <head>
        <title>This page couldn’t load</title>
      </head>
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          colorScheme: "light dark",
          background: "light-dark(#f7f7f5, #0d121c)",
          color: "light-dark(#1c1c1a, #f3f4f6)",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        }}
      >
        <main
          style={{
            display: "grid",
            minHeight: "100vh",
            placeItems: "center",
            padding: 24,
          }}
        >
          <div
            role="alert"
            style={{
              width: "100%",
              maxWidth: 420,
              padding: 28,
              textAlign: "center",
              borderRadius: 12,
              border: "1px solid light-dark(#dddddd, #2a3242)",
              background: "light-dark(#ffffff, #141a26)",
            }}
          >
            <h1 style={{ margin: 0, fontSize: 20, lineHeight: 1.3 }}>
              This page couldn’t load
            </h1>
            <p
              style={{
                margin: "10px 0 0",
                fontSize: 14,
                lineHeight: 1.5,
                color: "light-dark(#5f5f5a, #a7afbd)",
              }}
            >
              A server error occurred. Reload to try again.
            </p>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                justifyContent: "center",
                gap: 8,
                marginTop: 18,
              }}
            >
              <button
                type="button"
                onClick={() => retry()}
                style={{
                  padding: "8px 14px",
                  borderRadius: 8,
                  border: "1px solid transparent",
                  background: "light-dark(#1c1c1a, #e8eaee)",
                  color: "light-dark(#ffffff, #11151c)",
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                Try again
              </button>
              {/* A plain form submit navigates even when the app's client
                  JavaScript is what failed. */}
              <form action="/" method="get" style={{ margin: 0 }}>
                <button
                  type="submit"
                  style={{
                    padding: "8px 14px",
                    borderRadius: 8,
                    border: "1px solid light-dark(#d4d4d0, #384154)",
                    background: "transparent",
                    color: "inherit",
                    font: "inherit",
                    fontSize: 14,
                    fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  Back to home
                </button>
              </form>
            </div>
            {typeof digest === "string" && digest ? (
              <p
                style={{
                  margin: "14px 0 0",
                  fontSize: 11,
                  color: "light-dark(#6b6b66, #8f98a8)",
                }}
              >
                Error {digest}
              </p>
            ) : null}
          </div>
        </main>
      </body>
    </html>
  );
}
