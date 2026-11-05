#!/usr/bin/env node
// Drives the window of a trial that scripts/try.sh opened, so an Agent
// that changes Banda sees and works the result as the Person would: it
// takes pictures, reads what the page shows, clicks, types and presses
// keys. It reaches the window over CDP, on the port Chromium writes in
// the trial's window profile (try.sh starts every trial with one).
//
//   scripts/drive.mjs [--trial SLUG] [--page N | --tab N] COMMAND [ARGS]
//
//   started             waits until the window's start went well, as Banda
//                       counts it (its workspaces drawn, up for 5 s), or
//                       says what it shows instead
//   pages               the trial's windows, its main one first, for --page;
//                       and its browser's tabs, for --tab
//   shot [SELECTOR]     a picture of the page, or of one element; prints
//                       where it is
//   snapshot [SELECTOR] what the page shows, as its accessibility tree
//   click TARGET        TARGET is a Playwright selector, as
//                       'role=button[name="Settings"]' or 'text=No Project',
//                       or X,Y in the page; --right, --double
//   hover TARGET
//   drag FROM TO        from one TARGET to another, as a mouse does
//   fill SELECTOR TEXT  replaces a field's text
//   type TEXT           types where the focus is
//   press KEY...        each in turn, as Alt+Space, Escape, Control+Enter
//   wait SELECTOR       until it shows, or with --gone until it goes
//   eval JS             runs JS in the page; prints what it gives, as JSON
//   size WIDTH HEIGHT   resizes the window (a window on the screen is the
//                       compositor's to size: use a --hidden trial)
//   close               closes the window as the Person does
//
// SLUG is the trial's, as try.sh names it: by default this tree's.
// --timeout MS is how long an action or wait has (5 s, a wait 10 s).
// A hidden window's picture may draw a tab out of its place: --tab takes
// the tab's own.
import { execFileSync } from "node:child_process"
import { readFileSync, readlinkSync, mkdirSync } from "node:fs"
import { createRequire } from "node:module"
import { basename, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"

const tree = dirname(dirname(fileURLToPath(import.meta.url)))
const trials =
  process.env.BANDA_TRIALS ??
  join(
    process.env.XDG_STATE_HOME ?? join(process.env.HOME, ".local/state"),
    "banda-trial"
  )

const fail = (message) => {
  console.error(`drive.mjs: ${message}`)
  process.exit(2)
}
// Playwright's own message says what was not there, and for how long.
process.on("uncaughtException", (error) =>
  fail(String(error?.message ?? error).split("\n")[0])
)

const { values: options, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    trial: { type: "string" },
    page: { type: "string" },
    tab: { type: "string" },
    timeout: { type: "string" },
    right: { type: "boolean" },
    double: { type: "boolean" },
    gone: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
})
if (options.help) {
  const text = readFileSync(fileURLToPath(import.meta.url), "utf8")
  const head = text.split("\nimport ")[0].split("\n").slice(1)
  console.log(head.map((line) => line.replace(/^\/\/ ?/, "")).join("\n"))
  process.exit(0)
}
const [command, ...rest] = positionals
if (!command) fail("no command: see --help")

const slug = options.trial ?? basename(tree)
const trial = join(trials, slug)
const profile = join(trial, "state/window")

// The window runs while Chromium holds its profile's lock, a link to
// `<host>-<pid>`; it leaves its port's file behind when it closes.
let pid
try {
  pid = Number(readlinkSync(join(profile, "SingletonLock")).split("-").pop())
  process.kill(pid, 0)
} catch {
  fail(`no window of the trial ${slug} runs: scripts/try.sh --detach ${slug}`)
}
let port
try {
  port = readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")
} catch {
  fail(
    `the trial ${slug} runs without CDP: close its window, then try.sh again`
  )
}
if (command === "close") {
  // Browser.close lets main stop the engine as a closed window does; a
  // signal would leave a crash behind.
  // The window goes without a word, so the socket breaks once it is told.
  const socket = new WebSocket(`ws://127.0.0.1:${port[0]}${port[1]}`)
  let told = false
  socket.onopen = () => {
    socket.send(JSON.stringify({ id: 1, method: "Browser.close" }))
    told = true
  }
  await new Promise((done) => (socket.onclose = done))
  if (!told) fail(`the trial ${slug} did not answer on CDP`)
  console.log(`Closed the trial ${slug}.`)
  process.exit(0)
}

const require = createRequire(join(tree, "app/desktop/package.json"))
const { chromium } = require("playwright-core")
const pause = (ms) => new Promise((done) => setTimeout(done, ms))

/** The trial's windows, its main one first. It may take a moment to show
 * its page. */
async function windows() {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port[0]}`)
  for (let tries = 0; ; tries++) {
    const own = browser
      .contexts()
      .flatMap((context) => context.pages())
      .filter((page) => page.url().startsWith("app://banda/"))
    if (own.length || tries === 20)
      return own.sort((a, b) => a.url().length - b.url().length)
    await pause(250)
  }
}

/** The browser's tabs, on the browser's own CDP endpoint (ADR 0013,
 * decision 7), which the trial's `banda browser` prints while the window
 * serves it: the window's shows them as webviews, which Playwright does
 * not drive. */
async function tabs() {
  let endpoint
  try {
    endpoint = execFileSync(join(trial, "bin/banda"), ["browser"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      env: { ...process.env, BANDA_STATE: join(trial, "state") },
    }).trim()
  } catch {
    return []
  }
  const browser = await chromium.connectOverCDP(endpoint)
  return browser.contexts().flatMap((context) => context.pages())
}

if (command === "pages") {
  const [own, theirs] = await Promise.all([windows(), tabs()])
  const titles = await Promise.all(theirs.map((tab) => tab.title()))
  for (const [at, each] of own.entries())
    console.log(`--page ${at + 1}  ${each.url()}`)
  for (const [at, each] of theirs.entries())
    console.log(`--tab ${at + 1}  ${each.url()}  ${titles[at]}`)
  process.exit(0)
}
const kind = options.tab ? "tab" : "page"
const at = options[kind] ?? 1
const page = (await (kind === "tab" ? tabs() : windows()))[Number(at) - 1]
if (!page) fail(`no ${kind} ${at}: see the pages command`)
page.setDefaultTimeout(
  Number(options.timeout ?? { started: 20_000, wait: 10_000 }[command] ?? 5_000)
)

/** A point in the page, as X,Y; else a selector's element. */
const pointOf = (target) => {
  const match = /^(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)$/.exec(target ?? "")
  return match && { x: Number(match[1]), y: Number(match[2]) }
}
const want = (value, what) => value ?? fail(`${command} wants ${what}`)
/** The middle of TARGET, where the mouse goes for it. */
async function middleOf(target) {
  const point = pointOf(target)
  if (point) return point
  const box = await page.locator(target).boundingBox()
  if (!box) fail(`${target} is not shown`)
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

switch (command) {
  case "started":
    // The page counts the starts that did not go well, and forgets them
    // once one stays up 5 s with its workspaces drawn
    // (app/web/src/safe/starts.ts). It checks on a timer: a window out of
    // sight draws no frames.
    try {
      await page.waitForFunction(
        () => performance.now() > 5000 && !localStorage.getItem("banda.starts"),
        null,
        { polling: 250 }
      )
    } catch {
      const shows = await page.locator("h1, h2").first().textContent()
      fail(`the window's start did not go well; it shows "${shows}"`)
    }
    console.log("The window started.")
    break
  case "shot": {
    const stamp = new Date().toISOString().replace(/\D/g, "").slice(8, 14)
    const file = join(trial, "shots", `${stamp}.png`)
    mkdirSync(dirname(file), { recursive: true })
    const shown = rest[0] ? page.locator(rest[0]) : page
    await shown.screenshot({ path: file })
    console.log(file)
    break
  }
  case "snapshot":
    console.log(await page.locator(rest[0] ?? "body").ariaSnapshot())
    break
  case "click": {
    const target = want(rest[0], "a TARGET")
    const how = {
      button: options.right ? "right" : "left",
      clickCount: options.double ? 2 : 1,
    }
    const point = pointOf(target)
    if (point) await page.mouse.click(point.x, point.y, how)
    else await page.locator(target).click(how)
    console.log(`Clicked ${target}.`)
    break
  }
  case "hover": {
    const target = want(rest[0], "a TARGET")
    const point = pointOf(target)
    if (point) await page.mouse.move(point.x, point.y)
    else await page.locator(target).hover()
    console.log(`Hovering ${target}.`)
    break
  }
  case "drag": {
    const from = await middleOf(want(rest[0], "FROM and TO"))
    const to = await middleOf(want(rest[1], "FROM and TO"))
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(to.x, to.y, { steps: 12 })
    await page.mouse.up()
    console.log(`Dragged ${rest[0]} to ${rest[1]}.`)
    break
  }
  case "fill":
    await page.locator(want(rest[0], "a SELECTOR")).fill(want(rest[1], "TEXT"))
    console.log(`Filled ${rest[0]}.`)
    break
  case "type":
    await page.keyboard.type(want(rest[0], "TEXT"))
    console.log("Typed.")
    break
  case "press":
    want(rest[0], "a KEY")
    for (const key of rest) await page.keyboard.press(key)
    console.log(`Pressed ${rest.join(", ")}.`)
    break
  case "wait": {
    const target = want(rest[0], "a SELECTOR")
    const state = options.gone ? "hidden" : "visible"
    await page.locator(target).first().waitFor({ state })
    console.log(options.gone ? `${target} went.` : `${target} shows.`)
    break
  }
  case "eval": {
    const value = await page.evaluate(want(rest[0], "JS"))
    console.log(JSON.stringify(value, null, 2) ?? "undefined")
    break
  }
  case "size": {
    const [width, height] = [Number(rest[0]), Number(rest[1])]
    if (!(width > 0 && height > 0)) fail("size wants WIDTH HEIGHT")
    // Electron's CDP has no Browser.setWindowBounds; a page may resize
    // its window, and Banda lets it.
    await page.evaluate(([w, h]) => window.resizeTo(w, h), [width, height])
    await page.waitForFunction(
      ([w, h]) => outerWidth === w && outerHeight === h,
      [width, height],
      { polling: 250 }
    )
    console.log(`The window is ${width}×${height}.`)
    break
  }
  default:
    fail(`unknown command ${command}: see --help`)
}
// Leaving, not Playwright's close: the window and its CDP stay.
process.exit(0)
