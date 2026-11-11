/**
 * How the Tiling moves, measured on the real app (ADR 0088, decision 13):
 * a Strip of three terminals and a browser Pane, the first terminal
 * printing off screen and, for a while, the last on screen, as Agents'
 * do; then the window left quiet, nothing holding the keyboard, a
 * column's width stepped, the focus stepped along the Strip, a column
 * maximized, the workspaces stepped, and the overview opened and closed;
 * then the sidebar list as an Agent's day moves it, and the window once
 * its batch is over. The browser's page shows in every phase but the
 * last: the Marks, which only live, as their Threads take the Tiling over
 * (ADR 0099, decision 4).
 *
 * For each phase it reports the main thread's work a second, from Chrome's
 * own counters; what motion-probe.ts counts in the page (ticks, layout read
 * inside them, each terminal's draws and fits, long tasks and frames, slow
 * keys, how far the page trails its slot, React's drawings of the Tiles,
 * Strips, widgets and sidebar, for each key a phase presses too); and,
 * from a trace of the phase
 * (motion-trace.ts), the frames presented and dropped and the main
 * thread's work in each moving frame. It fails where a measure has nothing
 * to stand on, so a broken probe never reads as a perfect 0. A phase the
 * logo's trick landed in is measured again: a still one up to three times
 * in all, one that moves once more, after the trick (#738).
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
import {
  animationsOf,
  compositedOf,
  MARKS,
  startTrace,
  stopTrace,
  summarise,
  within,
} from "./motion-trace"
import {
  call,
  finish,
  loadACore,
  newTerminal,
  leaveSidebar,
  pressInPage,
  send,
  startAgent,
  startWindow,
  textOf,
  threadNamed,
  toastsOf,
  topsOf,
  type Window,
} from "./window"

let window: Window
let site: Server | undefined

test.afterEach(async () => {
  await window?.close()
  site?.close()
})

/** How long use-live.ts holds what the engine says of a Thread whose Tile
 * is hidden before it draws it (`HELD.hidden`). */
const HELD_HIDDEN_MS = 1000

const tracing = process.env.MOTION_TRACE ?? "on"
const traced = tracing !== "off"
const keep = tracing === "keep"
const profiled = process.env.MOTION_PROFILE?.split(",") ?? []

test("how the Tiling moves, against motion-budget.json", async () => {
  test.setTimeout(360_000)
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
  /** Measures `act` as the phase `name`; a `still` one moves nothing, and
   * one without the `browser` has not its page on screen. */
  const measure = async (
    name: string,
    act: () => Promise<void>,
    { still = false, browser = true } = {}
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
    const loadBefore = loadACore()
    const started = Date.now()
    pressed = 0
    await act()
    const steps = pressed
    const seconds = (Date.now() - started) / 1000
    const load = Math.max(loadBefore, loadACore())
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
    if (browser)
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
      load,
      perSecond: perSecondOf(before, after),
      counted,
      trace,
    }
  }

  /** Measures the still phase `name`, `ms` long, again while a Mark
   * played its trick in it, up to three times in all: the trick's frames
   * are no still window's (#738), and the logo plays one about every half
   * minute, so the next try finds it still. */
  const measureStill = async (
    name: string,
    { ms = 3000, browser = true } = {}
  ) => {
    for (let tries = 1; ; tries++) {
      await measure(name, () => page.waitForTimeout(ms), {
        still: true,
        browser,
      })
      if (phases[name].counted.marks === 0 || tries === 3) return
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
  // lines, coloured in part, so its screen scrolls as an Agent's does. It
  // keeps what it printed in a file of its own, so the first terminal's
  // lines alone show the hidden one printed.
  const shownPrinted = join(window.dir, "printed-on-screen")
  const shownLines = () => textOf(shownPrinted).split("\n").length - 1
  await page.keyboard.type(
    `while [ ! -e ${stop} ]; do printf '\\033[1;32m%s\\033[0m %s\\n' $(date +%N) 'compiling the quick brown fox, which jumps over the lazy dog' | tee -a ${shownPrinted}; sleep 0.02; done`
  )
  await page.keyboard.press("Enter")
  const printedBefore = lines()
  const shownBefore = shownLines()
  await measureStill("printing")
  expect(lines() - printedBefore, "the lines printed").toBeGreaterThan(10)
  expect(
    shownLines() - shownBefore,
    "the lines printed on screen"
  ).toBeGreaterThan(10)
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
    const before = [lines(), shownLines()]
    await page.waitForTimeout(500)
    expect([lines(), shownLines()]).toEqual(before)
  }).toPass({ timeout: 15_000 })
  // Nothing has the keyboard, so no cursor blinks: a focused terminal's
  // blink is the working phase's (ADR 0088, decision 1).
  await page.evaluate(() => (document.activeElement as HTMLElement).blur())
  await measureStill("quiet")
  // The clock stops while nothing moves (ADR 0088, decision 3): a hard
  // gate, whatever the budget file's mode.
  expect(phases.quiet.counted.callbacks, "quiet: animation frames").toBe(0)
  /** Waits for the Marks to be still: none changed its drawing for half a
   * second. */
  const marksStill = () =>
    expect(async () => {
      const before = (await page.evaluate(read)).marks
      await page.waitForTimeout(500)
      expect((await page.evaluate(read)).marks).toBe(before)
    }).toPass({ timeout: 15_000 })
  // A Mark playing its trick in a phase that moves adds frames of its own,
  // each laid out as it draws, so the phase counts the trick's work with
  // the move's (#738): it is measured once more, once the trick is over.
  // The logo plays its next one 22 s later at the soonest (banda-mark.tsx),
  // so the second try finds none. Each phase leaves the Tiling as it found
  // it, and starts from the last terminal, beside the browser, which has
  // the focus for the moves.
  const moves = async (name: string, act: () => Promise<void>) => {
    for (let tries = 1; ; tries++) {
      await terminal(2).click()
      await measure(name, act)
      if (phases[name].counted.marks === 0 || tries === 2) return
      await marksStill()
    }
  }
  // Through the widths short of the whole screen, and back: the browser
  // beside it stays in sight.
  await moves("width", async () => {
    await presses([
      "Control+Alt+ArrowLeft",
      "Control+Alt+ArrowRight",
      "Control+Alt+ArrowRight",
      "Control+Alt+ArrowLeft",
      "Control+Alt+ArrowLeft",
      "Control+Alt+ArrowRight",
    ])
  })
  // To the first terminal and back to the browser, its page sliding out
  // and in, and from the page to the last terminal.
  let went: string[] = []
  await moves("focus", async () => {
    went = await presses([
      "Alt+ArrowLeft",
      "Alt+ArrowLeft",
      "Alt+ArrowRight",
      "Alt+ArrowRight",
      "Alt+ArrowRight",
      "Alt+ArrowLeft",
    ])
  })
  // The last key went from the page, and reached the window: the last
  // try's, as the counts are.
  expect(went.at(-1)).toBe("page")
  // Each key drew again the two Tiles the focus moved between, as it must
  // to show it: the probe counts React's drawings.
  expect(phases.focus.counted.renders.tiles, "focus: Tiles drawn again").toBe(
    2 * phases.focus.steps
  )
  await expect(
    terminal(2).locator("xpath=ancestor::section[@data-tile][1]")
  ).toHaveAttribute("data-focused", "true")
  await moves("maximize", async () => {
    await presses(["Alt+KeyF", "Alt+KeyF", "Alt+KeyF", "Alt+KeyF"])
  })
  await moves("workspace", async () => {
    await presses(["Alt+PageDown", "Alt+PageUp", "Alt+PageDown", "Alt+PageUp"])
  })
  const overview = page.getByRole("dialog", { name: "Overview" })
  await moves("overview", async () => {
    for (let i = 0; i < 2; i++) {
      await inWindow("Alt+KeyO")
      await expect(overview).toBeVisible()
      await page.waitForTimeout(900)
      await inWindow("Escape")
      await expect(overview).toBeHidden()
      await page.waitForTimeout(900)
    }
  })

  // The sidebar list as an Agent's day moves it (ADR 0098, S5c): ten
  // Threads at work; six that call come while the pointer is away; one,
  // open in a Pane, archived by its key; and the hold let go with eight
  // changes in it, four done, two archived on another machine and two
  // come. Each batch moves by opacity alone, played by element.animate
  // with no frame loop of the list's own.
  const sidebar = page.getByRole("complementary", { name: "Sidebar" })
  const rows = sidebar.getByRole("tabpanel").locator("[data-row]")
  const row = (title: string) => rows.filter({ hasText: title })
  for (let i = 1; i <= 10; i++) await send(window, `wait ${i}`)
  await send(window, "read me")
  call(window, "agents.read", { thread: threadNamed(window, "read me")!.id })
  await row("read me").click()
  const opened = page.getByRole("region", { name: "read me", exact: true })
  await expect(opened).toHaveAttribute("data-focused", "true")
  await leaveSidebar(page)
  await measure("sidebar", async () => {
    for (let i = 1; i <= 6; i++) await send(window, `call ${i}`)
    await expect(rows.filter({ hasText: /call \d/ })).toHaveCount(6)
    // By its key, the Person's own act: its slot closes at once.
    await inWindow("Alt+KeyS")
    await expect(opened).toBeHidden()
    await expect(row("read me")).toHaveCount(0)
    // Held, with the pointer on the list: no card moves while the eight
    // changes come.
    await rows.first().hover()
    const held = await topsOf(rows)
    for (let i = 1; i <= 4; i++)
      call(window, "agents.send", {
        thread: threadNamed(window, `wait ${i}`)!.id,
        text: "go",
        steer: true,
      })
    for (const title of ["call 1", "call 2"])
      call(window, "agents.archive", { thread: threadNamed(window, title)!.id })
    await send(window, "call 7")
    await send(window, "call 8")
    await expect
      .poll(() =>
        [1, 2, 3, 4].map((i) => threadNamed(window, `wait ${i}`)?.latest?.state)
      )
      .toEqual(["done", "done", "done", "done"])
    await expect(
      sidebar.getByRole("tab", { name: /^Archive/ })
    ).toHaveAccessibleName("Archive, 3")
    await expect(row("call 1")).toContainText("Archived")
    expect(await topsOf(rows), "sidebar: the cards' places, held").toEqual(held)
    expect(await row("call 7").count(), "sidebar: a call come, held").toBe(0)
    // Let go: what waited lands in one batch.
    await leaveSidebar(page)
    await expect(row("call 7")).toHaveCount(1)
    await expect(rows.filter({ hasText: /call [12]/ })).toHaveCount(0)
    await page.waitForTimeout(800)
  })
  // A hard gate, whatever the budget file's mode: the list reads no layout
  // of its own in a frame. The Tiling and the browser's page read theirs
  // in the same ticks, as the archived Thread's Pane closes: those are not
  // the sidebar's, warn as sidebar.ticks.readsPerSecond, and #1292 tracks
  // them. The phase's long animation frames are soft in motion-budget.json:
  // that Pane closing blocks one frame for 130-200 ms of its own (#1293),
  // and the machine's load makes more.
  expect(
    phases.sidebar.counted.sidebarReads,
    "sidebar: its layout read in a frame"
  ).toBe(0)
  // What the list's arithmetic says it stands, as it is drawn: a px apart
  // at most, on a screen of 1.6 too, as each kind's height is read to the
  // fraction.
  const [planned, drawn] = await sidebar
    .locator("[data-height]")
    .evaluate((list) => [
      Number(list.getAttribute("data-height")),
      list.getBoundingClientRect().height,
    ])
  expect(
    Math.abs(planned - drawn),
    `sidebar: the heights planned, ${planned}, and drawn, ${drawn}`
  ).toBeLessThanOrEqual(1)
  // Once the batch is over, the list plays nothing of its own and keeps no
  // card on its way out, whatever the Marks do: the Threads that work and
  // call still tell their news, so the window asks for no frame but
  // theirs; a cut text's fade is no motion either, its timeline being the
  // text's own scroll, which stands still (ADR 0098, S6b). The toasts
  // leave first: Sonner asks for a frame as each goes, which is neither
  // the list's nor a Mark's.
  await page.evaluate(() => (document.activeElement as HTMLElement).blur())
  await expect(toastsOf(page).getByRole("listitem")).toHaveCount(0, {
    timeout: 30_000,
  })
  await measureStill("settled")
  const list = sidebar.locator("[data-height]")
  await expect(list.locator("[data-going]")).toHaveCount(0)
  const own = await list.evaluate(
    (one) =>
      one.getAnimations({ subtree: true }).filter((animation) => {
        const target = (animation.effect as KeyframeEffect | null)?.target
        return !target?.closest("[data-slot=banda-mark], [data-slot=fade-text]")
      }).length
  )
  expect(own, "settled: the list's own animations").toBe(0)
  if (phases.settled.counted.marks === 0)
    expect(
      phases.settled.counted.callbacks,
      `settled: animation frames${phases.settled.counted.stacks.map((stack) => `\n-- asked for at:\n${stack}`).join("")}`
    ).toBe(0)

  // The Marks, last, as their Threads take the Tiling over, on a list the
  // day above is cleared from: 5 Open and 2 Asks cards in the Inbox, 3 on
  // Later's tab, and the bar's Mark asking, all in Work, the Project the
  // terminals opened in. Between news a Mark asks for no tick: its loops
  // play as CSS, on the compositor (ADR 0099, decision 4). Each Thread
  // starts as the Person starts one: the first from the New Thread Work
  // opened with, beside the terminals since, the rest from Alt+Enter's.
  for (let i = 5; i <= 10; i++) finish(window, `wait ${i}`)
  const day = [
    ...Array.from({ length: 10 }, (_, i) => `wait ${i + 1}`),
    ...Array.from({ length: 6 }, (_, i) => `call ${i + 3}`),
  ]
  await expect
    .poll(() => day.map((title) => threadNamed(window, title)?.latest?.state))
    .toEqual(day.map(() => "done"))
  for (const title of day)
    call(window, "agents.archive", { thread: threadNamed(window, title)!.id })
  await expect(rows).toHaveCount(0)
  const composer = page
    .getByRole("region", { name: "New Thread" })
    .getByRole("textbox", { name: "Message to Fake AI" })
  const rowOf = (text: string) =>
    sidebar.getByRole("button", { name: new RegExp(text) })
  // Each answered while the Person looks at it: it calls no one.
  const hellos = Array.from({ length: 8 }, (_, i) => `hello ${i + 1}`)
  for (const [i, text] of hellos.entries()) {
    if (i === 0) {
      await composer.fill(text)
      await composer.press("Enter")
    } else await startAgent(page, text)
    const thread = page.getByRole("region", { name: text, exact: true })
    await expect(thread.getByText(`You said: ${text}`)).toBeVisible()
    await expect
      .poll(() => threadNamed(window, text)?.latest?.state)
      .toBe("done")
    await expect(rowOf(text).getByRole("img", { name: "Open" })).toBeVisible()
  }
  // Three put off for an hour, to Later's tab.
  for (const text of hellos.slice(5))
    call(window, "agents.later", {
      thread: threadNamed(window, text)!.id,
      until: Date.now() + 3_600_000,
    })
  await expect(
    sidebar.getByRole("tab", { name: /^Later/ })
  ).toHaveAccessibleName("Later, 3")
  // Two that ask, the bar's Mark with them.
  for (const text of ["please ask first 1", "please ask first 2"]) {
    const thread = await startAgent(page, text)
    await expect(
      thread.getByRole("group", { name: "Run a check" })
    ).toBeVisible()
  }
  for (const text of hellos.slice(0, 5)) await expect(rowOf(text)).toBeVisible()
  const asking = sidebar.getByRole("img", { name: "Asks you" })
  await expect(asking).toHaveCount(2)
  const logo = page
    .getByRole("button", { name: /^Banda menu/ })
    .locator('[data-slot="banda-mark"]')
  await expect(logo).toHaveAttribute("data-look", "asking")
  // Nothing has the keyboard or the pointer, and no news plays: the Marks
  // only live.
  await leaveSidebar(page)
  await page.evaluate(() => (document.activeElement as HTMLElement).blur())
  await expect(page.locator("[data-news]")).toHaveCount(0)
  await expect(asking.first()).toHaveAttribute("data-loop", "asking")
  // The window settles first: windows a little longer than use-live.ts
  // holds what the engine says for a hidden Tile (`HELD.hidden`, a second)
  // are counted, until one counts no tick. The ticks before it are, we
  // suspect, what the Threads just started said, drawn on a tick once that
  // hold is over, which is no Mark's: not proven.
  await expect
    .poll(
      async () => {
        await page.evaluate(reset, false)
        await page.waitForTimeout(HELD_HIDDEN_MS + 200)
        return (await page.evaluate(read)).callbacks
      },
      {
        message: "marks: a window with no animation frame, settling",
        timeout: 20_000,
        intervals: [0],
      }
    )
    .toBe(0)
  await measureStill("marks", { ms: 5000, browser: false })
  // A hard gate, whatever the budget file's mode; where it fails, the
  // first ticks asked for say by whom.
  const asked = phases.marks.counted.stacks
  expect(
    phases.marks.counted.callbacks,
    `marks: animation frames${asked.map((stack) => `\n-- asked for at:\n${stack}`).join("")}`
  ).toBe(0)
  // The compositor's verdict on their loops, from a trace of their own:
  // hidden and shown, the sidebar's Marks begin theirs again. Beside the
  // two that ask, a Thread at work, one done that the Person did not see
  // and one that failed, so the loops move every part a row's mark has.
  // Woke's bells ring on the bar's Mark, and marks.spec traces them there.
  if (traced) {
    await expect(
      (await startAgent(page, "wait done")).getByText("Waiting.")
    ).toBeVisible()
    await expect(
      (await startAgent(page, "wait on")).getByText("Waiting.")
    ).toBeVisible()
    finish(window, "wait done")
    call(window, "agents.send", {
      thread: threadNamed(window, "hello 1")!.id,
      text: "fail now",
    })
    const looks = ["asking", "failed", "done", "running"] as const
    for (const [text, name] of [
      ["wait on", "Working"],
      ["wait done", "Done"],
      ["hello 1", "Failed"],
    ] as const)
      await expect(rowOf(text).getByRole("img", { name })).toBeVisible()
    await leaveSidebar(page)
    await page.evaluate(() => (document.activeElement as HTMLElement).blur())
    await expect(page.locator("[data-news]")).toHaveCount(0)
    await startTrace(cdp, "marks: compositor")
    await page.waitForTimeout(300)
    await page.keyboard.press("Alt+KeyA")
    await expect(sidebar).toBeHidden()
    await page.waitForTimeout(300)
    await page.keyboard.press("Alt+KeyA")
    await expect(sidebar).toBeVisible()
    await page.waitForTimeout(1000)
    const events = await stopTrace(
      cdp,
      "marks: compositor",
      keep ? test.info().outputPath("marks-compositor.trace.json") : undefined
    )
    const compositor = compositedOf(events, pids.window, "mark-")
    phases.marks.compositor = compositor
    // Loops that began where nothing of their mark was drawn, as the
    // sidebar hid and showed, and paused within 0.1 s: not counted.
    test.info().annotations.push({
      type: "marks: brief",
      description: `${compositor.brief} of ${compositor.animations} loops undrawn, paused within 0.1 s, not counted`,
    })
    expect(
      compositor.names,
      "marks: the Marks' loops the trace saw begin"
    ).toEqual(expect.arrayContaining(animationsOf(looks)))
    // The gate (ADR 0099, step 1): at a scale of 1 the compositor runs
    // every loop. At another, Chromium may run an SVG's on the main
    // thread, and the report tells which.
    if (scale === 1)
      expect(
        compositor.failed,
        "marks: loops the compositor does not run"
      ).toEqual([])
  }

  report(scale, versions, phases)
})
