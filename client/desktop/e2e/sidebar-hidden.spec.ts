/**
 * The sidebar hidden (ADR 0098, decision 22; spec S15): beside the bar's
 * logo, the count, "2 · 1", Your turn in its loudest call's colour, then
 * the working in grey, nothing when nothing calls, and nothing while the
 * sidebar shows; the logo's name says it, "Banda: Done, 2 your turn, 1 at
 * work", and "Quiet on". A click on the count opens the small inbox, a
 * dialog named Inbox: the sidebar's own list of Your turn, one-line cards
 * in its scope, so the same keys work, but no tabs, Search or 1–4; the
 * focus on its first card, Esc giving it back where it was, Enter opening
 * a card's Thread in its Pane. "1 at work ›" shows the sidebar on Working,
 * with the focus in its list. The count, whole and close up, and the
 * small inbox, dark and light, as `sidebar-s15-<name>-<mode>.png`.
 *
 * Threads start from outside the Window, as `banda call` starts them: one
 * whose first message says "wait" works until the test ends, any other is
 * answered at once and, unseen, calls its Person.
 */
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { expect, type Locator, type Page, test } from "@playwright/test"
import {
  call,
  firstThread,
  GLASS,
  send,
  sidebarOf,
  startWindow,
  wallpaper,
  type Window,
} from "./window"

let window: Window

test.afterEach(async () => {
  await window?.close()
})

/** The count beside the logo. */
const countOf = (page: Page) =>
  page.getByRole("banner").locator("[data-inbox-count]")

/** The bar's logo, named by what it shows. */
const logoOf = (page: Page) =>
  page.getByRole("banner").getByRole("button", { name: /^Banda(:|$)/ })

/** The small inbox. */
const inboxOf = (page: Page) => page.getByRole("dialog", { name: "Inbox" })

/** The card of the Thread `title` in `scope`: its name starts with it. */
const cardOf = (scope: Locator, title: string) =>
  scope.getByRole("option", { name: new RegExp(`^${title},`) })

/** Where the focus is: a list, a Pane, the element marked `data-was`,
 * somewhere else, or the page itself, which it never is. */
const focusOf = (page: Page) =>
  page.evaluate(() => {
    const at = document.activeElement
    if (!at || at === document.body) return "body"
    if (at.hasAttribute("data-was")) return "was"
    if (at.matches('[role="listbox"]'))
      return at.closest('[aria-label="Inbox"]') ? "inbox" : "sidebar"
    if (at.closest("[data-tile]")) return "pane"
    return "elsewhere"
  })

/** Waits until the focus is at `where`. */
const focusIs = (page: Page, where: string) =>
  expect.poll(() => focusOf(page)).toBe(where)

/** Waits until `list` has picked the card titled `title` and names it as
 * its active descendant. */
async function picked(list: Locator, title: string) {
  const card = cardOf(list, title)
  await expect(card).toHaveAttribute("data-picked", "")
  await expect(list.locator("[data-picked]")).toHaveCount(1)
  await expect(list).toHaveAttribute(
    "aria-activedescendant",
    (await card.getAttribute("id"))!
  )
}

/** Hides the sidebar, as Alt+A does. */
async function hide(page: Page) {
  await page.keyboard.press("Alt+KeyA")
  await expect(sidebarOf(page)).toBeHidden()
}

test("with the sidebar hidden, the count beside the logo says whose turn it is and who works, Your turn in its loudest call's colour; nothing when nothing calls, nor with the sidebar shown; the logo's name says it, Quiet too (ADR 0098, S15)", async () => {
  window = await startWindow()
  const { page } = window
  await firstThread(page)
  const count = countOf(page)
  const logo = logoOf(page)
  await send(window, "wait one")
  await hide(page)

  // Only work: nothing calls, so no count shows; the logo says who works.
  await expect(logo).toHaveAccessibleName("Banda: 1 at work")
  await expect(count).toHaveCount(0)

  // A call comes: the count shows, the turn in its call's colour, done's
  // green, the working in grey.
  await send(window, "call one")
  await send(window, "call two")
  await expect(count).toHaveText("2·1")
  await expect(count).toHaveAccessibleName("Inbox: 2 your turn, 1 at work")
  const [turn, dot, working] = await count.locator("span").all()
  await expect(turn!).toHaveClass("text-added")
  await expect(dot!).toHaveAttribute("aria-hidden", "true")
  await expect(working!).toHaveClass("text-muted-foreground")
  // It stands right of the logo.
  const [mark, counted] = [await logo.boundingBox(), await count.boundingBox()]
  expect(counted!.x).toBeGreaterThanOrEqual(mark!.x + mark!.width)
  await expect(logo).toHaveAccessibleName("Banda: Done, 2 your turn, 1 at work")
  // The badge on the logo's corner went: the count says it.
  await expect(logo.locator("span")).toHaveCount(0)

  // Quiet on, the logo says so too.
  await page.keyboard.press("Alt+KeyQ")
  await expect(logo).toHaveAccessibleName(
    "Banda: Done, 2 your turn, 1 at work, Quiet on"
  )
  await page.keyboard.press("Alt+KeyQ")
  await expect(logo).toHaveAccessibleName("Banda: Done, 2 your turn, 1 at work")

  // The sidebar shown says it all: no count beside the logo, whose name
  // still says it.
  await page.keyboard.press("Alt+KeyA")
  await expect(sidebarOf(page)).toBeVisible()
  await expect(count).toHaveCount(0)
  await expect(logo).toHaveAccessibleName("Banda: Done, 2 your turn, 1 at work")
  // The bar's middle is empty: the counts stand there only where listed.
  await expect(
    page.getByRole("banner").locator("[data-widget='sidebar.counts']")
  ).toHaveCount(0)
})

test("a click on the count opens the small inbox: Your turn alone in one-line cards in the sidebar's scope, the focus on the first; ↓, S and X work as in the sidebar, 1–4 do nothing; Esc clears what is checked, then gives the focus back where it was; Enter opens the card's Thread in its Pane (ADR 0098, S15)", async () => {
  test.setTimeout(240_000)
  window = await startWindow()
  const { page } = window
  const { composer } = await firstThread(page)
  for (const text of ["call one", "call two", "call three", "wait one"])
    await send(window, text)
  await hide(page)
  const count = countOf(page)
  const inbox = inboxOf(page)
  const list = inbox.getByRole("listbox")
  await expect(count).toHaveText("3·1")
  // Where the focus is as it opens, which Esc gives it back to.
  await composer.click()
  await composer.evaluate((field) => field.setAttribute("data-was", ""))
  await focusIs(page, "was")

  await count.click()
  await expect(inbox).toBeVisible()
  await expect(list).toBeFocused()
  // The sidebar's list, in its scope, with its keys; no tabs, no Search.
  await expect(inbox.locator('[data-scope="sidebar"]')).toHaveCount(1)
  await expect(inbox.getByRole("tab")).toHaveCount(0)
  await expect(inbox.getByRole("combobox")).toHaveCount(0)
  // Your turn alone, oldest first, one line each.
  const cards = list.getByRole("option")
  await expect(cards).toHaveText([/call one/, /call two/, /call three/])
  for (const card of await cards.all())
    expect((await card.boundingBox())!.height).toBeLessThan(36)
  await picked(list, "call one")

  // ↓ moves the pick; S archives the card and the pick goes on below; the
  // count follows.
  await page.keyboard.press("ArrowDown")
  await picked(list, "call two")
  await page.keyboard.press("s")
  await expect(cardOf(list, "call two")).toHaveCount(0)
  await picked(list, "call three")
  await expect(count).toHaveText("2·1")
  await focusIs(page, "inbox")
  // 1–4 switch no tab here: there are none.
  await page.keyboard.press("2")
  await expect(inbox).toBeVisible()
  await expect(cards).toHaveCount(2)
  // X checks the card picked; Esc clears it first, and the small inbox
  // stays.
  await page.keyboard.press("x")
  await expect(cardOf(list, "call three")).toHaveAttribute("data-checked", "")
  await page.keyboard.press("Escape")
  await expect(cardOf(list, "call three")).not.toHaveAttribute(
    "data-checked",
    ""
  )
  await expect(inbox).toBeVisible()
  // Esc again closes it, and the focus goes back where it was.
  await page.keyboard.press("Escape")
  await expect(inbox).toBeHidden()
  await focusIs(page, "was")

  // Again: the focus starts on the first card, and Enter opens its Thread
  // in its Pane, which takes the focus.
  await count.click()
  await expect(list).toBeFocused()
  await picked(list, "call one")
  await page.keyboard.press("Enter")
  const pane = page.getByRole("region", { name: "call one", exact: true })
  await expect(pane).toHaveAttribute("data-focused", "true")
  await expect(inbox).toBeHidden()
  await focusIs(page, "pane")
  // Seen, it is no longer the Person's turn.
  await expect(count).toHaveText("1·1")
})

test('"N at work ›" opens the sidebar on Working with the focus in its list, by a click or by Tab and Enter; the small inbox never shows with the sidebar (ADR 0098, S15)', async () => {
  test.setTimeout(240_000)
  window = await startWindow()
  const { page } = window
  await firstThread(page)
  for (const text of ["call one", "wait one", "wait two"])
    await send(window, text)
  await hide(page)
  const count = countOf(page)
  const inbox = inboxOf(page)
  const sidebar = sidebarOf(page)
  const working = sidebar.getByRole("tab", { name: /^Working/ })
  await expect(count).toHaveText("1·2")

  // A click on "2 at work ›".
  await count.click()
  await expect(inbox.getByRole("listbox")).toBeFocused()
  await inbox.getByRole("button", { name: "2 at work ›" }).click()
  await expect(sidebar).toBeVisible()
  await expect(working).toHaveAttribute("aria-selected", "true")
  await expect(sidebar.getByRole("listbox")).toBeFocused()
  await expect(sidebar.getByRole("option")).toHaveCount(2)
  await expect(inbox).toBeHidden()
  await expect(count).toHaveCount(0)

  // By keys: Tab goes from the list to it, Enter takes it.
  await sidebar.getByRole("tab", { name: /^Inbox/ }).click()
  await hide(page)
  await count.click()
  await expect(inbox.getByRole("listbox")).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(inbox.getByRole("button", { name: "2 at work ›" })).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(working).toHaveAttribute("aria-selected", "true")
  await focusIs(page, "sidebar")

  // Alt+A with the small inbox open: the sidebar shows, and it goes.
  await hide(page)
  await count.click()
  await expect(inbox).toBeVisible()
  await page.keyboard.press("Alt+KeyA")
  await expect(sidebar).toBeVisible()
  await expect(inbox).toBeHidden()
  expect(await focusOf(page)).not.toBe("body")
})

/** The window at 1440×900, its desk's glass made of a picture. */
async function wide({ app, page, dir }: Window) {
  wallpaper(dir)
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900)
  )
  await page.setViewportSize({ width: 1440, height: 900 })
}

/** The window in `mode`, on its glass, with no motion. */
async function look({ page, dir }: Window, mode: "dark" | "light") {
  const html = page.locator("html")
  writeFileSync(
    join(dir, "config/look.toml"),
    `mode = "${mode}"\n${GLASS}[motion]\noff = true\n`
  )
  if (mode === "dark") await expect(html).toHaveClass(/\bdark\b/)
  else await expect(html).not.toHaveClass(/\bdark\b/)
  await expect(html).toHaveAttribute("data-still", "")
  // The desk's picture paints a frame after the look comes.
  await page.waitForTimeout(250)
}

test("the count beside the logo, and the small inbox, dark and light (ADR 0098, S15)", async () => {
  test.setTimeout(300_000)
  window = await startWindow()
  const { page } = window
  await firstThread(page)
  await wide(window)
  for (const text of [
    "Bench the window tests",
    "Move sidebar settings",
    "Toast on wake",
    "wait: waybar shows the count",
    "wait: release notes",
    "wait: fix tile resize",
  ])
    await send(window, text)
  // One asks: the turn takes its colour, the loudest.
  const asks = "ask before the release"
  call(window, "agents.send", { harness: "fake", text: asks, settings: null })
  await expect(cardOf(sidebarOf(page), asks)).toContainText("Asks")
  await hide(page)
  const count = countOf(page)
  const inbox = inboxOf(page)
  await expect(count).toHaveText("4·3")
  await expect(count.locator("span").first()).toHaveClass("text-attention")
  // The shots are of the bar and the small inbox: the toasts of the
  // Threads done stand aside.
  await page.addStyleTag({
    content: "[data-sonner-toaster] { visibility: hidden }",
  })
  for (const mode of ["dark", "light"] as const) {
    await look(window, mode)
    await page.evaluate(() => (document.activeElement as HTMLElement).blur())
    await page.mouse.move(900, 600)
    await page.screenshot({
      path: `test-results/sidebar-s15-count-${mode}.png`,
      animations: "disabled",
    })
    await page.screenshot({
      path: `test-results/sidebar-s15-count-close-${mode}.png`,
      clip: { x: 0, y: 0, width: 240, height: 36 },
      animations: "disabled",
    })
    await count.click()
    await expect(inbox.getByRole("option")).toHaveCount(4)
    // ↓ once, so the pick's ring shows as the keys draw it.
    await page.keyboard.press("ArrowDown")
    await page.mouse.move(900, 600)
    await page.waitForTimeout(250)
    await page.screenshot({
      path: `test-results/sidebar-s15-inbox-${mode}.png`,
      animations: "disabled",
    })
    await page.keyboard.press("Escape")
    await expect(inbox).toBeHidden()
  }
})
