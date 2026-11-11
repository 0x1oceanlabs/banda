/**
 * arc's terminal on this device (ADR 0106, decision 4; the `terminal`
 * road), on arc.ts's arc, 40 ms away a round trip: its shell runs on arc
 * and this device only draws it. A key while arc is away is never sent,
 * and says so; the same shell comes back; a Pane restored while arc is
 * away finds its shell and gives it its size once arc is back; a public
 * link opens in this device's browser, and arc's own address says it is
 * arc's. The same-path job runs this spec with arc in a mount namespace of
 * its own (ci.yml's `same-path`). With BANDA_E2E_SHOTS set to a folder, it
 * leaves pictures of what it checks.
 */
import { existsSync } from "node:fs"
import { join } from "node:path"
import { expect, type Locator, type Page, test } from "@playwright/test"
import { type Arc, newArc, put, SHOTS, shot, withArc } from "./arc"
import { read, type Window } from "./window"

let window: Window | undefined
let arc: Arc | undefined
let stopArc: (() => Promise<void>) | undefined

test.afterEach(async () => {
  await window?.close()
  await stopArc?.()
  arc?.close()
  window = arc = stopArc = undefined
})

/** The title of arc's Thread in its Project "banda". */
const TITLE = "Bench the terminal"

const sidebarOf = (page: Page) =>
  page.getByRole("complementary", { name: "Sidebar" })

/** arc's part of the sidebar: its label and what it holds. */
const arcOf = (page: Page) =>
  sidebarOf(page).getByRole("group", { name: "arc", exact: true })

/** The window, arc's Project "banda" and its Thread open, from arc's part
 * of the sidebar; arc's engine runs apart from the window's ssh, so a
 * link that goes leaves it, and its terminals, running. */
async function onArc() {
  arc = newArc({ latency: 40 })
  stopArc = await arc.start()
  const folder = join(arc.code.arc, "banda")
  put(arc.disk(folder), { "who.txt": "arc\n" })
  const project = JSON.parse(arc.banda("project", "add", folder)).ok
    .id as string
  arc.send(project, TITLE)
  await expect
    .poll(() => arc!.states(project).find(([one]) => one === TITLE)?.[1])
    .toBe("done")
  window = await withArc(arc)
  const { page } = window
  await arcOf(page).getByText(TITLE).click()
  const thread = page.getByRole("region", { name: TITLE, exact: true })
  await expect(thread.getByText(`You said: ${TITLE}`)).toBeVisible()
  const composer = thread.getByRole("textbox", { name: "Message to Fake AI" })
  return { page, thread, composer, project, folder }
}

/** A terminal on arc's Project from New Pane in its Thread: its screen,
 * running. */
async function terminalOn(page: Page, composer: Locator) {
  await composer.focus()
  await page.keyboard.press("Alt+KeyN")
  await page
    .getByRole("region", { name: "New Pane" })
    .getByRole("button", { name: "Terminal" })
    .click()
  const screen = page.getByRole("region", { name: "Terminal screen" })
  await expect(screen).toHaveAttribute("data-state", "running")
  return screen
}

/** Types `line` and runs it in the focused shell. */
async function run(page: Page, line: string) {
  await page.keyboard.type(line)
  await page.keyboard.press("Enter")
}

/** The Pill over arc's terminal, as the Tile that holds `screen` says it. */
const pillOf = (page: Page, screen: Locator) =>
  page
    .locator("section[data-tile]")
    .filter({ has: screen })
    .locator("[data-machine-pill] [role=status]")

/** What the terminal's shell has in `name`, in the Project's folder on
 * arc, once it is there: a shell's word about itself. */
const inFolder = (folder: string, name: string) =>
  read(arc!.disk(join(folder, name)))

test("arc's terminal opens on arc: hostname says arc, its header names arc, and a key echoes once arc has it", async () => {
  const { page, composer, folder } = await onArc()
  const screen = await terminalOn(page, composer)
  const tile = page.locator("section[data-tile]").filter({ has: screen })
  await expect(tile.locator("header").first()).toContainText("arc")
  await screen.click()
  await run(page, "hostname > seen.txt; pwd > where.txt")
  await expect.poll(() => inFolder(folder, "seen.txt")).toBe("arc\n")
  await expect.poll(() => inFolder(folder, "where.txt")).toBe(`${folder}\n`)
  await shot(page, "terminal-arc")
  // On arc's disk, and nothing on this machine's at the same path.
  expect(existsSync(join(arc!.code.here, "banda", "seen.txt"))).toBe(false)
})

test("the terminal's key, from arc's Thread, opens arc's terminal", async () => {
  const { page, composer, folder } = await onArc()
  await composer.focus()
  await page.keyboard.press("Control+Alt+Enter")
  const screen = page.getByRole("region", { name: "Terminal screen" })
  await expect(screen).toHaveAttribute("data-state", "running")
  await screen.click()
  await run(page, "hostname > keyed.txt")
  await expect.poll(() => inFolder(folder, "keyed.txt")).toBe("arc\n")
})

test("arc's terminal hears its new size when the Tile changes", async () => {
  const { page, composer, folder } = await onArc()
  const screen = await terminalOn(page, composer)
  await screen.click()
  const badge = page.getByRole("status", { name: "Zoom" })
  const cols = async (name: string) => {
    await expect(badge).toBeHidden()
    await run(page, `tput cols > ${name}`)
    await expect.poll(() => inFolder(folder, name)).toMatch(/^\d+\n$/)
    return Number(inFolder(folder, name))
  }
  const before = await cols("before.txt")
  await page.keyboard.press("Control+Equal")
  await page.keyboard.press("Control+Equal")
  await expect(badge).toHaveText("125%")
  expect(await cols("after.txt")).toBeLessThan(before)
})

test("a key while arc is away says it was not sent and goes nowhere; arc back, the same shell runs on", async () => {
  // ssh gives up on a silent link in about 20 s, and comes back after its
  // waits.
  test.setTimeout(SHOTS ? 300_000 : 180_000)
  const { page, composer, folder } = await onArc()
  const screen = await terminalOn(page, composer)
  await screen.click()
  await run(page, "echo $$ > before.pid")
  await expect.poll(() => inFolder(folder, "before.pid")).toMatch(/^\d+\n$/)
  const pid = inFolder(folder, "before.pid")

  const canvas = screen.locator("canvas").first()
  const drawn = () => canvas.evaluate((one: HTMLCanvasElement) => one.height)
  const rowsBefore = await drawn()
  arc!.blackhole(true)
  await expect.poll(() => arc!.applies()?.hole).toBe(true)
  const pill = pillOf(page, screen)
  await expect(pill).toHaveText("arc is away", { timeout: 60_000 })
  await screen.click()
  await run(page, "echo typed > away.txt")
  const foot = screen
    .locator("..")
    .getByText("arc is away: your typing was not sent.")
  await expect(foot).toBeVisible()
  await expect(foot.locator("..")).toHaveAttribute(
    "title",
    "What was typed before arc went away may still arrive once it is back."
  )
  // The band of the pill came out of the screen, which drew itself anew
  // to fit, so its last rows stay above the Tile's edge.
  await expect.poll(drawn).toBeLessThan(rowsBefore)
  await shot(page, "terminal-arc-away", { toasts: true })

  arc!.blackhole(false)
  await expect(pill).toHaveCount(0, { timeout: 90_000 })
  await expect(foot).toHaveCount(0)
  await expect(screen).toHaveAttribute("data-state", "running")
  await screen.click()
  await run(page, "echo $$ > after.pid")
  await expect.poll(() => inFolder(folder, "after.pid")).toBe(pid)
  await shot(page, "terminal-arc-back")
  // What was refused never lands by itself, and no pill is left.
  await page.waitForTimeout(1_000)
  expect(existsSync(arc!.disk(join(folder, "away.txt")))).toBe(false)
})

test("a terminal restored while arc is held, then arc back: the same shell, and it takes the new size", async () => {
  test.setTimeout(SHOTS ? 300_000 : 180_000)
  const { page, composer, folder } = await onArc()
  const screen = await terminalOn(page, composer)
  await screen.click()
  await run(page, "echo $$ > before.pid; tput cols > before.cols")
  await expect.poll(() => inFolder(folder, "before.cols")).toMatch(/^\d+\n$/)
  const pid = inFolder(folder, "before.pid")
  const was = Number(inFolder(folder, "before.cols"))

  arc!.blackhole(true)
  const { dir } = window!
  await page.evaluate(() => localStorage.removeItem("banda.starts"))
  await window!.app.close()
  window = await withArc(arc!, { dir })
  const again = window.page
  const restored = again.getByRole("region", { name: "Terminal screen" })
  await expect(pillOf(again, restored)).toHaveText("arc is away", {
    timeout: 60_000,
  })
  await expect(restored).toHaveAttribute("data-state", "starting")
  // Its size changes while arc cannot hear it.
  await restored.click()
  await again.keyboard.press("Control+Equal")
  await again.keyboard.press("Control+Equal")

  arc!.blackhole(false)
  await expect(pillOf(again, restored)).toHaveCount(0, { timeout: 90_000 })
  await expect(restored).toHaveAttribute("data-state", "running", {
    timeout: 30_000,
  })
  await restored.click()
  await run(again, "echo $$ > after.pid; tput cols > after.cols")
  await expect.poll(() => inFolder(folder, "after.pid")).toBe(pid)
  await expect
    .poll(() => Number(inFolder(folder, "after.cols")))
    .toBeLessThan(was)
})

test("a public link opens in this device's browser; arc's localhost says it is arc's and offers its address to copy", async () => {
  const { page, composer, folder } = await onArc()
  await window!.app.evaluate(({ shell }) => {
    const opened: string[] = []
    ;(globalThis as { linkOpens?: string[] }).linkOpens = opened
    shell.openExternal = async (url) => {
      opened.push(url)
    }
  })
  const screen = await terminalOn(page, composer)
  await screen.click()
  await run(
    page,
    "clear; printf 'http://example.test/page\\nhttp://localhost:3000/\\n'; : > printed"
  )
  await expect.poll(() => inFolder(folder, "printed")).toBe("")
  const canvas = screen.locator("canvas").first()
  const rowY = 8
  const row2Y = 26
  await canvas.hover({ position: { x: 24, y: rowY } })
  await expect(canvas).toHaveAttribute("title", /^Opens in this /)
  await canvas.click({ position: { x: 24, y: rowY }, modifiers: ["Control"] })
  await expect
    .poll(() =>
      window!.app.evaluate(
        () => (globalThis as { linkOpens?: string[] }).linkOpens
      )
    )
    .toEqual(["http://example.test/page"])

  // The menu offers this device's browser, and no Banda.
  await canvas.click({ button: "right", position: { x: 24, y: rowY } })
  const menu = page.getByRole("menu", { name: "Terminal" })
  await expect(
    menu.getByRole("menuitem", { name: /^Open in this .+'s browser$/ })
  ).toBeVisible()
  await expect(
    menu.getByRole("menuitem", { name: "Open in Banda" })
  ).toHaveCount(0)
  await page.keyboard.press("Escape")

  await canvas.hover({ position: { x: 24, y: row2Y } })
  await expect(canvas).toHaveAttribute("title", "localhost:3000 is arc's")
  await canvas.click({ position: { x: 24, y: row2Y } })
  const toast = page
    .getByRole("region", { name: "Notifications" })
    .getByRole("listitem")
    .filter({ hasText: "localhost:3000 is arc's" })
  await expect(toast).toBeVisible()
  await expect(toast).toContainText("It opens here once port forwarding comes.")
  await shot(page, "terminal-localhost", { toasts: true })
  await toast.getByRole("button", { name: "Copy" }).click()
  const clipboard = () =>
    window!.app.evaluate(({ clipboard }) => clipboard.readText())
  await expect.poll(clipboard).toBe("http://localhost:3000/")
  expect(
    await window!.app.evaluate(
      () => (globalThis as { linkOpens?: string[] }).linkOpens
    )
  ).toHaveLength(1)
})

test("arc in a black hole: the pill shows within the keepalive's time, and a key says so without hanging", async () => {
  test.setTimeout(180_000)
  const { page, composer } = await onArc()
  const screen = await terminalOn(page, composer)
  await screen.click()
  arc!.blackhole(true)
  await expect.poll(() => arc!.applies()?.hole).toBe(true)
  // A quiet link: the key waits for the ping's answer, or the keepalive
  // that ends the forward, whichever comes first (ADR 0106, #1223).
  const typed = Date.now()
  await page.keyboard.press("KeyA")
  const pill = pillOf(page, screen)
  // ssh's keepalive: 5 s by 3 asks, then 5 s more, and the ping's 3 s.
  await expect(pill).toHaveText("arc is away", { timeout: 40_000 })
  await expect(
    screen
      .locator("..")
      .getByText(/your typing (was not sent|may have gone through)/)
  ).toBeVisible()
  expect(Date.now() - typed).toBeLessThan(40_000)
  arc!.blackhole(false)
  await expect(pill).toHaveCount(0, { timeout: 90_000 })
})
