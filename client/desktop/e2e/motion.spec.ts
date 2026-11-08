/**
 * How the Tiling moves, measured on the real app (ADR 0088, decision 13):
 * a Strip of three terminals and a browser Pane, the first terminal
 * printing off screen and, for a while, the last on screen, as Agents'
 * do; then the window left quiet, nothing holding the keyboard, a column's width stepped, the focus stepped along the Strip, a
 * column maximized, the workspaces stepped, and the overview opened and
 * closed. The browser's page shows in every phase.
 *
 * For each phase it reports the main thread's work a second, from Chrome's
 * own counters; what motion-probe.ts counts in the page (ticks, layout read
 * inside them, each terminal's draws and fits, long tasks and frames, slow
 * keys, how far the page trails its slot, React's drawings of the Tiles,
 * Strips, widgets and sidebar, for each key a phase presses too); and,
 * from a trace of the phase
 * (motion-trace.ts), the frames presented and dropped and the main
 * thread's work in each moving frame. It fails where a measure has nothing
 * to stand on, so a broken probe never reads as a perfect 0.
 *
 * The numbers go to test-results/motion.json and, for a Person to read,
 * test-results/motion.md. The playwright config runs it again on a screen of
 * 1.6 pixels to the point. motion-budget.json holds the budgets and the
 * numbers recorded on main; while it is in record mode, a phase that does
 * worse only warns (motion-report.ts).
 *
 * - `MOTION_RECORD=1` writes this run's numbers into motion-budget.json:
 *   with `--repeat-each=3`, the median of three.
 * - `MOTION_TRACE=off` takes no trace; `MOTION_TRACE=keep` keeps them in
 *   the test's output folder.
 * - `MOTION_PROFILE=width,overview` writes those phases' CPU profiles to
 *   the test's output folder.
 */
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { expect, test } from "@playwright/test"
import { install, read, reset } from "./motion-probe"
import { perSecondOf, report, type Phase } from "./motion-report"
import { MARKS, startTrace, stopTrace, summarise, within } from "./motion-trace"
import {
  newTerminal,
  pressInPage,
  startWindow,
  textOf,
  type Window,
} from "./window"

let window: Window
let site: Server | undefined

test.afterEach(async () => {
  await window?.close()
  site?.close()
})

const tracing = process.env.MOTION_TRACE ?? "on"
const traced = tracing !== "off"
const keep = tracing === "keep"
const profiled = process.env.MOTION_PROFILE?.split(",") ?? []

test("how the Tiling moves, against motion-budget.json", async () => {
  test.setTimeout(240_000)
  const scale = Number(test.info().project.metadata.scale ?? 1)
  site = createServer((_, response) => {
    response.writeHead(200, { "content-type": "text/html" })
    response.end(
      "<title>Page</title><body style='margin:0;background:linear-gradient(90deg,#f00,#00f)'><h1>Page</h1></body>"
    )
  })
  await new Promise<void>((done) => site!.listen(0, "127.0.0.1", done))
  const address = `http://127.0.0.1:${(site.address() as AddressInfo).port}/`

  window = await startWindow({ deviceScaleFactor: scale })
  const { app, page } = window
  // The first terminal, printing all the while, as an Agent's would, and
  // keeping what it printed where the test counts it, until the test
  // leaves a file where it looks.
  const stop = join(window.dir, "stop")
  const printed = join(window.dir, "printed")
  const lines = () => textOf(printed).split("\n").length - 1
  const first = await newTerminal(page)
  await first.click()
  await page.keyboard.type(
    `while [ ! -e ${stop} ]; do date +%N | tee -a ${printed}; sleep 0.02; done`
  )
  await page.keyboard.press("Enter")

  const open = async (kind: string) => {
    await page.keyboard.press("Alt+KeyN")
    await page
      .getByRole("region", { name: "New Pane" })
      .getByRole("button", { name: kind })
      .click()
  }
  for (let i = 0; i < 2; i++) {
    await open("Terminal")
    const screen = page.getByRole("region", { name: "Terminal screen" })
    await expect(screen).toHaveCount(i + 2)
  }
  await open("Browser")
  const bar = page.getByRole("textbox", { name: "Address" })
  await bar.fill(address)
  await bar.press("Enter")
  await expect
    .poll(() =>
      app.evaluate(({ webContents }) =>
        webContents
          .getAllWebContents()
          .some((c) => c.getType() === "webview" && c.getTitle() === "Page")
      )
    )
    .toBe(true)
  // The keys go to the window from a terminal, not from the page.
  await page.getByRole("region", { name: "Terminal screen" }).nth(2).click()
  await page.keyboard.press("Alt+ArrowRight")
  await page.getByRole("region", { name: "Terminal screen" }).nth(2).click()
  await page.waitForTimeout(1000)
  const viewport = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    scale: devicePixelRatio,
  }))
  expect(viewport).toEqual({
    width: 1280,
    height: 800,
    scale: expect.closeTo(scale, 3),
  })

  const cdp = await page.context().newCDPSession(page)
  await within(cdp.send("Performance.enable"), "Performance.enable")
  const metrics = async (phase: string) => {
    const { metrics } = await within(
      cdp.send("Performance.getMetrics"),
      `${phase}: Performance.getMetrics`
    )
    return Object.fromEntries(metrics.map((m) => [m.name, m.value]))
  }
  await page.evaluate(install)
  // Whose work a trace sums up: the window's renderer, the pages' and the
  // GPU process's, by the pids the trace names them by.
  const { versions, ...pids } = await app.evaluate(
    ({ app, BrowserWindow, webContents }) => ({
      window: BrowserWindow.getAllWindows()[0].webContents.getOSProcessId(),
      pages: webContents
        .getAllWebContents()
        .filter((c) => c.getType() === "webview")
        .map((c) => c.getOSProcessId()),
      gpu: app.getAppMetrics().find((m) => m.type === "GPU")?.pid,
      versions: {
        electron: process.versions.electron,
        chrome: process.versions.chrome,
      },
    })
  )

  const phases: Record<string, Phase> = {}
  // The keys a phase pressed, counted as each is pressed.
  let pressed = 0
  /** Measures `act` as the phase `name`; a `still` one moves nothing. */
  const measure = async (
    name: string,
    act: () => Promise<void>,
    { still = false } = {}
  ) => {
    if (traced) await startTrace(cdp, name)
    const profile = profiled.includes(name)
    if (profile) {
      await within(cdp.send("Profiler.enable"), `${name}: Profiler.enable`)
      await within(
        cdp.send("Profiler.setSamplingInterval", { interval: 200 }),
        `${name}: Profiler.setSamplingInterval`
      )
      await within(cdp.send("Profiler.start"), `${name}: Profiler.start`)
    }
    // The window settles, and the trace reaches each of its processes.
    await page.waitForTimeout(300)
    await page.evaluate(reset, !still)
    await page.evaluate((mark) => console.timeStamp(mark), MARKS.start)
    const before = await metrics(name)
    const started = Date.now()
    pressed = 0
    await act()
    const steps = pressed
    const seconds = (Date.now() - started) / 1000
    const after = await metrics(name)
    await page.evaluate((mark) => console.timeStamp(mark), MARKS.end)
    const counted = await page.evaluate(read)
    if (profile) {
      const { profile: taken } = await within(
        cdp.send("Profiler.stop"),
        `${name}: Profiler.stop`
      )
      writeFileSync(
        test.info().outputPath(`${name}.cpuprofile`),
        JSON.stringify(taken)
      )
    }
    const trace = traced
      ? summarise(
          await stopTrace(
            cdp,
            name,
            keep ? test.info().outputPath(`${name}.trace.json`) : undefined
          ),
          pids
        )
      : null
    // What each number stands on.
    expect(counted.terminals, `${name}: the terminals found`).toHaveLength(3)
    expect(
      counted.trail.length,
      `${name}: the reads that found the browser's slot showing`
    ).toBeGreaterThan(0)
    if (trace && !still)
      expect(trace.moving.frames, `${name}: moving frames`).toBeGreaterThan(0)
    for (const [part, found] of Object.entries(counted.hooked))
      expect(
        found,
        `${name}: the ${part} whose drawings it counts`
      ).toBeGreaterThan(0)
    phases[name] = {
      seconds,
      steps,
      perSecond: perSecondOf(before, after),
      counted,
      trace,
    }
  }

  /** Presses `key` in the window, counted as the phase's. */
  const inWindow = async (key: string) => {
    pressed += 1
    await page.keyboard.press(key)
  }
  // A key goes where the keyboard is: to the browser's page when it has
  // the focus, as the keyboard sends it there, so main's
  // `before-input-event` takes Banda's keys from it; else to the window.
  // Where it went.
  const press = async (key: string) => {
    pressed += 1
    const held = key.split("+")
    const keyCode = held.pop()!.replace(/^(Arrow|Key)/, "")
    const modifiers = held.map(
      (each) => each.toLowerCase() as "alt" | "control" | "shift"
    )
    if (await pressInPage(app, keyCode, modifiers, { focused: true }))
      return "page"
    await page.keyboard.press(key)
    return "window"
  }
  const presses = async (keys: string[], gap = 700) => {
    const went: string[] = []
    for (const key of keys) {
      went.push(await press(key))
      await page.waitForTimeout(gap)
    }
    return went
  }

  const terminal = (n: number) =>
    page.getByRole("region", { name: "Terminal screen" }).nth(n)
  // The last terminal, on screen, prints too while the phase lasts: whole
  // lines, coloured in part, so its screen scrolls as an Agent's does.
  await page.keyboard.type(
    `while [ ! -e ${stop} ]; do printf '\\033[1;32m%s\\033[0m %s\\n' $(date +%N) 'compiling the quick brown fox, which jumps over the lazy dog' | tee -a ${printed}; sleep 0.02; done`
  )
  await page.keyboard.press("Enter")
  const printedBefore = lines()
  await measure("printing", () => page.waitForTimeout(3000), { still: true })
  expect(lines() - printedBefore, "the lines printed").toBeGreaterThan(10)
  expect(
    phases.printing.counted.terminals[2].draws[0],
    "printing: the last terminal's draws on screen"
  ).toBeGreaterThan(0)
  // Quiet from here: what the window costs by itself, and its moves. The
  // terminals stop printing, as what they printed shows: hidden, the first
  // draws nothing either way.
  writeFileSync(stop, "")
  await terminal(2).click()
  await expect(async () => {
    const before = lines()
    await page.waitForTimeout(500)
    expect(lines()).toBe(before)
  }).toPass({ timeout: 15_000 })
  // Nothing has the keyboard, so no cursor blinks: a focused terminal's
  // blink is the working phase's (ADR 0088, decision 1).
  await page.evaluate(() => (document.activeElement as HTMLElement).blur())
  // A Mark playing its trick is no quiet window: the logo plays one about
  // every half minute, so the next try finds it still.
  for (let tries = 1; ; tries++) {
    await measure("quiet", () => page.waitForTimeout(3000), { still: true })
    if (phases.quiet.counted.marks === 0 || tries === 3) break
  }
  // The clock stops while nothing moves (ADR 0088, decision 3): a hard
  // gate, whatever the budget file's mode.
  expect(phases.quiet.counted.callbacks, "quiet: animation frames").toBe(0)
  // The last terminal, beside the browser, has the focus for the moves.
  await terminal(2).click()
  // Through the widths short of the whole screen, and back: the browser
  // beside it stays in sight.
  await measure("width", async () => {
    await presses([
      "Control+Alt+ArrowLeft",
      "Control+Alt+ArrowRight",
      "Control+Alt+ArrowRight",
      "Control+Alt+ArrowLeft",
      "Control+Alt+ArrowLeft",
      "Control+Alt+ArrowRight",
    ])
  })
  await terminal(2).click()
  // To the first terminal and back to the browser, its page sliding out
  // and in, and from the page to the last terminal.
  let went: string[] = []
  await measure("focus", async () => {
    went = await presses([
      "Alt+ArrowLeft",
      "Alt+ArrowLeft",
      "Alt+ArrowRight",
      "Alt+ArrowRight",
      "Alt+ArrowRight",
      "Alt+ArrowLeft",
    ])
  })
  // The last key went from the page, and reached the window.
  expect(went.at(-1)).toBe("page")
  // Each key drew again the two Tiles the focus moved between, as it must
  // to show it: the probe counts React's drawings.
  expect(phases.focus.counted.renders.tiles, "focus: Tiles drawn again").toBe(
    2 * phases.focus.steps
  )
  await expect(
    terminal(2).locator("xpath=ancestor::section[@data-tile][1]")
  ).toHaveAttribute("data-focused", "true")
  await terminal(2).click()
  await measure("maximize", async () => {
    await presses(["Alt+KeyF", "Alt+KeyF", "Alt+KeyF", "Alt+KeyF"])
  })
  await terminal(2).click()
  await measure("workspace", async () => {
    await presses(["Alt+PageDown", "Alt+PageUp", "Alt+PageDown", "Alt+PageUp"])
  })
  await terminal(2).click()
  const overview = page.getByRole("dialog", { name: "Overview" })
  await measure("overview", async () => {
    for (let i = 0; i < 2; i++) {
      await inWindow("Alt+KeyO")
      await expect(overview).toBeVisible()
      await page.waitForTimeout(900)
      await inWindow("Escape")
      await expect(overview).toBeHidden()
      await page.waitForTimeout(900)
    }
  })

  report(scale, versions, phases)
})
