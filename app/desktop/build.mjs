// Bundles the main process (ESM) and the preload (CommonJS: a sandboxed
// preload cannot be a module) into out/.
import { build } from "esbuild"

const common = {
  bundle: true,
  platform: "node",
  target: "node22",
  external: ["electron"],
  sourcemap: true,
  logLevel: "warning",
  // Banda's sidebar.toml template ships as text (src/sidebar.ts).
  loader: { ".toml": "text" },
}

await Promise.all([
  build({
    ...common,
    // These packages find their own preloads in node_modules.
    external: [
      ...common.external,
      "electron-chrome-extensions",
      "electron-chrome-web-store",
      "@ghostery/adblocker-electron",
    ],
    entryPoints: ["src/main.ts"],
    outfile: "out/main.mjs",
    format: "esm",
    // CommonJS packages bundled in, as `ws` under Effect's HTTP server,
    // require Node's modules: an ES module has no `require` of its own.
    banner: {
      js: 'import { createRequire as bandaRequire } from "node:module"; const require = bandaRequire(import.meta.url);',
    },
  }),
  build({
    ...common,
    entryPoints: ["src/preload.ts"],
    outfile: "out/preload.cjs",
    format: "cjs",
  }),
])
