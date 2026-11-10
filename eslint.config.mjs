import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import requireStrictFetchCleanup from "./eslint-rules/require-strict-fetch-cleanup.mjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["tests/dom/**/*.test.{ts,tsx}"],
    plugins: {
      local: {
        rules: {
          "require-strict-fetch-cleanup": requireStrictFetchCleanup,
        },
      },
    },
    rules: {
      "local/require-strict-fetch-cleanup": "error",
    },
  },
  {
    files: ["tests/dom/**/*.{ts,tsx}"],
    // The strict wrapper is the one place allowed to use the low-level helper.
    ignores: ["tests/dom/fetch-stub.ts", "tests/dom/strict-fetch-stub.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/fetch-stub"],
              importNames: ["stubFetch"],
              message:
                "Use stubStrictFetch from ./strict-fetch-stub and declare explicit routes instead of importing stubFetch directly.",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".next-browser-test/**",
    ".next-preview-ui/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
