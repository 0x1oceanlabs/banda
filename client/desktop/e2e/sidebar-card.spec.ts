/**
 * The sidebar's card (ADR 0098, S6a): three lines in Your turn, each a
 * left and a right; two there when the list is grouped by Project, whose
 * header names it; one line everywhere else. Colour only on a call's mark
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
 * after its title, or at the start of line 3's right on a card of three
 * (ADR 0102, decision 6), shot as `sidebar-s6a-away-*`.
 *
 * S6b: another machine's card, arc's, is an ordinary card, its icon on
 * line 3, alone where sidebar.toml asks; a long title fades out at its end and shows whole beside the
 * sidebar after a 500 ms rest; the counts' list draws one-line cards.
 * Shot as `sidebar-s6b-*.png`.
 */
import { writeFileSync } from "node:fs"
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
  scope.getByRole("button", { name: new RegExp(`^${title},`) })

/** A card's lines, top down. */
const linesOf = (card: Locator) => card.locator(":scope > span")

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
async function look(window: Window, mode: "dark" | "light") {
  const { page, dir } = window
  const html = page.locator("html")
  writeFileSync(
    join(dir, "config/look.toml"),
    `mode = "${mode}"\n${GLASS}[motion]\noff = true\n`
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
    })
    for (const [card, locator] of Object.entries(cards))
      await locator.screenshot({
        path: `test-results/sidebar-${step}-${name}-${card}-${mode}.png`,
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
    await card.focus()
    await card.locator("xpath=..").screenshot({
      path: `test-results/sidebar-s6a-${name}-focus-${mode}.png`,
    })
    await card.blur()
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

  // Open and at work: one line each, with no colour; the time is short.
  await expect(linesOf(open)).toHaveCount(1)
  await expect(linesOf(working)).toHaveCount(1)
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
    "open-1": open,
    "working-1": working,
  })

  // Later and the Archive: one line each.
  const tab = (name: string) =>
    sidebar.getByRole("tab", { name: new RegExp(`^${name}`) })
  await tab("Later").click()
  const later = cardOf(panel, "sleep one")
  await expect(linesOf(later)).toHaveCount(1)
  // On 24 hours, whatever the system's locale: "18:30" or "Wed 9:00".
  await expect(later.locator("[data-time]")).toHaveText(
    /^([A-Z][a-z]{2} )?\d{1,2}:\d\d$/
  )
  await shots(window, "later", { "later-1": later })
  await tab("Archive").click()
  const archived = cardOf(panel, "old one")
  await expect(linesOf(archived)).toHaveCount(1)
  await shots(window, "archive", { "archive-1": archived })
  await tab("Inbox").click()
  await leaveSidebar(page)

  // Grouped by Project, Your turn's cards have two lines: the header names
  // the Project.
  writeFileSync(
    join(window.dir, "config/sidebar.toml"),
    'preset = "projects"\n'
  )
  await expect(placeOf(sidebar, "Work").first()).toBeVisible()
  await expect(linesOf(asks)).toHaveCount(2)
  await expect(linesOf(failed)).toHaveCount(2)
  await expect(linesOf(woke)).toHaveCount(2)
  await expect(linesOf(open)).toHaveCount(1)
  await shots(window, "grouped", {
    "turn-2-asks": asks,
    "turn-2-failed": failed,
    "turn-2-done": done,
    "turn-2-woke": woke,
  })
})

test("a Thread away from its Project's workspace bears a small diamond right after its title and before its time, or at the start of line 3's right on a card of three, which the card's acts never cover: the Later clock, or Wake in Later (ADR 0102, decision 6; S6b)", async () => {
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

  /** `card`'s diamond: on one line, right after its title and before its
   * time; on three, at the start of line 3's right, after its Project and
   * before its Harness's emblem, never on line 1's right. A screen reader
   * hears it once, in the card's description. While the card's act
   * `name` shows, the time hides under it and the diamond stays in
   * sight. */
  const away = async (card: Locator, title: string, name: string) => {
    const three = (await linesOf(card).count()) === 3
    const diamond = linesOf(card)
      .nth(three ? 2 : 0)
      .locator(".lucide-diamond")
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
    const time = card.locator("[data-time]")
    if (three) {
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
    } else {
      const words = (await card
        .getByText(title, { exact: true })
        .first()
        .boundingBox())!
      expect(mark.x).toBeGreaterThanOrEqual(words.x + words.width)
      expect(mark.x).toBeLessThanOrEqual(words.x + words.width + 8)
      expect(mark.x + mark.width).toBeLessThanOrEqual(
        (await time.boundingBox())!.x
      )
    }
    await card.focus()
    const action = card
      .locator("xpath=..")
      .getByRole("button", { name, exact: true })
    await expect(action).toBeVisible()
    // The time fades out where the acts show (spec S7a).
    await expect(card.locator("[data-acts-time]")).toHaveCSS("opacity", "0")
    await expect(diamond).toBeVisible()
    const box = (await action.boundingBox())!
    if (!three) expect(box.x).toBeGreaterThanOrEqual(mark.x + mark.width)
    // §2.5's size, level with line 1 at every density.
    const line = (await linesOf(card).first().boundingBox())!
    expect(box.height).toBe(20)
    expect(box.y + box.height / 2).toBeCloseTo(line.y + line.height / 2, 0)
    await card.blur()
    await expect(card.locator("[data-acts-time]")).toHaveCSS("opacity", "1")
  }

  // Back in the row, Work has its own workspace: both stand away from it.
  await pickFlow(page, "Row")
  await leaveSidebar(page)
  await expect(linesOf(stray)).toHaveCount(1)
  await expect(linesOf(asks)).toHaveCount(3)
  await away(stray, "stray one", "Later")
  await away(asks, "please ask first", "Later")
  await shots(window, "away", { "open-1": stray, "turn-3-asks": asks })
  await focusShots(window, "away-turn-3-asks", asks)

  // Put off, its act is Wake: the diamond stays in sight beside it.
  call(window, "agents.later", {
    thread: idOf(window, "stray one"),
    after: "2h",
  })
  await expect.poll(() => threadNamed(window, "stray one")?.later).toBeTruthy()
  await sidebar.getByRole("tab", { name: /^Later/ }).click()
  await leaveSidebar(page)
  await expect(linesOf(stray)).toHaveCount(1)
  await away(stray, "stray one", "Wake")
  await focusShots(window, "away-later-1", stray)
})

/** The Inbox, with the counts always on the bar. */
const INBOX = 'preset = "inbox"\n[bar]\nshow = "always"\n'

/** A title too long for a card of the sidebar. */
const LONG = "Bench the window tests on arc against the new sidebar cards"

test("another machine's card is an ordinary card, its icon on line 3; a long title fades out at its end and shows whole beside the sidebar after a 500 ms rest, one that fits gets no fade and no tooltip; the counts' list draws one-line cards (ADR 0098, S6b; #1067)", async () => {
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

  // The counts' list draws each as a one-line card: its mark, its title,
  // arc's icon where it is arc's, and its time; no Project's sign.
  const counts = page.getByRole("banner").getByRole("button", { name: /done/ })
  const waiting = page.getByRole("group", { name: "Wait for you" })
  const items = waiting.getByRole("menuitem")
  const item = (title: string) =>
    waiting.getByRole("menuitem", { name: new RegExp(`^${title},`) })
  for (const mode of ["dark", "light"] as const) {
    await look(window, mode)
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
    await expect(one.locator(":scope > span")).toHaveCount(1)
    await expect(one.locator("[data-sign]")).toHaveCount(0)
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
  const archive = fits
    .locator("xpath=..")
    .getByRole("button", { name: "Archive", exact: true })
  await expect(archive).toBeVisible()
  await archive.click()
  await expect.poll(archivedOnArc).toBeDefined()
  await toastsOf(page).getByRole("button", { name: "Undo" }).click()
  await expect.poll(archivedOnArc).toBeUndefined()
})
