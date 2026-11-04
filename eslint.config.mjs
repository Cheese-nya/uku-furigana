import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@next/next/no-img-element": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "ios/**",
    "android/**",
    "next-env.d.ts",
    // Local scratch, vendored assets, and the app's own session worktrees are not source.
    ".claude/**",
    // Private cloud edition working tree, ignored locally via .git/info/exclude.
    "cloud-private/**",
    "public/vendor/**",
    "tests/.tmp/**",
  ]),
]);

export default eslintConfig;
