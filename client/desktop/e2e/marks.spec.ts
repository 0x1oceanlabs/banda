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
 * Later is only on the sheet: the sidebar's rows draw their mark until its
 * card comes (ADR 0098, S6a), and the bar's Mark leaves out what is put
 * off. Plain tests cover it (client/ui/src/status.test.ts).
 *
 * Then the Mark lives (ADR 0099, decision 4): each look's loops play as
 * CSS on its SVG's groups, and news, a look that changes, plays on the
 * window's clock while `data-news` says which, then hands the look back to
 * the loops. Woke arrives asleep, stretches, then rings, and a trace shows
 * the compositor runs its loops. A mark drawn for the first time plays no
 * news, and `[motion] off` stills every loop. Last, the looks the window
 * draws live are recorded, beside the approved mock's when it is given.
 */
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { type MarkState, stillMark } from "@banda/ui/components/banda-mark"
import { expect, type Locator, type Page, test } from "@playwright/test"
import {
  animationsOf,
  compositedOf,
  startTrace,
  stopTrace,
} from "./motion-trace"
import {
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
    .getByRole("button", { name: /^Sidebar/ })
    .locator('[data-slot="banda-mark"]')
/** The row of the Thread named `title`, in the Sidebar. */
const rowOf = (page: Page, title: string) =>
  sidebarOf(page).getByRole("button", { name: new RegExp(title) })

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

/** The names of the CSS animations that play on `mark`'s groups. */
const loopsOf = (mark: Locator) =>
  mark.evaluate((svg) =>
    svg
      .getAnimations({ subtree: true })
      .filter((animation) => animation.playState === "running")
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
  ["running", "Working", "--mark-working"],
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
  await expect(logo).toHaveAttribute("data-look", "running")

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
    page.getByRole("button", { name: /^Sidebar/ })
  ).toHaveAccessibleName(/Woke/)
  const woke = await colorsOf(logo)
  expect(woke.agent).toBe("rgb(245, 197, 66)")
  expect(woke.mark).not.toBe(woke.agent)
  // Its two bells hang over the hat.
  await expect(logo.locator("[data-bells]")).toHaveAttribute("opacity", "1.00")
  await shots(window, "m1a-woke", { still: true })

  // The Banda menu's row draws the same look and says it, not the mark
  // under it (ADR 0099, decision 12).
  await page.keyboard.press("Alt+Space")
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
  await expect(logo).toHaveAttribute("data-look", "running")
  // At work, its loops play as CSS, from where its rhythm is: a negative
  // delay, the same for every loop of it.
  await expect(logo).toHaveAttribute("data-loop", "running")
  // Its eyes read, in the eyes' two groups, the body held back; its four
  // lids half shut on the way back; it swells as it works.
  await expect
    .poll(() => loopsOf(logo))
    .toEqual([
      "mark-scan",
      "mark-scan",
      "mark-scan-back",
      "mark-scan-lid",
      "mark-scan-lid",
      "mark-scan-lid",
      "mark-scan-lid",
      "mark-work",
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
  // second, so the recorder catches it, not a poll of the attribute. A
  // trace of it all says whether the compositor runs woke's loops: its
  // bells ring on the bar's Mark alone, until the rows draw their look
  // (ADR 0098, S6a), so motion.spec's trace of the rows has them not.
  const cdp = await page.context().newCDPSession(page)
  const renderer = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.webContents.getOSProcessId()
  )
  await startTrace(cdp, "woke")
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
  const woke = compositedOf(await stopTrace(cdp, "woke"), renderer, "mark-")
  // Loops that began where nothing of their mark was drawn and paused
  // within 0.1 s: not counted (motion-trace.ts).
  test.info().annotations.push({
    type: "woke: brief",
    description: `${woke.brief} of ${woke.animations} loops undrawn, paused within 0.1 s, not counted`,
  })
  expect(woke.names, "woke's loops the trace saw begin").toEqual(
    expect.arrayContaining(animationsOf(["woke"]))
  )
  expect(woke.failed, "loops the compositor does not run").toEqual([])
  await shots(window, "m1b-woke")

  // Asks: a triangle that hops, on the bar and on its row.
  const asks = await startAgent(page, "please ask first")
  await expect(asks.getByRole("group", { name: "Run a check" })).toBeVisible()
  const asking = rowOf(page, "please ask first").getByRole("img", {
    name: "Asks you",
  })
  await expect(asking).toHaveAttribute("data-loop", "asking")
  await expect(asking).not.toHaveAttribute("data-news")
  await expect
    .poll(() => loopsOf(asking))
    .toEqual(expect.arrayContaining(["mark-blink", "mark-hop"]))
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
    .poll(() => loopsOf(asking))
    .toEqual(expect.arrayContaining(["mark-blink", "mark-hop"]))
})

// The looks the window draws live, recorded at 1440x900 by the machine's
// ffmpeg, where it has one, as test-results/sidebar-m1b-looks.webm: each
// in turn on the bar's Mark, the quietest first, as the rows keep theirs.
// Open and Later are not drawn live yet: the rows draw their mark until
// their card comes (ADR 0098, S6a), and the bar's Mark leaves out what is
// put off. With BANDA_MARKS_MOCK naming marks-final.html, the approved
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
    await expect(logo).toHaveAttribute("data-loop", "running")
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
