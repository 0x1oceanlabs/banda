import js from "@eslint/js"
import globals from "globals"
import reactHooks from "eslint-plugin-react-hooks"
import reactRefresh from "eslint-plugin-react-refresh"
import tseslint from "typescript-eslint"
import { defineConfig, globalIgnores } from "eslint/config"

export default defineConfig([
  globalIgnores([
    "**/dist",
    "**/out",
    "**/node_modules",
    "sdk/contract/src/generated",
    "target",
    "client/desktop/test-results",
    // T3 Code's terminal adapter, vendored as it is: a newer pin is a copy.
    "client/ghostty/src/t3",
  ]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
  {
    // The window's main process has no React; Effect's `Service.use` is
    // not a hook (ADR 0020).
    files: [
      "client/desktop/src/**/*.ts",
      "client/desktop-kit/src/**/*.ts",
      "apps/*/desktop/src/**/*.ts",
      "platform/*/desktop/src/**/*.ts",
    ],
    rules: { "react-hooks/rules-of-hooks": "off" },
  },
])
