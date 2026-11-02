// Bundles the main process (ESM) and the preload (CommonJS: a sandboxed
// preload cannot be a module) into out/.
import { build } from "esbuild"

// A checkout is local; a name that is no channel stops the build, as it
// stops the engine's (engine/build.rs).
const channel = process.env.BANDA_CHANNEL || "local"
if (!["stable", "dev", "local"].includes(channel)) {
  throw new Error(`BANDA_CHANNEL is stable, dev or local, not "${channel}".`)
}

const common = {
  bundle: true,
  platform: "node",
  target: "node22",
  external: ["electron"],
  sourcemap: true,
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
