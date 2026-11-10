// Bundles the main process (ESM) and the preload (CommonJS: a sandboxed
// preload cannot be a module) into out/, with the menu bar's icons beside
// main (src/tray.ts).
import { cpSync } from "node:fs"
import { build } from "esbuild"
import { CHANNELS } from "./src/channel.ts"
// The ACP adapters the app carries, bundled as it is imported (ADR 0059):
// the harnesses' host package.
import "../../platform/harnesses/adapters/build.mjs"

// A checkout is local; a name that is no channel stops the build, as it
// stops the engine's (engine/build.rs).
const channel = process.env.BANDA_CHANNEL || "local"
if (!(channel in CHANNELS)) {
  throw new Error(`BANDA_CHANNEL is stable, dev or local, not "${channel}".`)
}

const common = {
  bundle: true,
  platform: "node",
  target: "node22",
  external: ["electron"],
  // Places only, not the source's text: main reads them as it keeps a
  // Problem (ADR 0039, decision 9).
  sourcemap: true,
  sourcesContent: false,
  logLevel: "warning",
  // Banda's sidebar.toml template ships as text (src/sidebar.ts).
  loader: { ".toml": "text" },
  // Which Banda this is, fixed now (src/channel.ts, ADR 0033).
  define: { "process.env.BANDA_CHANNEL": JSON.stringify(channel) },
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
      // Loaded on an Agent's first browser tool (ADR 0029), not at start.
      "playwright-core",
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
    entryPoints: ["../../apps/browser/desktop/src/preload.ts"],
    outfile: "out/browser-preload.cjs",
    format: "cjs",
  }),
  build({
    ...common,
    entryPoints: ["src/preload.ts"],
    outfile: "out/preload.cjs",
    format: "cjs",
  }),
])

// The macOS menu bar's icons, drawn by icons/menu-bar/draw.mjs.
cpSync("icons/menu-bar", "out/menu-bar", {
  recursive: true,
  filter: (from) => !from.endsWith(".mjs"),
})
