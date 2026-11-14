/**
 * The sidebar's card (ADR 0098, S6a): three lines wherever it stands,
 * each a left and a right; grouped by Project, line 3 leaves the Project
 * to its header (decisions 8 and 9, as amended). Colour only on a call's mark
 * and time: an asking card is orange, says Asks and its question; Failed
 * is red, says why, and has nothing on its right; Done is green with its
 * note, which is never red; Woke is yellow and says who put it off. Later
 * says when it wakes on 24 hours. Each card, and the Inbox whole, is
 * screenshot in the dark and the light at 1440×900, as
 * `sidebar-s6a-*.png`.
 *
 * Threads start from outside the Window, as `banda call` starts them: one
 * whose first message says "wait" works until it is finished, "fail" fails
 * and "ask" asks; any other is answered at once and, unseen, calls its
 * Person. A Thread away from its Project's workspace bears a small diamond
 * at the start of line 3's right (ADR 0102, decision 6), shot as
 * `sidebar-s6a-away-*`.
 *
 * S6b: another machine's card, arc's, is an ordinary card, its icon on
 * line 3, alone where sidebar.toml asks; a long title fades out at its end and shows whole beside the
 * sidebar after a 500 ms rest; the counts' list draws the same cards.
 * Shot as `sidebar-s6b-*.png`.
 *
 * A working card says what its Agent does, held as its Mark shows it (ADR
 * 0099, M3b): line 2's words, its time at a usage limit, and what a
 * screen reader hears. The Working tab with its
 * Agents each at something else is shot as `sidebar-m3b-working-*`.
 *
 * F1b: a Done card shows on line 2's right how many lines its last work
 * added and removed, `+2 −1` in grey; a Failed card nothing there. Shot as
 * `sidebar-f1b-diff-*`.
 *
 * F2: a Thread that links a pull request shows its chip there instead,
 * `#1061 ✓`, its glyph alone in a colour; several show how many. The
 * engine reads them through a `gh` of the test's own. Shot as
 * `sidebar-f2-chips-*`.
 */
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, type Locator, type Page, test } from "@playwright/test"
import { type Arc, newArc, put, withArc } from "./arc"
import {
  agentSays,
  call,
  finish,
  firstThread,
  GLASS,
  leaveSidebar,
  placeOf,
  send,
  sidebarOf,
  startWindow,
  threadNamed,
  toastsOf,
  wallpaper,
  type Window,
} from "./window"

let window: Window
let arc: Arc | undefined
let stopArc: (() => Promise<void>) | undefined

test.afterEach(async () => {
  await window?.close()
  await stopArc?.()
  arc?.close()
  arc = stopArc = undefined
})

/** The Flow's button, on the bar beside the workspaces (ADR 0098,
 * decision 20). */
const flowOf = (page: Page) =>
  page.getByRole("banner").getByRole("button", { name: /^Flow: / })

/** Picks the Flow `name` in its menu, which Esc then closes. */
async function pickFlow(page: Page, name: "Free" | "Row") {
  await flowOf(page).click()
  await page
    .getByRole("menuitemradio", { name: new RegExp(`^${name}`) })
    .click()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("menuitemradio")).toHaveCount(0)
  await expect(flowOf(page)).toHaveAccessibleName(`Flow: ${name}`)
}

/** The id of Work's Thread named `title`. */
const idOf = (window: Window, title: string) => threadNamed(window, title)!.id

/** The card of the Thread named `title`: its name starts with it. */
const cardOf = (scope: Locator, title: string) =>
  scope.getByRole("option", { name: new RegExp(`^${title},`) })

/** A card's lines, top down. */
const linesOf = (card: Locator) => card.locator(":scope > span")

/** A card's Mark. */
const markOf = (card: Locator) => card.locator("svg[data-look]")

/** The colour `element`'s text is drawn in. */
const colourOf = (element: Locator) =>
  element.evaluate((one) => getComputedStyle(one).color)

/** The colour of a card's Mark: its Agent's tile's. */
const markColourOf = (card: Locator) =>
  colourOf(card.locator("svg[data-look] [data-agent]"))

/** The colour the theme's `token` is, as the page draws it. */
const tokenOf = (page: Page, token: string) =>
  page.evaluate((name) => {
    const probe = document.body.appendChild(document.createElement("i"))
    probe.style.color = `var(${name})`
    const colour = getComputedStyle(probe).color
    probe.remove()
    return colour
  }, token)

/** The window at 1440×900, its desk's glass made of a picture. */
async function wide(window: Window) {
  const { app, page, dir } = window
  wallpaper(dir)
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900)
  )
  await page.setViewportSize({ width: 1440, height: 900 })
}

/**
 * The window in `mode`, on its glass, with no motion; the desk's picture
 * has painted, and no toast is on its way out, which would leave the one
 * behind it blank. Its pictures leave the animations be: with no motion
 * none plays but a cut text's fade, whose timeline is the text's own
 * scroll, and Playwright's `animations: "disabled"` would cancel it.
 */
async function look(window: Window, mode: "dark" | "light", more = "") {
  const { page, dir } = window
  const html = page.locator("html")
  writeFileSync(
    join(dir, "config/look.toml"),
    `mode = "${mode}"\n${GLASS}[motion]\noff = true\n${more}`
  )
  if (mode === "dark") await expect(html).toHaveClass(/\bdark\b/)
  else await expect(html).not.toHaveClass(/\bdark\b/)
  // The desk's picture paints a frame after the look comes.
  await page.waitForTimeout(250)
  await expect(
    page.locator('[data-sonner-toast][data-removed="true"]')
  ).toHaveCount(0)
}

/**
 * The window as it is now, dark and light, as
 * `sidebar-<step>-<name>-<mode>`, and each of `cards` alone beside it, as
 * `sidebar-<step>-<name>-<card>-<mode>`. The pointer is away from the
 * list, which holds still under it.
 */
async function shots(
  window: Window,
  name: string,
  cards: Readonly<Record<string, Locator>> = {},
  step = "s6a"
) {
  const { page } = window
  await page.mouse.move(1400, 450)
  for (const mode of ["dark", "light"] as const) {
    await look(window, mode)
    await page.screenshot({
      path: `test-results/sidebar-${step}-${name}-${mode}.png`,
      animations: "disabled",
    })
    for (const [card, locator] of Object.entries(cards))
      await locator.screenshot({
        path: `test-results/sidebar-${step}-${name}-${card}-${mode}.png`,
        animations: "disabled",
      })
  }
}

/**
 * `card` with the focus, its action over it, dark and light, as
 * `sidebar-s6a-<name>-focus-<mode>`. The action shows by the focus here:
 * Tailwind's hover asks for (hover: hover), which the window under test
 * does not match.
 */
async function focusShots(window: Window, name: string, card: Locator) {
  for (const mode of ["dark", "light"] as const) {
    await look(window, mode)
    await card.hover()
    await card.locator("xpath=..").screenshot({
      path: `test-results/sidebar-s6a-${name}-focus-${mode}.png`,
    })
    await leaveSidebar(window.page)
  }
}

test("a card's three lines: Asks orange on its mark and time with its question, Failed red with why and nothing on its right, Done green with its note, Woke yellow; one line for the rest, two grouped by Project (ADR 0098, S6a)", async () => {
  test.setTimeout(300_000)
  window = await startWindow({ look: 'mode = "dark"\n' })
  const { page } = window
  await firstThread(page)
  await wide(window)

  const sidebar = sidebarOf(page)
  const panel = sidebar.getByRole("tabpanel")
  const asks = cardOf(panel, "please ask first")
  const failed = cardOf(panel, "fail now")
  const done = cardOf(panel, "wait toast")
  const woke = cardOf(panel, "nap one")
  const open = cardOf(panel, "read one")
  const working = cardOf(panel, "wait one")
  // The list holds still under the pointer: it leaves.
  await leaveSidebar(page)

  // One of each place: open, put off, archived, at work.
  await send(window, "read one")
  call(window, "agents.read", { thread: idOf(window, "read one") })
  await send(window, "sleep one")
  call(window, "agents.later", {
    thread: idOf(window, "sleep one"),
    after: "2h",
  })
  await send(window, "old one")
  call(window, "agents.archive", { thread: idOf(window, "old one") })
  await send(window, "wait one")
  // Woke: put off for two seconds, its time wakes it into Your turn.
  await send(window, "nap one")
  call(window, "agents.later", {
    thread: idOf(window, "nap one"),
    until: Date.now() + 2000,
  })
  await expect(woke.getByRole("img", { name: "Woke" })).toBeVisible()
  // Your turn: one that fails, one that asks, one done with its note. The
  // note is its Agent's, from the Thread whose session opened last: the
  // one that asks has asked before it starts.
  call(window, "agents.send", {
    harness: "fake",
    text: "fail now",
    settings: null,
  })
  await expect
    .poll(() => threadNamed(window, "fail now")?.latest?.state)
    .toBe("failed")
  call(window, "agents.send", {
    harness: "fake",
    text: "please ask first",
    settings: null,
  })
  await expect(asks).toContainText("Asks Run a check")
  await send(window, "wait toast")
  await agentSays(window, "notify", { text: "Toast and a test added" })
  finish(window, "wait toast")
  await expect
    .poll(() => threadNamed(window, "wait toast")?.latest?.state)
    .toBe("done")

  const attention = await tokenOf(page, "--attention")
  const destructive = await tokenOf(page, "--destructive")
  const added = await tokenOf(page, "--added")
  const yellow = await tokenOf(page, "--woke-text")

  // Asks: orange on its mark and its time, and nowhere else; line 2 says
  // Asks and its question, in the text's colours.
  await expect(asks).toHaveAttribute("data-tone", "attention")
  await expect(linesOf(asks)).toHaveCount(3)
  expect(await markColourOf(asks)).toBe(attention)
  expect(await colourOf(asks.locator("[data-time]"))).toBe(attention)
  expect(
    await colourOf(linesOf(asks).nth(1).locator(":scope > span"))
  ).not.toBe(attention)
  expect(
    await colourOf(asks.getByText("please ask first", { exact: true }).first())
  ).not.toBe(attention)

  // Failed: red on its mark and time, says why, and nothing on the right
  // of line 2.
  await expect(failed).toHaveAttribute("data-tone", "destructive")
  await expect(linesOf(failed).nth(1)).toContainText(/^Failed \S/)
  await expect(linesOf(failed).nth(1).locator(":scope > *")).toHaveCount(1)
  expect(await markColourOf(failed)).toBe(destructive)
  expect(await colourOf(failed.locator("[data-time]"))).toBe(destructive)

  // Done: green on its mark and time, with its note, which is never red,
  // nor green.
  await expect(done).toContainText("Done Toast and a test added")
  await expect(done).toHaveAttribute("data-tone", "added")
  expect(await markColourOf(done)).toBe(added)
  expect(await colourOf(done.locator("[data-time]"))).toBe(added)
  const note = linesOf(done).nth(1).locator(":scope > span")
  expect(await colourOf(note)).not.toBe(destructive)
  expect(await colourOf(note)).not.toBe(added)

  // Woke: yellow on its time, darker as small text on a light theme; it
  // says who put it off.
  await expect(woke).toHaveAttribute("data-tone", "woke")
  await expect(linesOf(woke).nth(1)).toContainText(/^Woke You put it off /)
  expect(await colourOf(woke.locator("[data-time]"))).toBe(yellow)

  // Open and at work: three lines each too, with no colour; the time is
  // short.
  await expect(linesOf(open)).toHaveCount(3)
  await expect(linesOf(working)).toHaveCount(3)
  await expect(open).not.toHaveAttribute("data-tone")
  await expect(working.locator("[data-time]")).toHaveText(/^(now|\d+[smh])$/)
  // The open Thread's card has a fill of the text, with no shadow and no
  // border.
  await open.click()
  await expect(open).toHaveAttribute("aria-current", "true")
  expect(await open.evaluate((one) => getComputedStyle(one).boxShadow)).toBe(
    "none"
  )
  await shots(window, "inbox", {
    "turn-3-asks": asks,
    "turn-3-failed": failed,
    "turn-3-done": done,
    "turn-3-woke": woke,
    "open-3": open,
    "working-3": working,
  })

  // Later and the Archive: three lines each.
  const tab = (name: string) =>
    sidebar.getByRole("tab", { name: new RegExp(`^${name}`) })
  await tab("Later").click()
  const later = cardOf(panel, "sleep one")
  await expect(linesOf(later)).toHaveCount(3)
  // On 24 hours, whatever the system's locale: "18:30" or "Wed 9:00".
  await expect(later.locator("[data-time]")).toHaveText(
    /^([A-Z][a-z]{2} )?\d{1,2}:\d\d$/
  )
  await shots(window, "later", { "later-3": later })
  await tab("Archive").click()
  const archived = cardOf(panel, "old one")
  await expect(linesOf(archived)).toHaveCount(3)
  await shots(window, "archive", { "archive-3": archived })
  await tab("Inbox").click()
  await leaveSidebar(page)

  // Grouped by Project, the cards keep three lines: line 3 leaves the
  // Project to the header.
  writeFileSync(join(window.dir, "config/sidebar.toml"), 'group = "project"\n')
  await expect(placeOf(sidebar, "Work").first()).toBeVisible()
  for (const card of [asks, failed, woke, open]) {
    await expect(linesOf(card)).toHaveCount(3)
    await expect(linesOf(card).nth(2)).not.toContainText("Work")
  }
  await shots(window, "grouped", {
    "turn-3-asks": asks,
    "turn-3-failed": failed,
    "turn-3-done": done,
    "turn-3-woke": woke,
  })
})

test("a Thread away from its Project's workspace bears a small diamond at the start of line 3's right, which the card's acts never cover: the Later clock, or Wake in Later (ADR 0102, decision 6; S6b)", async () => {
  test.setTimeout(180_000)
  window = await startWindow({ look: 'mode = "dark"\n' })
  const { page } = window
  await firstThread(page)
  await wide(window)
  const sidebar = sidebarOf(page)
  const panel = sidebar.getByRole("tabpanel")
  const stray = cardOf(panel, "stray one")
  const asks = cardOf(panel, "please ask first")

  // In free, two Threads of Work start on a workspace of no Project: one
  // answered while the Person looks, one that asks.
  await pickFlow(page, "Free")
  await page.getByRole("button", { name: "New workspace" }).click()
  const box = page
    .getByRole("region", { name: "New Thread" })
    .getByRole("textbox", { name: "Message to Fake AI" })
  const start = async (text: string) => {
    await page.keyboard.press("Alt+Enter")
    await expect(box).toBeFocused()
    await box.fill(text)
    await box.press("Enter")
    await expect(
      page.getByRole("region", { name: text, exact: true })
    ).toBeVisible()
  }
  await start("stray one")
  await expect
    .poll(() => threadNamed(window, "stray one")?.latest?.state)
    .toBe("done")
  await start("please ask first")
  await expect(asks).toContainText("Asks Run a check")
  await expect(stray.locator(".lucide-diamond")).toHaveCount(0)

  /** `card`'s diamond: at the start of line 3's right, after its Project
   * and before its Harness's emblem, never on line 1's right. A screen
   * reader hears it once, in the card's description. While the card's act
   * `name` shows, the time hides under it and the diamond stays in
   * sight. */
  const away = async (card: Locator, name: string) => {
    const diamond = linesOf(card).nth(2).locator(".lucide-diamond")
    await expect(diamond).toBeVisible()
    await expect(card.locator(".lucide-diamond")).toHaveCount(1)
    await expect(diamond).toHaveAttribute("aria-hidden", "true")
    await expect(
      card.getByTitle("Away from its Project's workspace")
    ).toBeVisible()
    await expect(card).toHaveAttribute(
      "aria-description",
      /Away from its Project's workspace$/
    )
    const mark = (await diamond.boundingBox())!
    // Line 3's right starts with it, before the emblem.
    const third = linesOf(card).nth(2)
    const right = third.locator(":scope > span").last().locator(":scope > *")
    await expect(right.first()).toHaveAttribute(
      "title",
      "Away from its Project's workspace"
    )
    const project = (await third
      .locator("[data-slot=fade-text]")
      .boundingBox())!
    const emblem = (await right.last().boundingBox())!
    expect(mark.x).toBeGreaterThanOrEqual(project.x + project.width)
    expect(mark.x + mark.width).toBeLessThanOrEqual(emblem.x)
    // The acts show under the pointer: a card takes no focus (S7b).
    await card.hover()
    const action = card
      .locator("xpath=..")
      .locator(`[data-act="${name.toLowerCase()}"]`)
    await expect(action).toBeVisible()
    await expect(action).toHaveAttribute("aria-label", name)
    // The time fades out where the acts show (spec S7a).
    await expect(card.locator("[data-acts-time]")).toHaveCSS("opacity", "0")
    await expect(diamond).toBeVisible()
    const box = (await action.boundingBox())!
    // §2.5's size, level with line 1.
    const line = (await linesOf(card).first().boundingBox())!
    expect(box.height).toBe(20)
    expect(box.y + box.height / 2).toBeCloseTo(line.y + line.height / 2, 0)
    await leaveSidebar(card.page())
    await expect(card.locator("[data-acts-time]")).toHaveCSS("opacity", "1")
  }

  // Back in the row, Work has its own workspace: both stand away from it.
  await pickFlow(page, "Row")
  await leaveSidebar(page)
  await expect(linesOf(stray)).toHaveCount(3)
  await expect(linesOf(asks)).toHaveCount(3)
  await away(stray, "Later")
  await away(asks, "Later")
  await shots(window, "away", { "open-3": stray, "turn-3-asks": asks })
  await focusShots(window, "away-turn-3-asks", asks)

  // Put off, its act is Wake: the diamond stays in sight beside it.
  call(window, "agents.later", {
    thread: idOf(window, "stray one"),
    after: "2h",
  })
  await expect.poll(() => threadNamed(window, "stray one")?.later).toBeTruthy()
  await sidebar.getByRole("tab", { name: /^Later/ }).click()
  await leaveSidebar(page)
  await expect(linesOf(stray)).toHaveCount(3)
  await away(stray, "Wake")
  await focusShots(window, "away-later-3", stray)
})

/** The Inbox, with the counts always on the bar. */
const INBOX = 'group = "none"\n[bar]\nshow = "always"\n'

/** The counts in the bar's middle, where the Person lists them: none
 * stand there by default (ADR 0098, decision 22). */
const COUNTS = '[bar]\ncenter = ["sidebar.counts"]\n'

/** A title too long for a card of the sidebar. */
const LONG = "Bench the window tests on arc against the new sidebar cards"

test("another machine's card is an ordinary card, its icon on line 3; a long title fades out at its end and shows whole beside the sidebar after a 500 ms rest, one that fits gets no fade and no tooltip; the counts' list draws the same cards (ADR 0098, S6b; #1067)", async () => {
  test.setTimeout(300_000)
  // arc holds two Threads done in its Project banda; this machine, named
  // mac, one in Work. The sidebar is the Inbox, so arc's cards stand among
  // mac's, and the counts are always on the bar.
  arc = newArc()
  stopArc = await arc.start()
  const folder = join(arc.code.arc, "banda")
  put(arc.disk(folder), { "README.md": "arc\n" })
  const banda = JSON.parse(arc.banda("project", "add", folder)).ok.id as string
  for (const title of [LONG, "Done on arc"]) {
    arc.send(banda, title)
    await expect
      .poll(() => arc!.states(banda).find(([one]) => one === title)?.[1])
      .toBe("done")
  }
  window = await withArc(arc, {
    sidebar: INBOX,
    files: { "config/machine.toml": 'name = "mac"\nicon = "laptop"\n' },
  })
  const { page } = window
  await firstThread(page)
  await wide(window)
  const sidebar = sidebarOf(page)
  const panel = sidebar.getByRole("tabpanel")
  await leaveSidebar(page)
  await send(window, "Sidebar for arc")
  const mac = cardOf(panel, "Sidebar for arc")
  const there = cardOf(panel, LONG)
  const fits = cardOf(panel, "Done on arc")
  await expect(there).toBeVisible()
  await expect(mac).toBeVisible()

  // Both are ordinary cards: three lines each, drawn alike; arc's names
  // its machine on line 3, its icon and its name, and on no other line;
  // mac's names none, as this machine's.
  for (const card of [mac, there, fits])
    await expect(linesOf(card)).toHaveCount(3)
  expect(await there.getAttribute("class")).toBe(
    await mac.getAttribute("class")
  )
  const third = linesOf(there).nth(2)
  await expect(third.locator('[data-machine-icon="server"]')).toBeVisible()
  await expect(third).toContainText("banda")
  await expect(third).toContainText("arc")
  await expect(there.locator("[data-machine-icon]")).toHaveCount(1)
  await expect(mac.locator("[data-machine-icon]")).toHaveCount(0)
  await expect(linesOf(mac).nth(2)).toContainText("Work")

  // The long title fades out at its end, with no "…"; one that fits has
  // no mask at all.
  const titleOf = (card: Locator) =>
    linesOf(card).first().locator("[data-slot=fade-text]")
  const styleOf = (one: Locator) =>
    one.evaluate((element) => {
      const { maskImage, textOverflow } = getComputedStyle(element)
      return { maskImage, textOverflow }
    })
  const long = await styleOf(titleOf(there))
  expect(long.maskImage).toMatch(
    /^linear-gradient\(90deg, .* calc\(100% - 28px\), rgba\(0, 0, 0, 0\)\)$/
  )
  expect(long.textOverflow).toBe("clip")
  expect((await styleOf(titleOf(fits))).maskImage).toBe("none")

  // At rest on it, the whole title shows after 500 ms, past the sidebar's
  // right, level with it, at most 320 px wide and 3 lines high; on one
  // that fits, nothing shows.
  const tip = page.locator("[data-slot=cut-tip]")
  const restOn = async (card: Locator) => {
    const at = (await titleOf(card).boundingBox())!
    await page.mouse.move(at.x + 24, at.y + at.height / 2)
    return at
  }
  await restOn(fits)
  await page.waitForTimeout(900)
  await expect(tip).toHaveCount(0)
  await leaveSidebar(page)
  const from = Date.now()
  const title = await restOn(there)
  await expect(tip).toHaveText(LONG)
  expect(Date.now() - from).toBeGreaterThanOrEqual(500)
  const box = (await tip.boundingBox())!
  const edge = (await sidebar.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(edge.x + edge.width)
  expect(box.width).toBeLessThanOrEqual(320)
  expect(box.height).toBeLessThanOrEqual(3 * 16 + 8)
  expect(Math.abs(box.y - title.y)).toBeLessThanOrEqual(4)
  await leaveSidebar(page)
  await expect(tip).toHaveCount(0)

  // The pictures: the long title faded with its tooltip, mac's and arc's
  // cards side by side, dark and light.
  for (const mode of ["dark", "light"] as const) {
    await look(window, mode)
    await restOn(there)
    await expect(tip).toBeVisible()
    await tip.evaluate((one) =>
      Promise.all(one.getAnimations().map((played) => played.finished))
    )
    await page.screenshot({
      path: `test-results/sidebar-s6b-tip-${mode}.png`,
    })
    await leaveSidebar(page)
    await expect(tip).toHaveCount(0)
  }
  await shots(window, "machines", { mac, arc: there }, "s6b")

  // Asked for its icon alone (`[machines] rows = "icon"`, ADR 0095), arc's
  // card draws no name on line 3, which only a screen reader hears; named
  // again, it draws it.
  const sidebarToml = join(window.dir, "config/sidebar.toml")
  const arcMark = third.locator('[data-machine-card="arc"]')
  await expect(arcMark.locator(".sr-only")).toHaveCount(0)
  writeFileSync(sidebarToml, `${INBOX}[machines]\nrows = "icon"\n`)
  await expect(arcMark.locator(".sr-only")).toHaveText("arc")
  await expect(arcMark.locator('[data-machine-icon="server"]')).toBeVisible()
  await shots(window, "icon", { arc: there }, "s6b")
  writeFileSync(sidebarToml, INBOX)
  await expect(arcMark.locator(".sr-only")).toHaveCount(0)

  // The counts' list draws each as the sidebar's card of three lines: its
  // mark, its title, its time, its Project, and arc's icon where it is
  // arc's.
  const counts = page.getByRole("banner").getByRole("button", { name: /done/ })
  const waiting = page.getByRole("group", { name: "Your turn" })
  const items = waiting.getByRole("menuitem")
  const item = (title: string) =>
    waiting.getByRole("menuitem", { name: new RegExp(`^${title},`) })
  for (const mode of ["dark", "light"] as const) {
    await look(window, mode, COUNTS)
    await counts.click()
    await expect(items).toHaveCount(3)
    await page.mouse.move(1400, 850)
    await page.screenshot({
      path: `test-results/sidebar-s6b-counts-${mode}.png`,
    })
    await page.keyboard.press("Escape")
    await expect(waiting).toBeHidden()
  }
  await counts.click()
  for (const one of await items.all()) {
    await expect(one.locator(":scope > span")).toHaveCount(3)
    await expect(one.locator("[data-sign]")).toHaveCount(1)
    await expect(one.locator("[data-time]")).toBeVisible()
  }
  await expect(
    item("Done on arc").locator('[data-machine-icon="server"]')
  ).toBeVisible()
  await expect(
    item("Sidebar for arc").locator("[data-machine-icon]")
  ).toHaveCount(0)
  // A row goes to its Thread, as the card does: arc's on arc's engine.
  await item("Done on arc").click()
  await expect(
    page.getByRole("region", { name: "Done on arc", exact: true })
  ).toHaveAttribute("data-focused", "true")

  // arc's card has the acts mac's has, and they go to arc's engine (spec
  // S7a): its Archive archives it on arc, and the toast's Undo brings it
  // back there.
  const archivedOnArc = () =>
    (
      JSON.parse(arc!.banda("call", "agents.threads", "--project", banda)).ok
        .threads as { title: string; archived?: unknown }[]
    ).find((one) => one.title === "Done on arc")?.archived
  await fits.hover()
  const archive = fits.locator("xpath=..").locator('[data-act="archive"]')
  await expect(archive).toBeVisible()
  await archive.click()
  await expect.poll(archivedOnArc).toBeDefined()
  await toastsOf(page).getByRole("button", { name: "Undo" }).click()
  await expect.poll(archivedOnArc).toBeUndefined()
})

/** When a usage limit lets an Agent go on, as a card says it: "15:00", or
 * "Thu 0:30" past midnight. */
const GOES_ON = String.raw`([A-Z][a-z]{2} )?\d{1,2}:\d\d`

// ADR 0099, step 3 (M3b): line 2 of a working card says what its Agent
// does, by the same hold as its Mark. These are drawn in Your turn,
// where the list holds each under the pointer as its Agent starts work
// again.
test("a Done card shows on line 2's right how many lines its last work added and removed, in grey; a Failed card nothing there (ADR 0098, decision 8; F1b)", async () => {
  test.setTimeout(180_000)
  window = await startWindow({ look: 'mode = "dark"\n' })
  const { page } = window
  await firstThread(page)
  await wide(window)
  const sidebar = sidebarOf(page)
  const panel = sidebar.getByRole("tabpanel")
  await leaveSidebar(page)
  // The fake Agent's edit takes notes.md from three lines to four, one of
  // them changed: two added, one removed.
  for (const text of ["edit the notes", "fail now"])
    call(window, "agents.send", { harness: "fake", text, settings: null })
  const done = cardOf(panel, "edit the notes")
  const failed = cardOf(panel, "fail now")
  await expect(done.getByRole("img", { name: "Done" })).toBeVisible()
  await expect(failed.getByRole("img", { name: "Failed" })).toBeVisible()
  const diff = done.locator("[data-diff]")
  await expect(diff).toHaveText("+2 −1")
  // In grey: the text's muted colour, never a call's.
  expect(await colourOf(diff)).not.toBe(await markColourOf(done))
  await expect(failed.locator("[data-diff]")).toHaveCount(0)
  await shots(window, "diff", { done, failed }, "f1b")
})

/** How a fake pull request stands on GitHub: its one check's end, or
 * merged. */
type Look = "SUCCESS" | "FAILURE" | "RUNNING" | "MERGED"

/**
 * A folder with a `gh` of the test's own, for the engine's PATH: it
 * answers the pulls App's query (ADR 0076, decision 2) for each pull
 * request of `o/r` it is asked, as `looks` says that number stands.
 */
function fakeGh(looks: Readonly<Record<number, Look>>): string {
  const bin = mkdtempSync(join(tmpdir(), "banda-gh-"))
  const script = String.raw`#!${process.execPath}
const looks = ${JSON.stringify(looks)}
const query = (process.argv.find((arg) => arg.startsWith("query=")) || "").slice(6)
const now = new Date().toISOString()
const node = (number, look) => ({
  number, url: "https://github.com/o/r/pull/" + number, title: "PR " + number,
  state: look === "MERGED" ? "MERGED" : "OPEN", isDraft: false,
  headRefName: "feat/" + number, baseRefName: "main", additions: 1, deletions: 0,
  updatedAt: now, mergedAt: look === "MERGED" ? now : null, closedAt: null,
  mergeable: "MERGEABLE", reviewDecision: null, autoMergeRequest: null,
  reviewRequests: { nodes: [] },
  commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: [{
    __typename: "CheckRun", name: "ci", startedAt: now,
    status: look === "RUNNING" ? "IN_PROGRESS" : "COMPLETED",
    conclusion: look === "RUNNING" ? null : look === "MERGED" ? "SUCCESS" : look,
    checkSuite: { workflowRun: { workflow: { name: "CI" } } },
  }] } } } }] },
})
const data = { viewer: { login: "roma" } }
let repo = {}
for (const [, r, p, n] of query.matchAll(/(r\d+): repository|(p\d+): pullRequest\(number: (\d+)\)/g)) {
  if (r) data[r] = repo = {}
  else repo[p] = node(Number(n), looks[n] || "SUCCESS")
}
process.stdout.write(JSON.stringify({ data }))
`
  writeFileSync(join(bin, "gh"), script)
  chmodSync(join(bin, "gh"), 0o755)
  return bin
}

// F2: line 2's right of a Thread that links a pull request (ADR 0098,
// decision 8; ADR 0076).
test("a Thread that links pull requests shows them on line 2's right, its glyph alone in a colour, several as how many; a Failed card nothing there; they make no row of their own (ADR 0098, decision 8; F2)", async () => {
  test.setTimeout(240_000)
  const bin = fakeGh({
    1061: "SUCCESS",
    1062: "RUNNING",
    1063: "FAILURE",
    1064: "MERGED",
    1065: "FAILURE",
    1066: "SUCCESS",
    1067: "MERGED",
    1068: "FAILURE",
  })
  window = await startWindow({
    look: 'mode = "dark"\n',
    env: { PATH: `${bin}:${process.env.PATH ?? ""}` },
  })
  const { page } = window
  await firstThread(page)
  await wide(window)
  const sidebar = sidebarOf(page)
  const panel = sidebar.getByRole("tabpanel")
  await leaveSidebar(page)
  // Each Thread, its title, and the pull requests it links.
  const threads = [
    ["chip one", "Ship the PR chip", [1061]],
    ["chip two", "Run the window tests", [1062]],
    ["chip three", "Mend the e2e on CI", [1063]],
    ["chip four", "Land the card lines", [1064]],
    ["chip five", "Split the sidebar work", [1065, 1066, 1067]],
    ["fail now", "Bump the engine", [1068]],
  ] as const
  for (const [text, title] of threads) {
    call(window, "agents.send", { harness: "fake", text, settings: null })
    await expect.poll(() => threadNamed(window, text)?.id).toBeTruthy()
    call(window, "agents.rename", { thread: idOf(window, text), title })
  }
  for (const [, title, pulls] of threads)
    for (const number of pulls)
      call(window, "pulls.link", {
        pull: `https://github.com/o/r/pull/${number}`,
        thread: idOf(window, title),
      })
  const [passed, running, failing, merged, several, failed] = threads.map(
    ([, title]) => cardOf(panel, title)
  )
  await expect(failed!.getByRole("img", { name: "Failed" })).toBeVisible()
  const chipOf = (card: Locator) => card.locator("[data-pull]")
  for (const [card, text, state] of [
    [passed, "#1061 ✓", "passed"],
    [running, "#1062 •", "running"],
    [failing, "#1063 ✗", "failed"],
    [merged, "#1064 merged", "merged"],
    // The first, failing, most needs the Person.
    [several, "3 PRs ✗", "failed"],
  ] as const) {
    await expect(chipOf(card!)).toHaveText(text)
    await expect(chipOf(card!)).toHaveAttribute("data-pull", state)
  }
  // Only the glyph takes a colour, its checks' own; the rest is grey.
  const glyph = (card: Locator) => chipOf(card).locator("span")
  expect(await colourOf(glyph(passed!))).toBe(await tokenOf(page, "--added"))
  expect(await colourOf(glyph(failing!))).toBe(
    await tokenOf(page, "--destructive")
  )
  expect(await colourOf(chipOf(passed!))).not.toBe(
    await colourOf(glyph(passed!))
  )
  // A screen reader hears it in words.
  await expect(passed!).toHaveAttribute(
    "aria-description",
    /Pull request 1061, checks passed/
  )
  await expect(several!).toHaveAttribute(
    "aria-description",
    /3 pull requests\. Pull request 1065, checks failed/
  )
  // Failed keeps nothing on the right; the items on the Threads are no
  // rows of their own.
  await expect(chipOf(failed!)).toHaveCount(0)
  await expect(panel.getByRole("option", { name: /^#10/ })).toHaveCount(0)
  await shots(
    window,
    "chips",
    { passed, running, failing, merged, several } as Record<string, Locator>,
    "f2"
  )
})

test("a working card says what its Agent does as its Mark shows it: the command it runs, no events for 3m once it says nothing, and at its usage limit when it goes on, on line 1's right too (ADR 0099, M3b)", async () => {
  test.setTimeout(180_000)
  window = await startWindow({ look: 'mode = "dark"\n' })
  const { page } = window
  await firstThread(page)
  // The page's clock is moved on by hand later, its timers made anew.
  await page.clock.install()
  await page.reload()
  const sidebar = sidebarOf(page)
  const panel = sidebar.getByRole("tabpanel")
  await expect(sidebar).toBeVisible()
  await leaveSidebar(page)
  for (const title of ["card one", "card two", "card three"])
    await send(window, title)
  const runs = cardOf(panel, "card one")
  const silent = cardOf(panel, "card two")
  const limited = cardOf(panel, "card three")
  for (const card of [runs, silent, limited])
    await expect(linesOf(card)).toHaveCount(3)

  // The pointer rests on the list; each Agent starts work again.
  await runs.hover()
  const again = (title: string, text: string) =>
    call(window, "agents.send", { thread: idOf(window, title), text })
  again("card one", "doing execute pnpm test")
  again("card two", "silent 200")
  again("card three", "limit wait")
  const said = (card: Locator) => linesOf(card).nth(1)
  await expect(said(runs)).toHaveText("pnpm test")
  await expect(markOf(runs)).toHaveAttribute("data-doing", "execute")
  // With nothing said yet, it works.
  await expect(said(silent)).toHaveText("Working")
  await expect(markOf(silent)).toHaveAttribute("data-doing", "other")
  await expect(said(limited)).toHaveText(
    new RegExp(`^Usage limit · goes on at ${GOES_ON}$`)
  )
  await expect(markOf(limited)).toHaveAttribute("data-doing", "limit")
  // Three minutes on, the one that says nothing is stuck, on its card and
  // its Mark alike.
  await page.clock.fastForward("03:10")
  await expect(said(silent)).toHaveText("No events for 3m")
  await expect(markOf(silent)).toHaveAttribute("data-doing", "stuck")

  // Away, each goes to Working, of three lines still. At its limit, line
  // 1's right says when it goes on; a screen reader hears what each does.
  const goesOn = (await said(limited).textContent())!.replace(
    "Usage limit · goes on at ",
    ""
  )
  await leaveSidebar(page)
  await sidebar.getByRole("tab", { name: /^Working/ }).click()
  await expect(linesOf(limited)).toHaveCount(3)
  await expect(limited.locator("[data-time]")).toHaveText(goesOn)
  await expect(limited).toHaveAccessibleName(
    new RegExp(`^card three, Working, goes on `)
  )
  await expect(limited).toHaveAttribute(
    "aria-description",
    new RegExp(`^Usage limit\\. goes on at ${goesOn}\\. Work\\. `)
  )
  await expect(silent).toHaveAttribute(
    "aria-description",
    /^No events for 3 minutes\. Work\. /
  )
})

/** What each Agent in the Working tab's shot does, as the fake Agent is
 * told it, under a title of the kind a Person gives. */
const AT_WORK = [
  ["Plan the Later picker", "doing think about it"],
  ["Audit the sidebar code", "doing read card.ts"],
  ["Find every standOf caller", "doing search standOf"],
  ["Fade long titles", "doing edit Row.tsx"],
  ["Fix the flaky inbox test", "doing execute pnpm test"],
  ["Read the ACP docs", "doing fetch docs.rs"],
  ["Explain the hold rules", "doing reply Here it is"],
  ["Overview open/close zoom", "doing compact"],
  ["Draft the release notes", "doing other Skill"],
  ["Remove the old shelves", "doing delete Shelf.tsx"],
  ["waybar: show Banda's counts", "limit wait"],
] as const

// The Working tab with ten Agents each at something else, one that says
// nothing and one at its usage limit, at 1440x900, dark and light, as
// test-results/sidebar-m3b-working-<mode>.png, and the sidebar alone as
// sidebar-m3b-working-list-<mode>.png.
test("the Working tab: ten Agents each at something else, one stuck and one at its usage limit, in dark and light (ADR 0099, M3b)", async () => {
  test.setTimeout(240_000)
  window = await startWindow({ look: 'mode = "dark"\n' })
  const { page } = window
  await firstThread(page)
  await wide(window)
  await page.clock.install()
  await page.reload()
  const sidebar = sidebarOf(page)
  await expect(sidebar).toBeVisible()
  const start = (text: string, title: string) => {
    call(window, "agents.send", { harness: "fake", text, settings: null })
    return expect
      .poll(() => threadNamed(window, text)?.id)
      .toBeTruthy()
      .then(() =>
        call(window, "agents.rename", { thread: idOf(window, text), title })
      )
  }
  // One says nothing; a minute on, the rest start, and the page's clock
  // moves two minutes ahead of the engine's: three minutes have passed
  // for the first alone, while the rest are a minute from it.
  await start("silent 600", "Keep awake while Agents work")
  await page.waitForTimeout(65_000)
  for (const [title, text] of AT_WORK) await start(text, title)
  await sidebar.getByRole("tab", { name: /^Working/ }).click()
  const panel = sidebar.getByRole("tabpanel")
  await expect(panel.locator("[data-row]")).toHaveCount(AT_WORK.length + 1)
  await page.clock.fastForward("02:00")
  const stuck = cardOf(panel, "Keep awake while Agents work")
  await expect(markOf(stuck)).toHaveAttribute("data-doing", "stuck")
  for (const [title] of AT_WORK)
    await expect(markOf(cardOf(panel, title))).not.toHaveAttribute(
      "data-doing",
      "stuck"
    )
  await expect(
    cardOf(panel, "waybar: show Banda's counts").locator("[data-time]")
  ).toHaveText(new RegExp(`^${GOES_ON}$`))
  await expect(page.locator("aside [data-news]")).toHaveCount(0)
  await shots(window, "working", { list: sidebar }, "m3b")
})
