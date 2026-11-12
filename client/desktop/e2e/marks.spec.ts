/**
 * The Mark's looks, drawn still (ADR 0099, step 1). First the looks side by
 * side, each as a still mark draws it in the theme's colours: the seven,
 * and a Thread at work. Then a Thread done, one woken by its time, one that
 * asks, one that failed, and the engine gone, each on the bar's Mark, the
 * loudest first, and the Thread's own on its row. Only the Agent's tile
 * takes a look's colour; the logo's other two stay the text's. With less
 * motion asked for, each is its still pose, so the pictures it takes, in
 * dark and light, show the look and nothing between.
 *
 * Later is only on the sheet: a Thread put off sleeps on Later's tab, out
 * of this test's way, and the bar's Mark leaves out what is put off. Plain
 * tests cover its look (client/ui/src/status.test.ts).
 *
 * Then the Mark lives (ADR 0099, decision 4): each look's loops play as
 * CSS on its SVG's groups, and news, a look that changes, plays on the
 * window's clock while `data-news` says which, then hands the look back to
 * the loops. Woke arrives asleep, stretches, then rings, and its loops are
 * held and stepped 12 times a second (ADR 0117). A mark drawn for the
 * first time plays no news, and `[motion] off` stills every loop. A
 * working Mark shows what its Agent does, and stuck once it says nothing
 * for three minutes (ADR 0099, step 3). The open Thread's mark calls no
 * one, and an awake mark glances at the pointer over its card (step 4).
 * Last, the looks the window draws live are recorded, beside the approved
 * mock's when it is given, each doing laid out, and the calm of step 4.
 */
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { type MarkState, stillMark } from "@banda/ui/components/banda-mark"
import { expect, type Locator, type Page, test } from "@playwright/test"
import { STEPS_AT_LEAST, STEPS_AT_MOST, steppedOf } from "./loops"
import { animationsOf } from "./motion-trace"
import {
  bandaMenu,
  call,
  finish,
  firstThread,
  leaveSidebar,
  record,
  type Recording,
  startAgent,
  startWindow,
  threadNamed,
  type Window,
} from "./window"

let window: Window

test.afterEach(async () => {
  await window?.close()
})

const sidebarOf = (page: Page) =>
  page.getByRole("complementary", { name: "Sidebar" })
/** The bar's Mark: the logo, in the loudest look. */
const logoOf = (page: Page) =>
  page
    .getByRole("button", { name: /^Banda(:|$)/ })
    .locator('[data-slot="banda-mark"]')
/** The row of the Thread named `title`, in the Sidebar. */
const rowOf = (page: Page, title: string) =>
  sidebarOf(page).getByRole("option", { name: new RegExp(title) })

/**
 * The window as it is, in dark and then light, as
 * test-results/sidebar-<name>-<mode>.png at 1440x900; dark again after.
 * The look file is the Person's, rewritten for each; `draw` runs once the
 * theme has changed, before each picture. A `still` picture is of still
 * marks, with every animation stopped; the others catch the loops where
 * they are.
 */
async function shots(
  window: Window,
  name: string,
  { draw, still = false }: { draw?: () => Promise<void>; still?: boolean } = {}
) {
  const { page, dir } = window
  const html = page.locator("html")
  for (const mode of ["dark", "light"] as const) {
    writeFileSync(join(dir, "config/look.toml"), `mode = "${mode}"\n`)
    if (mode === "dark") await expect(html).toHaveClass(/dark/)
    else await expect(html).not.toHaveClass(/dark/)
    await draw?.()
    // The theme's colours change at once, not halfway through their
    // transition: a still picture stops it, and a live one waits it out.
    if (!still)
      await page.waitForFunction(
        () =>
          !document
            .getAnimations()
            .some((animation) => animation instanceof CSSTransition)
      )
    await page.screenshot({
      path: `test-results/sidebar-${name}-${mode}.png`,
      ...(still ? { animations: "disabled" as const } : {}),
    })
  }
  writeFileSync(join(dir, "config/look.toml"), 'mode = "dark"\n')
  await expect(html).toHaveClass(/dark/)
}

/** Keeps each value `data-news` takes on `mark`, null as it goes, in
 * `globalThis.news`, from now on. */
function watchNews(mark: Locator) {
  return mark.evaluate((svg) => {
    const news: (string | null)[] = []
    Object.assign(globalThis, { news })
    new MutationObserver(() =>
      news.push(svg.getAttribute("data-news"))
    ).observe(svg, { attributes: true, attributeFilter: ["data-news"] })
  })
}

/** The values `watchNews` kept. */
const newsOf = (page: Page) =>
  page.evaluate(
    () => (globalThis as unknown as { news: (string | null)[] }).news
  )

/** The names of the CSS animations that play on `mark`'s groups: held and
 * stepped (ADR 0117), but not inside `[data-paused]`, where they wait. */
const loopsOf = (mark: Locator) =>
  mark.evaluate((svg) =>
    svg
      .getAnimations({ subtree: true })
      .filter(
        (animation) =>
          !(animation.effect as KeyframeEffect | null)?.target?.closest(
            "[data-paused]"
          )
      )
      .map((animation) => (animation as CSSAnimation).animationName)
      .sort()
  )

/** ADR 0099's seven looks, and a Thread at work, each with its name and,
 * for one that calls no one, the token a Thread's mark weighs it by
 * (decision 10). */
const LOOKS: readonly (readonly [MarkState, string, string?])[] = [
  ["asking", "Asks"],
  ["failed", "Failed"],
  ["done", "Done"],
  ["woke", "Woke"],
  ["idle", "Open", "--mark-open"],
  ["later", "Later", "--mark-later"],
  ["offline", "Offline"],
  ["working", "Working", "--mark-working"],
]

/**
 * Draws `LOOKS` over the window, each as `stillMark` draws a
 * notification's icon, in the colours the theme in force gives it.
 */
async function showLooks(page: Page) {
  const tokens = [
    "--foreground",
    "--attention",
    "--destructive",
    "--added",
    "--woke",
    "--muted-foreground",
    ...LOOKS.flatMap(([, , token]) => (token ? [token] : [])),
  ]
  // Each token as the page's own colour, so a mix of others is worked out.
  const value: Record<string, string> = await page.evaluate((names) => {
    const probe = document.body.appendChild(document.createElement("i"))
    const values = Object.fromEntries(
      names.map((name) => {
        probe.style.color = `var(${name})`
        return [name, getComputedStyle(probe).color]
      })
    )
    probe.remove()
    return values
  }, tokens)
  const colors = {
    body: value["--foreground"]!,
    attention: value["--attention"]!,
    destructive: value["--destructive"]!,
    added: value["--added"]!,
    woke: value["--woke"]!,
    muted: value["--muted-foreground"]!,
  }
  const figures = LOOKS.map(([look, name, token]) => ({
    name,
    src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
      stillMark(look, { ...colors, body: token ? value[token]! : colors.body })
    )}`,
  }))
  await page.evaluate(async (figures) => {
    document.getElementById("m1a-looks")?.remove()
    const sheet = document.body.appendChild(document.createElement("div"))
    sheet.id = "m1a-looks"
    sheet.style.cssText =
      "position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;gap:40px;background:var(--background);color:var(--muted-foreground);font:13px system-ui"
    for (const { name, src } of figures) {
      const figure = sheet.appendChild(document.createElement("figure"))
      figure.style.cssText =
        "margin:0;display:flex;flex-direction:column;align-items:center;gap:12px"
      // A still mark's box is 68 wide: at 117 px, its hat draws as it did
      // at 96 in a live mark's 56.
      const image = figure.appendChild(document.createElement("img"))
      image.width = 117
      image.height = 117
      image.src = src
      figure.append(name)
      await image.decode()
    }
  }, figures)
}

/** What the page's token `name` comes to, as a colour. */
function tokenOf(page: Page, name: string) {
  return page.evaluate((name) => {
    const probe = document.body.appendChild(document.createElement("i"))
    probe.style.color = `var(${name})`
    const color = getComputedStyle(probe).color
    probe.remove()
    return color
  }, name)
}

/** The colours `mark` is drawn in: the whole mark's, which its logo's
 * tiles take, and its Agent's tile's. */
function colorsOf(mark: Locator) {
  return mark.evaluate((svg) => ({
    mark: getComputedStyle(svg).color,
    agent: getComputedStyle(svg.querySelector("[data-agent]")!).color,
  }))
}

test("the bar's Mark and each row draw ADR 0099's looks still, the loudest on the bar, and only the Agent's tile takes their colour (ADR 0099, step 1)", async () => {
  window = await startWindow({ look: 'mode = "dark"\n' })
  const { app, page } = window
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900)
  )
  await page.setViewportSize({ width: 1440, height: 900 })
  // Still poses: a picture shows the look, not a frame of its motion.
  await page.emulateMedia({ reducedMotion: "reduce" })
  const logo = logoOf(page)

  // The looks side by side, then the window again.
  await shots(window, "m1a-looks", { draw: () => showLooks(page), still: true })
  await page.evaluate(() => document.getElementById("m1a-looks")?.remove())

  // A Thread the Person saw end, and two at work; the last has the focus,
  // so the others' ends are not seen.
  const { thread: hello, composer } = await firstThread(page)
  await composer.fill("hello")
  await composer.press("Enter")
  await expect(hello.getByText("You said: hello")).toBeVisible()
  await expect(logo).toHaveAttribute("data-look", "rest")
  await expect(
    (await startAgent(page, "wait done")).getByText("Waiting.")
  ).toBeVisible()
  const on = await startAgent(page, "wait on")
  await expect(on.getByText("Waiting.")).toBeVisible()
  await expect(logo).toHaveAttribute("data-look", "working")

  // At work: the logo's hat and a Thread's mark in the muted blue (ADR
  // 0107), and the row's own words as they were.
  const blue = await tokenOf(page, "--mark-working")
  expect((await colorsOf(logo)).agent).toBe(blue)
  const working = rowOf(page, "wait on")
  const mark = working.getByRole("img", { name: "Working" })
  expect(await mark.evaluate((svg) => getComputedStyle(svg).color)).toBe(blue)
  expect(
    await working
      .getByText("wait on")
      .evaluate((title) => getComputedStyle(title).color)
  ).not.toBe(blue)

  // Done, out of the focus: a green square, smiling.
  finish(window, "wait done")
  const doneMark = rowOf(page, "wait done").getByRole("img", { name: "Done" })
  await expect(doneMark).toHaveAttribute("data-look", "done")
  await expect(logo).toHaveAttribute("data-look", "done")
  await shots(window, "m1a-done", { still: true })

  // Woke: put off for two seconds, it is its time that wakes it, by the
  // clock. Woke is louder than done, so the bar rings it, in its yellow,
  // the two tiles under it the text's (ADR 0099, decision 9).
  const done = threadNamed(window, "wait done")!.id
  call(window, "agents.later", { thread: done, until: Date.now() + 2000 })
  await expect(
    rowOf(page, "wait done").getByRole("img", { name: "Woke" })
  ).toBeVisible()
  await expect(logo).toHaveAttribute("data-look", "woke")
  await expect(
    page.getByRole("button", { name: /^Banda(:|$)/ })
  ).toHaveAccessibleName(/Woke/)
  const woke = await colorsOf(logo)
  expect(woke.agent).toBe("rgb(245, 197, 66)")
  expect(woke.mark).not.toBe(woke.agent)
  // Its two bells hang over the hat.
  await expect(logo.locator("[data-bells]")).toHaveAttribute("opacity", "1.00")
  await shots(window, "m1a-woke", { still: true })

  // The Banda menu's row draws the same look and says it, not the mark
  // under it (ADR 0099, decision 12).
  await bandaMenu(page)
  const menu = page.getByRole("dialog", { name: "Banda menu" })
  const inMenu = menu.getByRole("option", { name: /wait done/ })
  await expect(inMenu.getByRole("img", { name: "Woke" })).toBeVisible()
  await expect(inMenu).toContainText("Woke")
  await page.keyboard.press("Escape")
  await expect(menu).toBeHidden()

  // Asks: a triangle, louder than woke.
  const asks = await startAgent(page, "please ask first")
  await expect(asks.getByRole("group", { name: "Run a check" })).toBeVisible()
  const asking = rowOf(page, "please ask first").getByRole("img", {
    name: "Asks you",
  })
  await expect(asking).toHaveAttribute("data-look", "asking")
  await expect(logo).toHaveAttribute("data-look", "asking")
  const asked = await colorsOf(logo)
  expect(asked.agent).not.toBe(asked.mark)
  await shots(window, "m1a-asks", { still: true })

  // Failed, in hello, which has not the focus: a stop sign, louder still.
  const first = threadNamed(window, "hello")!.id
  call(window, "agents.send", { thread: first, text: "fail now" })
  await expect
    .poll(() => threadNamed(window, "hello")?.latest?.state)
    .toBe("failed")
  const failed = rowOf(page, "hello").getByRole("img", { name: "Failed" })
  await expect(failed).toHaveAttribute("data-look", "failed")
  await expect(logo).toHaveAttribute("data-look", "failed")
  await shots(window, "m1a-failed", { still: true })

  // Offline, while the engine is gone: the loudest of all, for as long as
  // it takes to come back, so every look the bar's Mark draws is kept.
  await logo.evaluate((svg) => {
    const looks: string[] = []
    Object.assign(globalThis, { looks })
    new MutationObserver(() =>
      looks.push(svg.getAttribute("data-look")!)
    ).observe(svg, { attributes: true, attributeFilter: ["data-look"] })
  })
  const engine = window.engine()!
  process.kill(engine, "SIGKILL")
  await expect.poll(() => window.engine() ?? engine).not.toBe(engine)
  await expect
    .poll(() =>
      page.evaluate(() => (globalThis as unknown as { looks: string[] }).looks)
    )
    .toContain("offline")
  // Back, hello's failure is still unseen.
  await expect(logo).toHaveAttribute("data-look", "failed")
})

test("the Mark lives: its loops play as CSS, news plays on the clock and hands them back, and woke arrives asleep, stretches, then rings (ADR 0099, step 1)", async () => {
  window = await startWindow({ look: 'mode = "dark"\n' })
  const { app, page, dir } = window
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900)
  )
  await page.setViewportSize({ width: 1440, height: 900 })
  const logo = logoOf(page)
  const sidebar = sidebarOf(page)

  // A Thread the Person saw end, and two at work; the last has the focus.
  const { thread: hello, composer } = await firstThread(page)
  await composer.fill("hello")
  await composer.press("Enter")
  await expect(hello.getByText("You said: hello")).toBeVisible()
  await expect(
    (await startAgent(page, "wait done")).getByText("Waiting.")
  ).toBeVisible()
  await expect(
    (await startAgent(page, "wait on")).getByText("Waiting.")
  ).toBeVisible()
  await expect(logo).toHaveAttribute("data-look", "working")
  // At work, its loops play as CSS, from where its rhythm is: a negative
  // delay, the same for every loop of it. The bar's Mark shows no one
  // Agent's doing: it plays the calm series of them, as marks-final.html's
  // `other` does, reading, replying, then a glance up, by one loop to a
  // part: the eyes, in their two groups, the body held back; the four
  // lids; its size and its lean.
  await expect(logo).toHaveAttribute("data-loop", "other")
  await expect
    .poll(() => loopsOf(logo))
    .toEqual([
      "mark-series-lid",
      "mark-series-lid",
      "mark-series-lid",
      "mark-series-lid",
      "mark-series-look",
      "mark-series-look",
      "mark-series-look-back",
      "mark-series-size",
      "mark-series-turn",
    ])
  expect(
    await logo.evaluate((svg) => svg.style.getPropertyValue("--mark-phase"))
  ).toMatch(/^-\d+\.\d{3}s$/)

  // Done flips into its look, on the window's clock, then breathes.
  await watchNews(logo)
  finish(window, "wait done")
  await expect(logo).toHaveAttribute("data-look", "done")
  await expect(logo).toHaveAttribute("data-loop", "done")
  await expect(logo).not.toHaveAttribute("data-news")
  expect((await newsOf(page)).slice(-2)).toEqual(["flip", null])
  await expect.poll(() => loopsOf(logo)).toEqual(["mark-breath"])

  // Woke: put off for three seconds, it is its time that wakes it. Put
  // off, it leaves the bar's Mark, which works again; then it arrives
  // asleep, stretches and rings, and its loops take over. Asleep lasts a
  // second, so the recorder catches it, not a poll of the attribute. Its
  // loops are held and stepped (ADR 0117), as motion.spec's in the rows
  // are: no Thread wakes there.
  await watchNews(logo)
  const done = threadNamed(window, "wait done")!.id
  call(window, "agents.later", { thread: done, until: Date.now() + 3000 })
  await expect.poll(() => newsOf(page), { intervals: [50] }).toContain("asleep")
  await page.screenshot({ path: "test-results/sidebar-m1b-asleep-dark.png" })
  // The loops' look is set only as the news ends.
  await expect(logo).toHaveAttribute("data-loop", "woke")
  await expect(logo).toHaveAttribute("data-look", "woke")
  await expect(logo).not.toHaveAttribute("data-news")
  expect((await newsOf(page)).slice(-3)).toEqual(["asleep", "stretch", null])
  await expect
    .poll(() => loopsOf(logo))
    .toEqual(expect.arrayContaining(["mark-bells", "mark-blink", "mark-ring"]))
  const woke = await steppedOf(logo)
  expect(
    woke.map((loop) => loop.name),
    "woke's loops in view"
  ).toEqual(expect.arrayContaining(animationsOf(["woke"])))
  for (const loop of woke) {
    expect(loop.held, `${loop.name} held`).toBe(true)
    expect(loop.steps, `${loop.name}'s steps a second`).toBeGreaterThanOrEqual(
      STEPS_AT_LEAST
    )
    expect(loop.steps, `${loop.name}'s steps a second`).toBeLessThanOrEqual(
      STEPS_AT_MOST
    )
  }
  await shots(window, "m1b-woke")

  // Asks: a triangle that hops on the bar, and on its row, the open
  // Thread's, blinks and does not hop (ADR 0099, decision 5).
  const asks = await startAgent(page, "please ask first")
  await expect(asks.getByRole("group", { name: "Run a check" })).toBeVisible()
  const asking = rowOf(page, "please ask first").getByRole("img", {
    name: "Asks you",
  })
  await expect(asking).toHaveAttribute("data-loop", "asking")
  await expect(asking).not.toHaveAttribute("data-news")
  await expect
    .poll(() => loopsOf(logo))
    .toEqual(expect.arrayContaining(["mark-blink", "mark-hop"]))
  await expect.poll(() => loopsOf(asking)).toContain("mark-blink")
  expect(await loopsOf(asking)).not.toContain("mark-hop")
  await leaveSidebar(page)
  await shots(window, "m1b-rhythm")

  // Hidden and shown, the sidebar's marks are drawn afresh: in their
  // looks, as if they had been there, with no news.
  await page.evaluate(() => (document.activeElement as HTMLElement).blur())
  await page.keyboard.press("Alt+KeyA")
  await expect(sidebar).toBeHidden()
  await page.evaluate(() => {
    const fresh: string[] = []
    Object.assign(globalThis, { fresh })
    new MutationObserver((changes) => {
      for (const change of changes)
        if (
          change.target instanceof Element &&
          change.target.closest("aside") &&
          change.target.hasAttribute("data-news")
        )
          fresh.push(change.target.getAttribute("data-look") ?? "")
    }).observe(document.body, {
      attributes: true,
      attributeFilter: ["data-news"],
      subtree: true,
    })
  })
  await page.keyboard.press("Alt+KeyA")
  await expect(sidebar).toBeVisible()
  await expect(asking).toHaveAttribute("data-loop", "asking")
  await page.waitForTimeout(1000)
  expect(
    await page.evaluate(
      () => (globalThis as unknown as { fresh: string[] }).fresh
    )
  ).toEqual([])

  // `[motion] off`: every look's still pose, and no loop plays.
  writeFileSync(
    join(dir, "config/look.toml"),
    'mode = "dark"\n[motion]\noff = true\n'
  )
  await expect(page.locator("html")).toHaveAttribute("data-still")
  await expect(logo).not.toHaveAttribute("data-loop")
  await expect.poll(() => loopsOf(logo)).toEqual([])
  await expect.poll(() => loopsOf(asking)).toEqual([])
  // On again, they play once more.
  writeFileSync(join(dir, "config/look.toml"), 'mode = "dark"\n')
  await expect(page.locator("html")).not.toHaveAttribute("data-still")
  await expect(logo).toHaveAttribute("data-loop", "asking")
  await expect
    .poll(() => loopsOf(logo))
    .toEqual(expect.arrayContaining(["mark-blink", "mark-hop"]))
  await expect.poll(() => loopsOf(asking)).toContain("mark-blink")
})

// ADR 0099, step 3: a working Mark shows what its Agent does, as the
// engine says it, each doing for at least 1.5 s; and stuck once its Agent
// has said nothing for three minutes, as the list's one clock wakes for it.
test("a working Mark shows what its Agent does, and stuck once it says nothing for three minutes (ADR 0099, step 3)", async () => {
  window = await startWindow({ look: 'mode = "dark"\n' })
  const { page } = window
  await firstThread(page)
  // The page's clock is moved on by hand later, its timers made anew.
  await page.clock.install()
  await page.reload()
  const sidebar = sidebarOf(page)
  await expect(sidebar).toBeVisible()

  // A command runs: the eyes are a prompt, its cursor blinking, on its
  // card and on its Pane's header alike. It starts from the New Thread
  // Work opened with, which the page kept.
  const composer = page
    .getByRole("region", { name: "New Thread" })
    .getByRole("textbox", { name: "Message to Fake AI" })
  await composer.fill("doing execute pnpm test")
  await composer.press("Enter")
  const runs = page.getByRole("region", {
    name: "doing execute pnpm test",
    exact: true,
  })
  const mark = rowOf(page, "doing execute pnpm test").getByRole("img", {
    name: "Working",
  })
  await expect(mark).toHaveAttribute("data-doing", "execute")
  await expect(mark).toHaveAttribute("data-loop", "execute")
  await expect.poll(() => loopsOf(mark)).toEqual(["mark-cursor"])
  // Its Tile is its region; its header's mark comes first in it.
  const header = runs.getByRole("img", { name: "Working" }).first()
  await expect(header).toHaveAttribute("data-doing", "execute")
  // It reads a file next: its eyes scan.
  const thread = threadNamed(window, "doing execute pnpm test")!.id
  call(window, "agents.send", {
    thread,
    text: "doing read card.ts",
    steer: true,
  })
  await expect(mark).toHaveAttribute("data-doing", "read")
  await expect(mark).toHaveAttribute("data-loop", "read")

  // An Agent that says nothing: at first the calm series, then, three
  // minutes on, stuck, its eyes half closed. The other one, silent as
  // long, is stuck too. The page's clock stays ahead of the engine's from
  // here, so what either says next is three minutes old to it.
  call(window, "agents.send", {
    harness: "fake",
    text: "silent 200",
    settings: null,
  })
  const silent = rowOf(page, "silent 200").getByRole("img", {
    name: "Working",
  })
  await expect(silent).toHaveAttribute("data-doing", "other")
  await page.clock.fastForward("02:30")
  await expect(silent).toHaveAttribute("data-doing", "other")
  await page.clock.fastForward("00:40")
  await expect(silent).toHaveAttribute("data-doing", "stuck")
  await expect(silent).toHaveAttribute("data-loop", "stuck")
  await expect
    .poll(() => loopsOf(silent))
    .toEqual(expect.arrayContaining(["mark-drift", "mark-drowse"]))
  await expect(mark).toHaveAttribute("data-doing", "stuck")
  await expect(header).toHaveAttribute("data-doing", "stuck")
})

// The looks the window draws live, recorded at 1440x900 by the machine's
// ffmpeg, where it has one, as test-results/sidebar-m1b-looks.webm: each
// in turn on the bar's Mark, the quietest first, as the rows keep theirs.
// Open and Later are left out: the bar's Mark rests while a Thread is
// open, and leaves out what is put off. With BANDA_MARKS_MOCK naming marks-final.html, the approved
// mock plays in a window of its own over the same seconds, recorded beside
// it as test-results/sidebar-m1b-looks-mock.webm, to show the look did not
// shift.
test("the looks the window draws live, recorded beside the approved mock's (ADR 0099, step 1)", async () => {
  test.setTimeout(120_000)
  const size = { width: 1440, height: 900 }
  window = await startWindow({ look: 'mode = "dark"\n' })
  const { app, page } = window
  await app.evaluate(
    ({ BrowserWindow }, { width, height }) =>
      BrowserWindow.getAllWindows()[0]?.setContentSize(width, height),
    size
  )
  await page.setViewportSize(size)
  const mock = process.env.BANDA_MARKS_MOCK
  // It shows without the focus, which the window keeps.
  const [beside] = mock
    ? await Promise.all([
        app.waitForEvent("window"),
        app.evaluate(
          ({ BrowserWindow }, { file, width, height }) => {
            const shown = new BrowserWindow({
              width,
              height,
              show: false,
              focusable: false,
            })
            shown.showInactive()
            void shown.loadFile(file)
          },
          { file: mock, ...size }
        ),
      ])
    : []
  // Headless, a window shown so has a page of 1x1: it is given the size.
  await beside?.setViewportSize(size)
  const logo = logoOf(page)
  /** Each look stays a while: a few of its calls and breaths. */
  const hold = () => page.waitForTimeout(5000)
  // What is not encoded, discarded: a test that fails leaves no frames
  // behind, nor an ffmpeg running.
  const recordings: Recording[] = []
  try {
    for (const [shown, name] of [
      [page, "looks"] as const,
      ...(beside ? [[beside, "looks-mock"] as const] : []),
    ])
      recordings.push(
        await record(shown, `test-results/sidebar-m1b-${name}.webm`, size)
      )

    // At work, then done, unseen, as another works on.
    const { thread: hello, composer } = await firstThread(page)
    await composer.fill("hello")
    await composer.press("Enter")
    await expect(hello.getByText("You said: hello")).toBeVisible()
    await expect(
      (await startAgent(page, "wait done")).getByText("Waiting.")
    ).toBeVisible()
    await expect(
      (await startAgent(page, "wait on")).getByText("Waiting.")
    ).toBeVisible()
    await leaveSidebar(page)
    await expect(logo).toHaveAttribute("data-loop", "other")
    await hold()
    finish(window, "wait done")
    await expect(logo).toHaveAttribute("data-loop", "done")
    await hold()
    // Woke by its time, two seconds on.
    const done = threadNamed(window, "wait done")!.id
    call(window, "agents.later", { thread: done, until: Date.now() + 2000 })
    await expect(logo).toHaveAttribute("data-loop", "woke")
    await hold()
    // Asks, then hello fails.
    await expect(
      (await startAgent(page, "please ask first")).getByRole("group", {
        name: "Run a check",
      })
    ).toBeVisible()
    await leaveSidebar(page)
    await expect(logo).toHaveAttribute("data-loop", "asking")
    await hold()
    const first = threadNamed(window, "hello")!.id
    call(window, "agents.send", { thread: first, text: "fail now" })
    await expect(logo).toHaveAttribute("data-loop", "failed")
    await hold()
    // Offline while the engine is gone, for as long as it takes to come
    // back; then failed again.
    const engine = window.engine()!
    process.kill(engine, "SIGKILL")
    await expect.poll(() => window.engine() ?? engine).not.toBe(engine)
    await expect(logo).toHaveAttribute("data-loop", "failed")
    await hold()

    // Every recording stops before any is encoded, so none goes on
    // through another's encoding.
    const stopped = await Promise.allSettled(
      recordings.map((recording) => recording.stop())
    )
    for (const one of stopped) if (one.status === "rejected") throw one.reason
    for (const recording of recordings) await recording.encode()
  } finally {
    await Promise.all(recordings.map((recording) => recording.discard()))
  }
})

/** Each doing a working Mark shows (ADR 0099, step 3), in the order
 * marks-final.html lays them out: its name there, what the Mark does, and
 * the message that sets the fake Agent doing it. Stuck is any Agent that
 * says nothing for three minutes. */
const DOINGS = [
  ["think", "Thinks", "eyes up, a slow sway", "doing think about it"],
  ["read", "Reads", "the eyes scan", "doing read card.ts"],
  ["search", "Searches", "a lens sweeps", "doing search standOf"],
  ["edit", "Edits", "tilts with each stroke", "doing edit status.ts"],
  [
    "execute",
    "Terminal",
    ">_, the cursor at 530 ms",
    "doing execute pnpm test",
  ],
  ["fetch", "On the web", "a dot goes out and back", "doing fetch docs.rs"],
  ["reply", "Writes to you", "types", "doing reply Here it is"],
  ["compacting", "Compacts", "squeezes", "doing compact"],
  ["other", "Other", "a series of the above", "doing other Skill"],
  ["stuck", "Stuck?", "half-closed eyes", "silent 600"],
  ["limit", "Waits for the limit", "dozes, sand drips", "limit wait"],
] as const

// Each doing as the window draws it live, recorded at 1440x900 as
// test-results/sidebar-m3a-doings.webm: dark, then light, then three
// minutes on, as every Agent that said nothing is stuck, light, then dark.
// The sidebar shows the Threads' cards at their own size; beside it, each
// card's mark again at 96 px, cloned as it stands with its loops, which
// marks.css plays alike, in marks-final.html's order and names. A picture
// ends each part, as test-results/sidebar-m3a-doings[-stuck]-<mode>.png.
// With BANDA_MARKS_MOCK naming marks-final.html, its doings play in a
// window of their own over the same seconds, as
// test-results/sidebar-m3a-doings-mock.webm.
test("each doing the window draws live, recorded in dark and light, laid out as the approved mock's (ADR 0099, step 3)", async () => {
  test.setTimeout(150_000)
  const size = { width: 1440, height: 900 }
  window = await startWindow({ look: 'mode = "dark"\n' })
  const { app, page, dir } = window
  await app.evaluate(
    ({ BrowserWindow }, { width, height }) =>
      BrowserWindow.getAllWindows()[0]?.setContentSize(width, height),
    size
  )
  await page.setViewportSize(size)
  await firstThread(page)
  // Stuck comes by the page's clock, moved on by hand.
  await page.clock.install()
  await page.reload()
  await expect(sidebarOf(page)).toBeVisible()
  for (const [, , , text] of DOINGS)
    call(window, "agents.send", { harness: "fake", text, settings: null })
  // Working's tab lists them all, where the Inbox's shelf shows six.
  const sidebar = sidebarOf(page)
  await sidebar.getByRole("tab", { name: /^Working/ }).click()
  await expect(sidebar.getByRole("tabpanel").locator("[data-row]")).toHaveCount(
    DOINGS.length
  )
  const markOf = (text: string) =>
    rowOf(page, text).getByRole("img", { name: "Working" })
  for (const [doing, , , text] of DOINGS) {
    const mark = markOf(text)
    await expect(mark).toHaveAttribute(
      "data-doing",
      doing === "stuck" ? "other" : doing,
      { timeout: 15_000 }
    )
    await mark.evaluate(
      (svg, doing) => svg.setAttribute("data-m3a", doing),
      doing
    )
  }
  await leaveSidebar(page)
  await page.evaluate(() => (document.activeElement as HTMLElement).blur())
  await expect(page.locator("[data-news]")).toHaveCount(0)

  /** Clones the marks `data-m3a` names into their places on the sheet. */
  const clone = (doings: readonly string[]) =>
    page.evaluate((doings) => {
      for (const doing of doings) {
        const svg = document.querySelector(`aside [data-m3a="${doing}"]`)!
        const copy = svg.cloneNode(true) as SVGSVGElement
        copy.removeAttribute("data-paused")
        copy.removeAttribute("data-m3a")
        copy.style.width = copy.style.height = "96px"
        // Its masks' ids its own, so it draws by none of the card's.
        for (const one of copy.querySelectorAll("[id]")) {
          const id = one.id
          one.id = `${id}-m3a`
          for (const user of copy.querySelectorAll(`[mask="url(#${id})"]`))
            user.setAttribute("mask", `url(#${id}-m3a)`)
        }
        document.getElementById(`m3a-${doing}`)!.replaceChildren(copy)
      }
    }, doings)
  // The sheet, right of the sidebar, in the theme's own colours.
  await page.evaluate((doings) => {
    const left = document.querySelector("aside")!.getBoundingClientRect().right
    const sheet = document.body.appendChild(document.createElement("div"))
    sheet.style.cssText = `position:fixed;top:0;bottom:0;right:0;left:${left + 16}px;z-index:2147483647;display:grid;grid-template-columns:repeat(4,1fr);align-content:center;gap:28px 16px;padding:24px;background:var(--background);color:var(--foreground);font:13px system-ui`
    for (const [doing, name, does] of doings) {
      const figure = sheet.appendChild(document.createElement("figure"))
      figure.style.cssText =
        "margin:0;display:flex;flex-direction:column;align-items:center;gap:6px"
      const place = figure.appendChild(document.createElement("div"))
      place.id = `m3a-${doing}`
      place.style.cssText =
        "width:96px;height:96px;display:grid;place-items:center;color:var(--muted-foreground)"
      place.textContent = "3 min on"
      const named = figure.appendChild(document.createElement("strong"))
      named.textContent = name
      const said = figure.appendChild(document.createElement("span"))
      said.style.color = "var(--muted-foreground)"
      said.textContent = does
    }
  }, DOINGS)
  await clone(DOINGS.flatMap(([doing]) => (doing === "stuck" ? [] : [doing])))

  const mock = process.env.BANDA_MARKS_MOCK
  const [beside] = mock
    ? await Promise.all([
        app.waitForEvent("window"),
        app.evaluate(
          ({ BrowserWindow }, { file, width, height }) => {
            const shown = new BrowserWindow({
              width,
              height,
              show: false,
              focusable: false,
            })
            shown.showInactive()
            void shown.loadFile(file)
          },
          { file: mock, ...size }
        ),
      ])
    : []
  if (beside) {
    await beside.setViewportSize(size)
    // Its doings: the two groups at work, at the top.
    await beside.evaluate(() =>
      [...document.querySelectorAll("#set .group h2")]
        .find((heading) => heading.textContent === "Работает")!
        .scrollIntoView({ block: "start" })
    )
  }
  const mode = async (to: "dark" | "light") => {
    writeFileSync(join(dir, "config/look.toml"), `mode = "${to}"\n`)
    if (to === "dark") await expect(page.locator("html")).toHaveClass(/dark/)
    else await expect(page.locator("html")).not.toHaveClass(/dark/)
  }
  const hold = (ms: number) => page.waitForTimeout(ms)
  const picture = (name: string) =>
    page.screenshot({ path: `test-results/sidebar-m3a-${name}.png` })
  const recordings: Recording[] = []
  try {
    for (const [shown, name] of [
      [page, "doings"] as const,
      ...(beside ? [[beside, "doings-mock"] as const] : []),
    ])
      recordings.push(
        await record(shown, `test-results/sidebar-m3a-${name}.webm`, size)
      )
    await hold(6000)
    await picture("doings-dark")
    await mode("light")
    await hold(6000)
    await picture("doings-light")
    // Three minutes on, every Agent that said nothing is stuck.
    await page.clock.fastForward("03:10")
    await expect(markOf("silent 600")).toHaveAttribute("data-doing", "stuck")
    await expect(page.locator("aside [data-news]")).toHaveCount(0, {
      timeout: 5000,
    })
    await markOf("silent 600").evaluate((svg) =>
      svg.setAttribute("data-m3a", "stuck")
    )
    await clone(["stuck"])
    await hold(5000)
    await picture("doings-stuck-light")
    await mode("dark")
    await hold(5000)
    await picture("doings-stuck-dark")
    const stopped = await Promise.allSettled(
      recordings.map((recording) => recording.stop())
    )
    for (const one of stopped) if (one.status === "rejected") throw one.reason
    for (const recording of recordings) await recording.encode()
  } finally {
    await Promise.all(recordings.map((recording) => recording.discard()))
  }
})

/** The transforms `mark`'s hat stands in by its call's group, as marks.css
 * plays it over a call and more: one, `none`, for a mark that calls no
 * one. */
const standsOf = (mark: Locator) =>
  mark.evaluate(async (svg) => {
    const group = svg.querySelector(".mark-move")!
    const stands = new Set<string>()
    const end = performance.now() + 4600
    while (performance.now() < end) {
      stands.add(getComputedStyle(group).transform)
      await new Promise((go) => setTimeout(go, 40))
    }
    return [...stands]
  })

/** Where `mark`'s first eye is drawn, across. */
const eyeOf = (mark: Locator) =>
  mark.evaluate((svg) =>
    Number(svg.querySelector("[data-eye]")!.getAttribute("cx"))
  )

/** The pointer passes over `card` from its left to its right, or back,
 * in `steps` moves `ms` apart. Where it stands is read as the page reads
 * it, under the recording's zoom too. */
async function pass(
  page: Page,
  card: Locator,
  { steps = 8, ms = 0, back = false } = {}
) {
  await card.scrollIntoViewIfNeeded()
  const box = await card.evaluate((element) => {
    const { x, y, width, height } = element.getBoundingClientRect()
    return { x, y: y + height / 2, width }
  })
  for (let at = 0; at <= steps; at++) {
    const along = (back ? steps - at : at) / steps
    await page.mouse.move(box.x + 2 + (box.width - 4) * along, box.y)
    if (ms) await page.waitForTimeout(ms)
  }
}

/** The Work Project with hello, answered as the Person looked, and two
 * Threads that ask, the last the open one. */
async function calmDay(page: Page) {
  const { thread: hello, composer } = await firstThread(page)
  await composer.fill("hello")
  await composer.press("Enter")
  await expect(hello.getByText("You said: hello")).toBeVisible()
  for (const text of ["please ask first", "please ask again"])
    await expect(
      (await startAgent(page, text)).getByRole("group", {
        name: "Run a check",
      })
    ).toBeVisible()
  const asks = (text: string) =>
    rowOf(page, text).getByRole("img", { name: "Asks you" })
  return { open: asks("please ask again"), other: asks("please ask first") }
}

// ADR 0099, step 4: calm. The open Thread's mark is the same mark without
// its call, and stops at the end of the call it is in (decision 5). An
// awake mark glances at the pointer as it passes its card, on the window's
// clock, and turns back 2.5 s after it stops; one asleep does not
// (decision 6).
test("the open Thread's asking mark does not hop, a card under the pointer turns its eyes, and an asleep one does not (ADR 0099, step 4)", async () => {
  window = await startWindow({ look: 'mode = "dark"\n' })
  const { page } = window
  const { open, other } = await calmDay(page)
  await leaveSidebar(page)
  await expect(page.locator("aside [data-news]")).toHaveCount(0)

  // The open one blinks and stands still, over a whole call and more; the
  // other hops.
  await expect(open).toHaveAttribute("data-calm", "")
  await expect(other).not.toHaveAttribute("data-calm")
  await expect.poll(() => loopsOf(open)).toContain("mark-blink")
  expect(await loopsOf(open)).not.toContain("mark-hop")
  await expect.poll(() => loopsOf(other)).toContain("mark-hop")
  const [still, hops] = await Promise.all([standsOf(open), standsOf(other)])
  expect(still).toEqual(["none"])
  expect(hops.length).toBeGreaterThan(1)

  // The other opened, it is calm once its call ends, and the first calls.
  await rowOf(page, "please ask first").click()
  await expect(other).toHaveAttribute("data-calm", "")
  await expect(open).not.toHaveAttribute("data-calm")
  await leaveSidebar(page)
  await expect(page.locator("aside [data-news]")).toHaveCount(0, {
    timeout: 5000,
  })
  await expect.poll(() => loopsOf(open)).toContain("mark-hop")
  expect(await loopsOf(other)).not.toContain("mark-hop")

  // Under the pointer, it turns its eyes to it, on the window's clock,
  // and 2.5 s after the pointer stops back; then marks.css has it again.
  const before = await eyeOf(open)
  await pass(page, rowOf(page, "please ask again"))
  const stopped = Date.now()
  await expect(open).toHaveAttribute("data-news", "glance")
  await expect.poll(() => eyeOf(open)).toBeGreaterThan(before + 2)
  await expect(open).not.toHaveAttribute("data-news", { timeout: 5000 })
  const lasted = Date.now() - stopped
  expect(lasted).toBeGreaterThan(2000)
  expect(lasted).toBeLessThan(3500)
  expect(await eyeOf(open)).toBe(before)
  await expect(open).toHaveAttribute("data-loop", "asking")

  // Put off for an hour, hello sleeps on Later's tab: under the pointer,
  // it does not glance.
  call(window, "agents.later", {
    thread: threadNamed(window, "hello")!.id,
    until: Date.now() + 3_600_000,
  })
  await sidebarOf(page)
    .getByRole("tab", { name: /^Later/ })
    .click()
  const asleep = rowOf(page, "hello").getByRole("img", { name: "Later" })
  await expect(asleep).toHaveAttribute("data-loop", "later")
  await watchNews(asleep)
  await pass(page, rowOf(page, "hello"))
  await page.waitForTimeout(500)
  expect(await newsOf(page)).toEqual([])
  await expect(asleep).toHaveAttribute("data-loop", "later")
})

// The calm of step 4 as the window draws it, recorded at 1440x900 by the
// machine's ffmpeg as test-results/sidebar-m4-calm.webm, dark then light:
// the open Thread's asking mark beside one that asks and is not open, one
// still, the other hopping; then the pointer passes over awake cards and
// stops on one for 2.5 s. The sidebar shows at twice its size (CSS zoom),
// so a 16 px mark reads, and a ring shows the pointer, which a recording
// does not; pictures of a glance end each part, as
// test-results/sidebar-m4-glance-<mode>.png. This machine's window has no
// pointer that hovers (`(hover: hover)` is false), so the cards' hover
// fill and action do not show.
test("the calm of step 4, recorded in dark and light (ADR 0099, step 4)", async () => {
  test.setTimeout(150_000)
  const size = { width: 1440, height: 900 }
  window = await startWindow({ look: 'mode = "dark"\n' })
  const { app, page, dir } = window
  await app.evaluate(
    ({ BrowserWindow }, { width, height }) =>
      BrowserWindow.getAllWindows()[0]?.setContentSize(width, height),
    size
  )
  await page.setViewportSize(size)
  const { open, other } = await calmDay(page)
  await expect(open).toHaveAttribute("data-calm", "")
  await expect(other).not.toHaveAttribute("data-calm")
  await page.evaluate(() => {
    document.querySelector<HTMLElement>("aside")!.style.zoom = "2"
    const ring = document.body.appendChild(document.createElement("div"))
    ring.style.cssText =
      "position:fixed;left:0;top:0;width:16px;height:16px;margin:-8px 0 0 -8px;border:2px solid #3b82f6;border-radius:50%;pointer-events:none;z-index:2147483647"
    addEventListener(
      "pointermove",
      ({ clientX, clientY }) =>
        (ring.style.transform = `translate(${clientX}px, ${clientY}px)`),
      { capture: true, passive: true }
    )
  })
  await leaveSidebar(page)
  await expect(page.locator("aside [data-news]")).toHaveCount(0)
  const mode = async (to: "dark" | "light") => {
    writeFileSync(join(dir, "config/look.toml"), `mode = "${to}"\n`)
    if (to === "dark") await expect(page.locator("html")).toHaveClass(/dark/)
    else await expect(page.locator("html")).not.toHaveClass(/dark/)
  }
  const aside = await sidebarOf(page).evaluate((element) =>
    element.getBoundingClientRect().toJSON()
  )
  const recordings: Recording[] = []
  try {
    recordings.push(
      await record(page, "test-results/sidebar-m4-calm.webm", size)
    )
    for (const to of ["dark", "light"] as const) {
      await mode(to)
      await leaveSidebar(page)
      // Two calls of the one not open; the open one blinks, still.
      await page.waitForTimeout(9000)
      // The pointer over hello, open, back and forth, then over the one
      // that hops; then it stops on hello, whose eyes turn back 2.5 s on.
      const slow = { steps: 30, ms: 40 }
      await pass(page, rowOf(page, "hello"), slow)
      await pass(page, rowOf(page, "hello"), { ...slow, back: true })
      await pass(page, rowOf(page, "please ask first"), slow)
      await pass(page, rowOf(page, "hello"), slow)
      await page.waitForTimeout(600)
      await page.screenshot({
        path: `test-results/sidebar-m4-glance-${to}.png`,
        clip: { x: 0, y: 0, width: aside.x + aside.width + 8, height: 900 },
      })
      await page.waitForTimeout(3400)
    }
    for (const recording of recordings) await recording.stop()
    for (const recording of recordings) await recording.encode()
  } finally {
    await Promise.all(recordings.map((recording) => recording.discard()))
  }
})
