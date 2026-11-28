// Builds the driver of the Chromium an Agent's pages run in into dist/,
// which the engine runs on the Node its host provides (ADR 0132, decision
// 3), as it runs the adapters Banda carries
// (platform/harnesses/adapters/build.mjs): dist/browser-driver.mjs, the
// driver in one file, and Playwright beside it, in dist/node_modules,
// where Node finds it from there. Playwright is not in the file: it reads
// its own package.json and browsers.json from its folder as it loads, so
// it goes whole, as it is published. It asks for no package itself.
import { cpSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, "dist")
const playwright = dirname(
  createRequire(import.meta.url).resolve("playwright-core/package.json")
)

rmSync(out, { recursive: true, force: true })
await build({
  entryPoints: [join(here, "src/main.ts")],
  outfile: join(out, "browser-driver.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  minify: true,
  logLevel: "warning",
  external: ["playwright-core"],
})
// Without its types, which nothing runs, and the links pnpm keeps in it.
const LEFT = new Set(["node_modules", "types", "index.d.ts"])
cpSync(playwright, join(out, "node_modules/playwright-core"), {
  recursive: true,
  dereference: true,
  filter: (file) => !LEFT.has(relative(playwright, file).split(sep)[0]),
})
