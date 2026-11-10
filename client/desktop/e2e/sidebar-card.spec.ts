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
 * after its title (ADR 0102, decision 6), shot as `sidebar-s6a-away-*`.
 */
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { expect, type Locator, type Page, test } from "@playwright/test"
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
  wallpaper,
  type Window,
} from "./window"

let window: Window

test.afterEach(async () => {
  await window?.close()
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
 * behind it blank.
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
 * The window as it is now, dark and light, as `sidebar-s6a-<name>-<mode>`,
 * and each of `cards` alone beside it, as
 * `sidebar-s6a-<name>-<card>-<mode>`. The pointer is away from the list,
 * which holds still under it.
 */
async function shots(
  window: Window,
  name: string,
  cards: Readonly<Record<string, Locator>> = {}
) {
  const { page } = window
  await page.mouse.move(1400, 450)
  for (const mode of ["dark", "light"] as const) {
    await look(window, mode)
    await page.screenshot({
      path: `test-results/sidebar-s6a-${name}-${mode}.png`,
      animations: "disabled",
    })
    for (const [card, locator] of Object.entries(cards))
      await locator.screenshot({
        path: `test-results/sidebar-s6a-${name}-${card}-${mode}.png`,
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
    await card.focus()
    await card.locator("xpath=..").screenshot({
      path: `test-results/sidebar-s6a-${name}-focus-${mode}.png`,
      animations: "disabled",
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

test("a Thread away from its Project's workspace bears a small diamond right after its title and before its time, which the card's action never covers: the Later clock, or Wake in Later (ADR 0102, decision 6)", async () => {
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

  /** `card`'s diamond: on line 1, right after its title and before its
   * time; a screen reader hears it once, in the card's description. While
   * the card's action `name` shows, the time hides under it and the
   * diamond stays in sight. */
  const away = async (card: Locator, title: string, name: string) => {
    const diamond = linesOf(card).first().locator(".lucide-diamond")
    await expect(diamond).toBeVisible()
    await expect(diamond).toHaveAttribute("aria-hidden", "true")
    await expect(
      card.getByTitle("Away from its Project's workspace")
    ).toBeVisible()
    await expect(card).toHaveAttribute(
      "aria-description",
      /Away from its Project's workspace$/
    )
    const words = (await card
      .getByText(title, { exact: true })
      .first()
      .boundingBox())!
    const mark = (await diamond.boundingBox())!
    const time = card.locator("[data-time]")
    expect(mark.x).toBeGreaterThanOrEqual(words.x + words.width)
    expect(mark.x).toBeLessThanOrEqual(words.x + words.width + 8)
    expect(mark.x + mark.width).toBeLessThanOrEqual(
      (await time.boundingBox())!.x
    )
    await card.focus()
    const action = card
      .locator("xpath=..")
      .getByRole("button", { name, exact: true })
    await expect(action).toBeVisible()
    await expect(time).toBeHidden()
    await expect(diamond).toBeVisible()
    const box = (await action.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(mark.x + mark.width)
    // §2.5's size, level with line 1 at every density.
    const line = (await linesOf(card).first().boundingBox())!
    expect(box.height).toBe(20)
    expect(box.y + box.height / 2).toBeCloseTo(line.y + line.height / 2, 0)
    await card.blur()
    await expect(time).toBeVisible()
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

  // Put off, its action is Wake, wider than the clock: the card keeps its
  // room.
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
