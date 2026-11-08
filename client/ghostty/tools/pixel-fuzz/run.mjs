// Fuzzes the terminal's renderer against another build's, pixel for pixel
// (fuzz.ts says how), and prints the frames that differ, by scale:
//
//   node client/ghostty/tools/pixel-fuzz/run.mjs <against> [options]
//
// <against> is another checkout's client/ghostty/src, main's say, or
// `self` for a whole frame of this one's at every step. Against another
// build every scale should match. Against itself only the scales where rows
// draw alike do (`rowsDrawAlike`), and only without diagonals: elsewhere
// the renderer draws as T3's did, which leaves traces a whole frame does
// not. Options:
// --seeds=40 --steps=200 --scales=1,1.1,1.25,1.5,1.6,1.75,2,2.25,3
// (1,2 for `self`), each as Chromium keeps it, a float --diagonals (lines
// with diagonals, which stand past their rows) --browsers=3 (seeds shared
// between that many Chromiums). Chromium is Playwright's own, or the one
// $CHROMIUM names.
import { createRequire } from "node:module"
import { resolve } from "node:path"
import { createServer } from "vite"

const here = import.meta.dirname
const [againstArg, ...flags] = process.argv.slice(2)
if (!againstArg) {
  console.error("usage: run.mjs <other checkout's client/ghostty/src | self>")
  process.exit(2)
}
const option = (name, fallback) =>
  flags.find((flag) => flag.startsWith(`--${name}=`))?.split("=")[1] ?? fallback
const self = againstArg === "self"
const against = self ? resolve(here, "../../src") : resolve(againstArg)
const seeds = Number(option("seeds", 40))
const steps = Number(option("steps", 200))
const scales = option(
  "scales",
  self ? "1,2" : "1,1.1,1.25,1.5,1.6,1.75,2,2.25,3"
)
  .split(",")
  .map(Number)
const diagonals = flags.includes("--diagonals")
const browsers = Number(option("browsers", 3))

// Playwright is the window's, for its end-to-end tests.
const { chromium } = createRequire(
  resolve(here, "../../../desktop/package.json")
)("@playwright/test")

const server = await createServer({
  root: here,
  configFile: false,
  logLevel: "warn",
  cacheDir: resolve(here, "../../node_modules/.vite-pixel-fuzz"),
  resolve: { alias: { "@against": against } },
  server: { port: 0, fs: { strict: false } },
})
await server.listen()
const url = `${server.resolvedUrls.local[0]}${self ? "?self" : ""}`

const started = Date.now()
const per = Math.ceil(seeds / browsers)
const shares = Array.from({ length: browsers }, (_, i) => [
  1 + i * per,
  Math.min(1 + seeds, 1 + (i + 1) * per),
]).filter(([from, to]) => from < to)
const failures = (
  await Promise.all(
    shares.map(async ([from, to]) => {
      const browser = await chromium.launch({
        executablePath: process.env.CHROMIUM,
        args: ["--force-color-profile=srgb"],
      })
      try {
        const page = await browser.newPage()
        page.on("pageerror", (error) => console.error("page:", error.message))
        await page.goto(url)
        await page.waitForFunction(() => window.ready === true, null, {
          timeout: 60_000,
        })
        return await page.evaluate((options) => window.fuzz(options), {
          from,
          to,
          scales,
          diagonals,
          steps,
        })
      } finally {
        await browser.close()
      }
    })
  )
).flat()
await server.close()

const byScale = Object.fromEntries(scales.map((scale) => [scale, 0]))
for (const failure of failures) byScale[failure.scale] += 1
for (const failure of failures) console.log(JSON.stringify(failure))
console.log(
  JSON.stringify({
    against: self ? "self" : against,
    seeds,
    steps,
    diagonals,
    seconds: Math.round((Date.now() - started) / 1000),
    failing: byScale,
  })
)
process.exit(failures.length === 0 ? 0 : 1)
