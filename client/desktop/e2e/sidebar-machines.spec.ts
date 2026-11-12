/**
 * Machines in the sidebar (ADR 0098, decision 18; S13), with arc.ts's
 * arc. Another machine's cards are ordinary cards; when the window no
 * longer reaches it, they stay where they are, dimmed in place, and line
 * 3 says since when, "arc · away 1m"; a working one sleeps, offline, and
 * so does the bar's logo, which names arc. A question from arc is still
 * the Person's turn. Back, the cards update silently: what ended there
 * meanwhile is told of nowhere, and what ends after is. The foot shows a
 * dot for each machine, this one first; a click lists them with how each
 * stands, arc's battery and whether it stays awake (ADR 0097), and
 * Machines…, which opens their settings.
 *
 * Shot dark and light at 1440×900 as `sidebar-s13-<name>-<mode>.png`:
 * the away cards, the bar's logo asleep, the foot's dots and the
 * machines' popover.
 */
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { expect, type Locator, type Page, test } from "@playwright/test"
import { type Arc, newArc, put, withArc } from "./arc"
import {
  firstThread,
  GLASS,
  leaveSidebar,
  placeOf,
  send,
  sidebarOf,
  toastsOf,
  topsOf,
  wallpaper,
  type Window,
} from "./window"

let window: Window | undefined
let arc: Arc | undefined
let stopArc: (() => Promise<void>) | undefined

test.afterEach(async () => {
  await window?.close()
  await stopArc?.()
  arc?.close()
  window = arc = stopArc = undefined
})

/** The Inbox, one list, its cards of three lines in Your turn. */
const INBOX = 'preset = "inbox"\n'

/** The card of the Thread named `title`: its name starts with it. */
const cardOf = (scope: Locator, title: string) =>
  scope.getByRole("option", { name: new RegExp(`^${title},`) })

/** A card's lines, top down. */
const linesOf = (card: Locator) => card.locator(":scope > span")

/** arc's dot in the sidebar's foot. */
const dotOf = (page: Page, name = "arc") =>
  sidebarOf(page).locator(`[data-machine-dot="${name}"]`)

/** The foot's machines, which open their popover. */
const machinesOf = (page: Page) =>
  sidebarOf(page).getByRole("button", { name: /^Machines: / })

const popoverOf = (page: Page) => page.getByRole("dialog", { name: "Machines" })

/** arc's Project banda, with a Thread for each of `titles`, each as the
 * fake Agent takes its words; the Project's id. */
async function seed(arc: Arc, titles: readonly string[]): Promise<string> {
  const folder = join(arc.code.arc, "banda")
  put(arc.disk(folder), { "README.md": "arc\n" })
  const banda = JSON.parse(arc.banda("project", "add", folder)).ok.id as string
  for (const title of titles) {
    arc.send(banda, title)
    await expect
      .poll(() => arc.states(banda).find(([one]) => one === title)?.[1])
      // One that asks is at work, its turn waiting on the Person.
      .toBe(/wait|ask/.test(title) ? "running" : "done")
  }
  return banda
}

/** Ends the turn at work in arc's Thread `title`, from arc itself. */
function finishOnArc(arc: Arc, project: string, title: string) {
  const { ok } = JSON.parse(
    arc.banda("call", "agents.threads", "--project", project)
  ) as { ok: { threads: { id: string; title: string }[] } }
  const thread = ok.threads.find((one) => one.title === title)!.id
  arc.banda(
    "call",
    "agents.send",
    "--project",
    project,
    "--params",
    JSON.stringify({ thread, text: "go", steer: true })
  )
}

/** The window at 1440×900, its desk's glass made of a picture. */
async function wide({ app, page, dir }: Window) {
  wallpaper(dir)
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900)
  )
  await page.setViewportSize({ width: 1440, height: 900 })
}

/** The window in `mode`, on its glass, with no motion, as sidebar-card's
 * pictures are. */
async function look({ page, dir }: Window, mode: "dark" | "light") {
  const html = page.locator("html")
  writeFileSync(
    join(dir, "config/look.toml"),
    `mode = "${mode}"\n${GLASS}[motion]\noff = true\n`
  )
  if (mode === "dark") await expect(html).toHaveClass(/\bdark\b/)
  else await expect(html).not.toHaveClass(/\bdark\b/)
  await page.waitForTimeout(250)
}

/**
 * The window dark and light, as `sidebar-s13-<name>-<mode>`, and each of
 * `parts` alone, as `sidebar-s13-<name>-<part>-<mode>`; with the
 * machines' popover open, where `popover`, nothing focused before. The
 * pointer is away from the list, which holds still under it.
 */
async function shots(
  window: Window,
  name: string,
  parts: Readonly<Record<string, Locator>> = {},
  { popover = false } = {}
) {
  const { page } = window
  for (const mode of ["dark", "light"] as const) {
    await look(window, mode)
    // No ring left on the foot by the Escape that closed its popover: a
    // pointer's click opens it, as a Person's does.
    await page.evaluate(() => (document.activeElement as HTMLElement).blur())
    if (popover) {
      await machinesOf(page).click()
      await expect(popoverOf(page)).toBeVisible()
      await page.waitForTimeout(250)
    } else await page.mouse.move(1400, 450)
    await page.screenshot({
      path: `test-results/sidebar-s13-${name}-${mode}.png`,
      animations: "disabled",
    })
    for (const [part, locator] of Object.entries(parts))
      await locator.screenshot({
        path: `test-results/sidebar-s13-${name}-${part}-${mode}.png`,
        animations: "disabled",
      })
    if (popover) {
      await page.keyboard.press("Escape")
      await expect(popoverOf(page)).toHaveCount(0)
    }
  }
}

test("with arc away, its cards stay where they are, dimmed, saying 'arc · away 1m'; its working one sleeps, and so does the logo; its question stays the Person's turn; back, the cards update with no toast (ADR 0098, decision 18)", async () => {
  test.setTimeout(420_000)
  arc = newArc()
  stopArc = await arc.start()
  const banda = await seed(arc, [
    "please ask first",
    "Hold arc, wait",
    "Done on arc",
  ])
  window = await withArc(arc, {
    sidebar: INBOX,
    files: { "config/machine.toml": 'name = "mac"\nicon = "laptop"\n' },
  })
  const { page } = window
  await firstThread(page)
  await wide(window)
  await leaveSidebar(page)
  await send(window, "Sidebar for arc")
  const sidebar = sidebarOf(page)
  const panel = sidebar.getByRole("tabpanel")
  const asks = cardOf(panel, "please ask first")
  const working = cardOf(panel, "Hold arc, wait")
  const done = cardOf(panel, "Done on arc")
  const mine = cardOf(panel, "Sidebar for arc")
  for (const card of [asks, working, done, mine])
    await expect(card).toBeVisible()
  await expect(asks).toContainText("Asks Run a check")
  await expect(dotOf(page)).toHaveAttribute("data-standing", "live")
  await expect(working.locator("svg[data-look]")).toHaveAttribute(
    "data-look",
    "working"
  )
  const cards = panel.getByRole("option")
  const tops = await topsOf(cards)
  const logo = page
    .getByRole("banner")
    .getByRole("button", { name: /^Banda menu/ })
  await expect(logo).not.toHaveAccessibleName(/away/)

  // arc goes into a black hole: the window hears nothing from it, and
  // after a while finds it away.
  arc.blackhole(true)
  await expect(dotOf(page)).toHaveAttribute("data-standing", "away", {
    timeout: 60_000,
  })
  // Its cards dim in place, over --dur-slow, and stay where they were;
  // this machine's does not dim.
  for (const card of [asks, working, done]) {
    await expect(card).toHaveAttribute("data-away", "")
    await expect
      .poll(() => card.evaluate((one) => getComputedStyle(one).opacity))
      .toBe("0.55")
  }
  expect(
    await asks.evaluate((one) => getComputedStyle(one).transitionDuration)
  ).toBe("0.32s")
  await expect(mine).not.toHaveAttribute("data-away")
  expect(await mine.evaluate((one) => getComputedStyle(one).opacity)).toBe("1")
  expect(await topsOf(cards)).toEqual(tops)
  // Its working one sleeps, offline, still in Working; the logo sleeps
  // too, and says why.
  await expect(working.locator("svg[data-look]")).toHaveAttribute(
    "data-look",
    "offline"
  )
  await expect(placeOf(panel, "Working").getByRole("option")).toContainText([
    "Hold arc, wait",
  ])
  await expect(logo).toHaveAccessibleName(/arc is away with Agents at work/)
  // Its question is still the Person's turn, among the Threads under
  // Your turn, and says so.
  await expect(placeOf(panel, "Threads").getByRole("option")).toContainText([
    "please ask first",
  ])
  await expect(asks).toHaveAccessibleName(/^please ask first, Asks, /)
  // Line 3 says it after arc's name, by a card's short steps, as the
  // minute comes since the window last heard it.
  const third = linesOf(asks).nth(2)
  await expect(third.locator('[data-machine-card="arc"]')).toHaveText("arc")
  await expect(third).toContainText("· away 1m", { timeout: 120_000 })
  await expect(asks).toHaveAccessibleDescription(/arc is away, 1 minute/)
  expect(await topsOf(cards)).toEqual(tops)

  // The foot says it: arc's dot is grey, and its popover says since when.
  await expect(dotOf(page)).toHaveAttribute("title", /^arc · away \d+m$/)
  await machinesOf(page).click()
  const popover = popoverOf(page)
  const arcRow = popover.getByRole("group", { name: "arc", exact: true })
  await expect(arcRow.locator("[data-machine-words]")).toHaveText(/^away \d+m$/)
  // Away, its battery is no longer known: none shows.
  await expect(arcRow).not.toContainText("%")
  await page.keyboard.press("Escape")
  // The bar, its logo asleep for arc at work, alone too.
  await shots(window, "away", {
    card: asks,
    foot: footOf(page),
    bar: page.getByRole("banner"),
  })
  await shots(window, "away-popover", {}, { popover: true })

  // Meanwhile on arc, its Agent's turn ends: nothing reaches the window.
  finishOnArc(arc, banda, "Hold arc, wait")
  await expect
    .poll(() => arc!.states(banda).find(([one]) => one === "Hold arc, wait"))
    .toEqual(["Hold arc, wait", "done"])
  const told = toastsOf(page).getByRole("listitem")
  const before = await told.count()

  // Back: the cards update silently, undimmed; what ended there while it
  // was away is Done in Your turn, told of nowhere.
  arc.blackhole(false)
  await expect(dotOf(page)).toHaveAttribute("data-standing", "live", {
    timeout: 90_000,
  })
  await leaveSidebar(page)
  await expect(working).toHaveAccessibleName(/^Hold arc, wait, Done, /, {
    timeout: 30_000,
  })
  await expect(panel.locator("[data-card][data-away]")).toHaveCount(0)
  await expect(logo).not.toHaveAccessibleName(/away/)
  for (let at = 0; at < 6; at++) {
    await expect(told.filter({ hasText: "Hold arc, wait" })).toHaveCount(0)
    await page.waitForTimeout(500)
  }
  expect(await told.count()).toBeLessThanOrEqual(before)
  // What ends there now is told, as ever.
  arc.send(banda, "Fresh on arc")
  await expect(told.filter({ hasText: "Fresh on arc" })).toBeVisible({
    timeout: 30_000,
  })
})

/** The sidebar's foot, below its list. */
const footOf = (page: Page) => machinesOf(page).locator("xpath=..")

test("the foot shows a dot for each machine, this one first; a click lists them with arc's battery and whether it stays awake, and Machines… opens their settings (ADR 0098, decisions 18 and 21)", async () => {
  test.setTimeout(240_000)
  arc = newArc()
  stopArc = await arc.start()
  await seed(arc, ["Hold arc, wait"])

  // With no other machine, the foot shows none.
  const alone = await withArc(arc, {
    sidebar: INBOX,
    files: { "config/hosts.toml": "" },
  })
  await expect(
    sidebarOf(alone.page).getByRole("button", { name: "Settings" })
  ).toBeVisible()
  await expect(machinesOf(alone.page)).toHaveCount(0)
  await alone.close()

  window = await withArc(arc, {
    sidebar: INBOX,
    files: { "config/machine.toml": 'name = "mac"\nicon = "laptop"\n' },
  })
  const { page } = window
  await wide(window)
  const machines = machinesOf(page)
  await expect(machines).toBeVisible()
  // Each machine is a dot and its name, this one first, live and green;
  // how each stands is in its tooltip and the button's name.
  const dots = machines.locator("[data-machine-dot]")
  await expect(dots).toHaveText(["mac", "arc"])
  await expect(dotOf(page, "this")).toHaveAttribute("title", "mac · this")
  await expect(dotOf(page)).toHaveAttribute("title", "arc · live", {
    timeout: 60_000,
  })
  await expect(machines).toHaveAccessibleName("Machines: mac, this; arc, live")
  const green = await dotOf(page)
    .locator("i")
    .evaluate((one) => getComputedStyle(one).backgroundColor)
  const added = await page.evaluate(() => {
    const probe = document.body.appendChild(document.createElement("i"))
    probe.style.color = "var(--added)"
    const colour = getComputedStyle(probe).color
    probe.remove()
    return colour
  })
  expect(green).toBe(added)
  // The foot's other buttons stay on the left; the machines on the right.
  const settings = sidebarOf(page).getByRole("button", { name: "Settings" })
  const left = (await settings.boundingBox())!
  const right = (await machines.boundingBox())!
  const aside = (await sidebarOf(page).boundingBox())!
  expect(right.x).toBeGreaterThan(left.x + aside.width / 3)
  expect(right.x + right.width).toBeLessThanOrEqual(aside.x + aside.width)

  // A click lists them: mac, this machine; arc, live, with why it is
  // awake, its Agent at work there, and its battery where this machine,
  // whose engine arc's is, has one.
  await machines.click()
  const popover = popoverOf(page)
  await expect(popover).toBeVisible()
  const rows = popover.getByRole("group")
  await expect(rows).toHaveCount(2)
  const macRow = popover.getByRole("group", { name: "mac", exact: true })
  await expect(macRow.locator("[data-machine-words]")).toHaveText("this")
  const arcRow = popover.getByRole("group", { name: "arc", exact: true })
  await expect(arcRow.locator("[data-machine-words]")).toHaveText("live")
  await expect(arcRow).toContainText("While 1 Agent works there")
  await page.keyboard.press("Escape")
  await expect(popover).toHaveCount(0)
  await shots(window, "foot", { foot: footOf(page) })
  await shots(window, "popover", {}, { popover: true })

  // Machines… opens Settings at Machines, arc's row among them.
  await machines.click()
  await popover.getByRole("button", { name: "Machines…" }).click()
  await expect(popover).toHaveCount(0)
  const settingsPane = page.getByRole("region", {
    name: "Settings",
    exact: true,
  })
  await expect(settingsPane.locator('[data-key="arc"]')).toBeVisible()
})
