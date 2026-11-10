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
 */
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { type MarkState, stillMark } from "@banda/ui/components/banda-mark"
import { expect, type Locator, type Page, test } from "@playwright/test"
import {
  call,
  finish,
  firstThread,
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

/** Starts a New Thread with `text` in the Project in front; the new one
 * has the focus. */
async function startAgent(page: Page, text: string) {
  await page.keyboard.press("Alt+Enter")
  const box = page
    .getByRole("region", { name: "New Thread" })
    .getByRole("textbox", { name: "Message to Fake AI" })
  await expect(box).toBeFocused()
  await box.fill(text)
  await box.press("Enter")
  return page.getByRole("region", { name: text, exact: true })
}

/**
 * The window as it is, in dark and then light, as
 * test-results/sidebar-m1a-<look>-<mode>.png at 1440x900; dark again
 * after. The look file is the Person's, rewritten for each; `draw` runs
 * once the theme has changed, before each picture.
 */
async function shots(window: Window, look: string, draw?: () => Promise<void>) {
  const { page, dir } = window
  const html = page.locator("html")
  for (const mode of ["dark", "light"] as const) {
    writeFileSync(join(dir, "config/look.toml"), `mode = "${mode}"\n`)
    if (mode === "dark") await expect(html).toHaveClass(/dark/)
    else await expect(html).not.toHaveClass(/dark/)
    await draw?.()
    // The theme's colours change at once, not halfway through their
    // transition.
    await page.screenshot({
      path: `test-results/sidebar-m1a-${look}-${mode}.png`,
      animations: "disabled",
    })
  }
  writeFileSync(join(dir, "config/look.toml"), 'mode = "dark"\n')
  await expect(html).toHaveClass(/dark/)
}

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
  await shots(window, "looks", () => showLooks(page))
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
  await shots(window, "done")

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
  await shots(window, "woke")

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
  await shots(window, "asks")

  // Failed, in hello, which has not the focus: a stop sign, louder still.
  const first = threadNamed(window, "hello")!.id
  call(window, "agents.send", { thread: first, text: "fail now" })
  await expect
    .poll(() => threadNamed(window, "hello")?.latest.state)
    .toBe("failed")
  const failed = rowOf(page, "hello").getByRole("img", { name: "Failed" })
  await expect(failed).toHaveAttribute("data-look", "failed")
  await expect(logo).toHaveAttribute("data-look", "failed")
  await shots(window, "failed")

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
