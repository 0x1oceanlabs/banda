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
}

await Promise.all([
  build({
    ...common,
    entryPoints: ["src/main.ts"],
    outfile: "out/main.mjs",
    format: "esm",
  }),
  build({
    ...common,
    entryPoints: ["src/preload.ts"],
    outfile: "out/preload.cjs",
    format: "cjs",
  }),
])
