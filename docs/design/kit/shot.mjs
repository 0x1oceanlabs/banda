#!/usr/bin/env node
// A picture of a mock page, taken the way Banda's mocks are checked
// (docs/design/README.md): headless Chromium, the fonts loaded, the marks
// settled. It prints where the picture is, and every error the page had.
//
//   node docs/design/kit/shot.mjs PAGE.html OUT.png [options]
//
//   --width 1440        the viewport's width (1440; check 728 too)
//   --height 900        the viewport's height
//   --selector "#id"    only that element
//   --clip X,Y,W,H      only that rectangle, in CSS pixels from the
//                       element's top left (or the page's); it may
//                       stand out past the element
//   --full              the whole page, not only the viewport
//   --light             the light theme: "light" in the URL's hash, and
//                       data-theme="light" on <html>
//   --solid             glass off: "solid" in the hash, and
//                       data-glass="off" on every .b-window
//   --hash x            other words for the page to read in its hash
//   --scale 2           the device pixel ratio (1)
//   --wait 600          ms for marks and blends to settle after the fonts
//   --type jpeg         png or jpeg; by default OUT's extension says
//   --quality 85        a JPEG's quality, 0 to 100 (85)
//   --chromium PATH     the browser to run; else $CHROMIUM, then the
//                       system's Chromium or Chrome, then Playwright's own
//
// It takes playwright-core from this checkout's node_modules (pnpm
// install), as scripts/drive.mjs does. A page error, a console error or a
// file that did not load is printed, and the exit code is 1.
import { execFileSync } from "node:child_process"
import { existsSync, readdirSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, extname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { parseArgs } from "node:util"

const here = dirname(fileURLToPath(import.meta.url))
const tree = resolve(here, "../../..")

const fail = (message) => {
  console.error(`shot.mjs: ${message}`)
  process.exit(2)
}

const usage =
  "usage: node docs/design/kit/shot.mjs PAGE.html OUT.png [--width 1440] [--height 900] [--selector '#id'] [--clip X,Y,W,H] [--full] [--light] [--solid] [--hash x] [--scale 2] [--wait 600] [--type png|jpeg] [--quality 85] [--chromium PATH]"

let parsed
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      width: { type: "string", default: "1440" },
      height: { type: "string", default: "900" },
      selector: { type: "string" },
      clip: { type: "string" },
      full: { type: "boolean", default: false },
      light: { type: "boolean", default: false },
      solid: { type: "boolean", default: false },
      hash: { type: "string" },
      scale: { type: "string", default: "1" },
      wait: { type: "string", default: "600" },
      type: { type: "string" },
      quality: { type: "string", default: "85" },
      chromium: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  })
} catch (error) {
  fail(`${error.message}\n${usage}`)
}
const { values: opt, positionals } = parsed
if (opt.help) {
  console.log(usage)
  process.exit(0)
}
if (positionals.length !== 2) fail(usage)
const [page, out] = positionals.map((p) => resolve(p))
if (!existsSync(page)) fail(`no page at ${page}`)

const type = opt.type ?? (/^\.jpe?g$/i.test(extname(out)) ? "jpeg" : "png")
if (type !== "png" && type !== "jpeg")
  fail(`--type is png or jpeg, not ${type}`)
const quality = Number(opt.quality)
if (!(quality >= 0 && quality <= 100)) fail("--quality is 0 to 100")
const clip = opt.clip?.split(",").map(Number)
if (clip && !(clip.length === 4 && clip.every(Number.isFinite)))
  fail("--clip is X,Y,WIDTH,HEIGHT")

/** playwright-core, from this checkout: the root's node_modules, or the
 * window's, which has it (client/desktop), or pnpm's store under the
 * root. */
function playwright() {
  const anchors = [
    join(tree, "package.json"),
    join(tree, "client/desktop/package.json"),
    join(tree, "apps/browser/desktop/package.json"),
  ]
  for (const anchor of anchors) {
    if (!existsSync(anchor)) continue
    try {
      return createRequire(anchor)("playwright-core")
    } catch {
      // not under this one
    }
  }
  const store = join(tree, "node_modules/.pnpm")
  if (existsSync(store)) {
    const found = readdirSync(store)
      .filter((name) => name.startsWith("playwright-core@"))
      .sort()
      .reverse()
    for (const name of found) {
      const dir = join(store, name, "node_modules/playwright-core")
      if (existsSync(join(dir, "package.json"))) {
        return createRequire(join(dir, "package.json"))(dir)
      }
    }
  }
  fail(
    `playwright-core is not in ${tree}'s node_modules: run pnpm install there`
  )
}

/** On the PATH, as `command -v` finds it. */
function onPath(name) {
  try {
    const found = execFileSync(
      process.platform === "win32" ? "where" : "which",
      [name],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    )
      .split(/\r?\n/)[0]
      .trim()
    return found && existsSync(found) ? found : undefined
  } catch {
    return undefined
  }
}

/** A Chromium to run: the one named, the system's, then Playwright's. */
function browserPath(chromium) {
  const named = opt.chromium ?? process.env.CHROMIUM
  if (named) {
    if (!existsSync(named)) fail(`no browser at ${named}`)
    return named
  }
  const places = [
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/snap/bin/chromium",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    join(
      process.env.PROGRAMFILES ?? "C:\\Program Files",
      "Google\\Chrome\\Application\\chrome.exe"
    ),
  ]
  const system =
    places.find((place) => existsSync(place)) ??
    ["chromium", "chromium-browser", "google-chrome", "chrome"]
      .map(onPath)
      .find(Boolean)
  if (system) return system
  const own = chromium.executablePath()
  if (own && existsSync(own)) return own
  fail(
    "no Chromium found: install one, name it with --chromium, or get Playwright's with `pnpm --filter @banda/desktop exec playwright-core install chromium`"
  )
}

const { chromium } = playwright()
const browser = await chromium.launch({
  headless: true,
  executablePath: browserPath(chromium),
  args: [
    "--force-color-profile=srgb",
    "--hide-scrollbars",
    "--font-render-hinting=none",
  ],
})
let errors = 0
try {
  const tab = await browser.newPage({
    viewport: { width: Number(opt.width), height: Number(opt.height) },
    deviceScaleFactor: Number(opt.scale),
  })
  tab.on("pageerror", (error) => {
    errors++
    console.error(`page error: ${error.message}`)
  })
  tab.on("console", (message) => {
    if (message.type() !== "error") return
    errors++
    console.error(`console: ${message.text()}`)
  })
  tab.on("requestfailed", (request) => {
    errors++
    console.error(
      `did not load: ${request.url()} (${request.failure()?.errorText})`
    )
  })
  const hash = [opt.light && "light", opt.solid && "solid", opt.hash]
    .filter(Boolean)
    .join("-")
  await tab.goto(pathToFileURL(page).href + (hash ? `#${hash}` : ""), {
    waitUntil: "load",
  })
  await tab.evaluate(
    ({ light, solid }) => {
      if (light) document.documentElement.setAttribute("data-theme", "light")
      if (solid) {
        for (const w of document.querySelectorAll(".b-window")) {
          w.setAttribute("data-glass", "off")
        }
      }
      window.dispatchEvent(new HashChangeEvent("hashchange"))
    },
    { light: opt.light, solid: opt.solid }
  )
  await tab.evaluate(() => document.fonts.ready)
  await tab.waitForTimeout(Number(opt.wait))
  const shot = { path: out, type, animations: "allow", caret: "hide" }
  if (type === "jpeg") shot.quality = quality
  if (clip) {
    // From the element's corner on the whole page, so the rectangle may
    // stand out past it, or past the viewport.
    const corner = opt.selector
      ? await tab
          .locator(opt.selector)
          .first()
          .evaluate((element) => {
            const box = element.getBoundingClientRect()
            return { x: box.left + scrollX, y: box.top + scrollY }
          })
      : { x: 0, y: 0 }
    const [x, y, width, height] = clip
    await tab.screenshot({
      ...shot,
      fullPage: true,
      clip: { x: corner.x + x, y: corner.y + y, width, height },
    })
  } else if (opt.selector) {
    const element = tab.locator(opt.selector).first()
    await element.scrollIntoViewIfNeeded()
    await tab.waitForTimeout(80)
    await element.screenshot(shot)
  } else {
    await tab.screenshot({ ...shot, fullPage: opt.full })
  }
  console.log(out)
} finally {
  await browser.close()
}
if (errors) process.exitCode = 1
