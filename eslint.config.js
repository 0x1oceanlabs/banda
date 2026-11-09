import js from "@eslint/js"
import globals from "globals"
import reactHooks from "eslint-plugin-react-hooks"
import reactRefresh from "eslint-plugin-react-refresh"
import tseslint from "typescript-eslint"
import { defineConfig, globalIgnores } from "eslint/config"

/** The client's core (ADR 0089, decision 1). */
const CORE = "client/core/src/**/*.{ts,tsx}"

/** What the core never imports (ADR 0089, decision 11): no DOM renderer,
 * no Electron or Node, no kit, no page, no desktop, no App or platform
 * part. It takes the contract, and React only in its bindings. Each block
 * adds the DOM renderer's rule, which a test of the bindings bends. */
const NO_DOM = {
  regex: "^react-dom(/.*)?$",
  message: "The core draws nothing: no react-dom (ADR 0089).",
}
const CORE_BORDERS = [
  {
    regex: "^(electron(/.*)?|node:.*)$",
    message: "The core runs on every client: no Electron or Node (ADR 0089).",
  },
  {
    regex:
      "^@banda/(ui|web|desktop|desktop-kit|[\\w-]+-pane|[\\w-]+-desktop)(/.*)?$",
    message:
      "The core imports no kit, no page, no desktop and no App: they import it (ADR 0089).",
  },
]

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
  {
    // The client's core reads no device (ADR 0089, decision 1): what only
    // a browser or the desktop has comes through the Window's device
    // port, never as a global.
    files: [CORE],
    rules: {
      "no-restricted-globals": [
        "error",
        ...[
          "window",
          "document",
          "localStorage",
          "sessionStorage",
          "navigator",
          "location",
          "process",
        ].map((name) => ({
          name,
          message:
            "The core has no device: the Window's device port has it (ADR 0089).",
        })),
      ],
      "no-restricted-imports": [
        "error",
        { patterns: [NO_DOM, ...CORE_BORDERS] },
      ],
    },
  },
  {
    // Its React bindings are `@banda/core/react`: the rest of it imports
    // no React, so Electron main and a worker can take it in.
    files: [CORE],
    ignores: ["client/core/src/react/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            NO_DOM,
            ...CORE_BORDERS,
            {
              regex: "^react(/.*)?$",
              message: "Only client/core/src/react imports React (ADR 0089).",
            },
          ],
        },
      ],
    },
  },
  {
    // A test of the React bindings draws to text, as the page's tests do.
    files: ["client/core/src/react/**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { ...NO_DOM, regex: "^react-dom(?!/server$)(/.*)?$" },
            ...CORE_BORDERS,
          ],
        },
      ],
    },
  },
])
