/**
 * The sidebar by its keys (ADR 0098, decision 13; spec S7b): one list,
 * one Tab stop, whose pick the arrows move while the focus stays on it;
 * S, Z, Enter and U act on the pick, and the pick goes on as a card
 * leaves; Esc goes out one layer a press; the keys are the sidebar's
 * alone, so a terminal and a field type them, and Alt+S, Alt+Z, Alt+U and
 * Alt+A work as they did. The focus never goes to the page. The pick's
 * ring after a key, and none after a click, dark and light, as
 * `sidebar-s7b-*.png`.
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
  leaveSidebar,
  openTerminal,
  pickerOf,
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

/** Where the focus is: the list, a Pane, a field or else in the sidebar,
 * somewhere else, or the page itself, which it never is. */
const focusOf = (page: Page) =>
  page.evaluate(() => {
    const at = document.activeElement
    if (!at || at === document.body) return "body"
    if (at.matches('[role="listbox"]')) return "list"
    if (at.closest("[data-tile]")) return "pane"
    if (at.closest('aside[aria-label="Sidebar"]'))
      return at.matches("input, textarea") ? "field" : "sidebar"
    return "elsewhere"
  })

/** Waits until the focus is at `where`. */
const focusIs = (page: Page, where: string) =>
  expect.poll(() => focusOf(page)).toBe(where)

/** The card of the Thread `title` in `scope`: its name starts with it. */
const cardOf = (scope: Locator, title: string) =>
  scope.getByRole("option", { name: new RegExp(`^${title},`) })

/** Waits until `list` has picked the card titled `title`, says so, and
 * names it as its active descendant, with the focus not on the page. */
async function picked(page: Page, list: Locator, title: string) {
  const card = cardOf(list, title)
  await expect(card).toHaveAttribute("aria-selected", "true")
  await expect(list.locator("[data-picked]")).toHaveCount(1)
  await expect(list).toHaveAttribute(
    "aria-activedescendant",
    (await card.getAttribute("id"))!
  )
  expect(await focusOf(page)).not.toBe("body")
}

/** Whether the engine has the Thread `title` seen. */
const seenOf = (window: Window, title: string) =>
  (
    call(window, "agents.threads") as {
      threads: { title: string; seen?: string }[]
    }
  ).threads.find((one) => one.title === title)?.seen

/** The sidebar's tab `name`. */
const tabOf = (sidebar: Locator, name: string) =>
  sidebar.getByRole("tab", { name: new RegExp(`^${name}`) })

test("triage by keys, ↓ S ↓ Z Enter U: Tab goes into the list, the pick goes on as a card leaves, Enter opens the card in its Pane, and the focus is never on the page (ADR 0098, S7b)", async () => {
  test.setTimeout(240_000)
  window = await startWindow()
  const { page } = window
  await firstThread(page)
  const titles = [
    "call one",
    "call two",
    "call three",
    "call four",
    "call five",
  ]
  for (const text of titles) await send(window, text)
  const sidebar = sidebarOf(page)
  const list = sidebar.getByRole("listbox")
  const tab = (name: string) => tabOf(sidebar, name)
  await expect(list.locator("[data-card]")).toHaveCount(5)
  // The acts under the pointer are no Tab stops, and no card is one.
  await expect(list.locator("[data-acts]").first()).toHaveAttribute(
    "aria-hidden",
    "true"
  )

  // From the tabs, Tab goes into the list, one stop: no Thread is open,
  // so the first card is picked, with the ring of a key.
  await tab("Inbox").focus()
  await page.keyboard.press("Tab")
  await expect(list).toBeFocused()
  await picked(page, list, "call one")
  await expect(list).toHaveAttribute("data-keyed", "")
  // And Shift+Tab goes back to the tab in view.
  await page.keyboard.press("Shift+Tab")
  await expect(tab("Inbox")).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(list).toBeFocused()
  await picked(page, list, "call one")

  // ↓ moves the pick; S archives it, and the pick goes on to the card
  // below, at once.
  await page.keyboard.press("ArrowDown")
  await picked(page, list, "call two")
  await page.keyboard.press("s")
  await expect(tab("Archive")).toHaveAccessibleName("Archive, 1")
  await expect(cardOf(list, "call two")).toHaveCount(0)
  await picked(page, list, "call three")
  await expect(list).toBeFocused()

  // ↓ and Z: the Later picker opens at the card picked; picked, the card
  // goes, the focus comes back to the list and the pick goes on.
  await page.keyboard.press("ArrowDown")
  await picked(page, list, "call four")
  await page.keyboard.press("z")
  const picker = pickerOf(page)
  await expect(picker).toContainText("call four")
  const when = picker.getByRole("textbox", { name: "When it comes back" })
  await expect(when).toBeFocused()
  await when.fill("2h")
  await when.press("Enter")
  await expect(tab("Later")).toHaveAccessibleName("Later, 1")
  await expect(cardOf(list, "call four")).toHaveCount(0)
  await expect(list).toBeFocused()
  await picked(page, list, "call five")

  // Enter opens it, and its Pane takes the focus.
  await page.keyboard.press("Enter")
  await focusIs(page, "pane")
  await expect(cardOf(list, "call five")).toHaveAttribute(
    "aria-current",
    "true"
  )
  await expect.poll(() => seenOf(window, "call five")).toBeDefined()

  // Back in the list, as Tab brings it, the pick is the open Thread's;
  // U marks it unread, and the focus stays.
  await list.focus()
  await picked(page, list, "call five")
  await page.keyboard.press("u")
  await expect.poll(() => seenOf(window, "call five")).toBeUndefined()
  await expect(list).toBeFocused()

  // The ends: Home and End go to the first and the last, and no further.
  await page.keyboard.press("Home")
  await picked(page, list, "call one")
  await page.keyboard.press("ArrowUp")
  await picked(page, list, "call one")
  await page.keyboard.press("End")
  await picked(page, list, "call five")
  await page.keyboard.press("ArrowDown")
  await picked(page, list, "call five")

  // Esc gives the focus back to the Pane in focus; coming back, the pick
  // is the open Thread's, wherever the keys left it.
  await page.keyboard.press("Home")
  await picked(page, list, "call one")
  await page.keyboard.press("Escape")
  await focusIs(page, "pane")
  await list.focus()
  await picked(page, list, "call five")
})

test("Esc goes out one layer a press: the picker, the title's field, the sidebar over the Strip, then back to the Pane in focus; a field types the sidebar's letters (ADR 0098, S7b)", async () => {
  test.setTimeout(240_000)
  window = await startWindow()
  const { app, page } = window
  await firstThread(page)
  for (const text of ["call one", "call two"]) await send(window, text)
  const sidebar = sidebarOf(page)
  const list = sidebar.getByRole("listbox")
  const tab = (name: string) => tabOf(sidebar, name)
  await cardOf(list, "call one").click()
  await focusIs(page, "pane")
  await list.focus()
  await picked(page, list, "call one")

  // 1, a popup: the Later picker goes, the card stays, and the focus is
  // the list's again.
  await page.keyboard.press("z")
  const picker = pickerOf(page)
  await expect(picker).toContainText("call one")
  await page.keyboard.press("Escape")
  await expect(picker).toBeHidden()
  await expect(list).toBeFocused()
  await picked(page, list, "call one")
  await expect(tab("Later")).toHaveAccessibleName("Later")

  // 2, the title's field, opened by F2 in the card: it types the
  // sidebar's letters and digits, and Esc leaves the old title.
  await page.keyboard.press("F2")
  const field = sidebar.getByRole("textbox", { name: "Title" })
  await expect(field).toBeFocused()
  await page.keyboard.type("szu 12/")
  await expect(field).toHaveValue("szu 12/")
  await expect(tab("Inbox")).toHaveAttribute("aria-selected", "true")
  await expect(tab("Archive")).toHaveAccessibleName("Archive")
  await page.keyboard.press("Escape")
  await expect(field).toBeHidden()
  await expect(cardOf(list, "call one")).toBeVisible()
  await expect(list).toBeFocused()
  await expect(sidebar).toBeVisible()

  // 3 and 4, check mode and the search, come with their steps (S10b,
  // S12a). 6, docked: back to the Pane in focus, the sidebar stays.
  await page.keyboard.press("Escape")
  await focusIs(page, "pane")
  await expect(sidebar).toBeVisible()

  // 5, over the Strip in a narrow window: Alt+A shows it and leaves the
  // focus where it was; Esc in it hides it, and the Pane has the focus.
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.setContentSize(700, 800)
  )
  await page.setViewportSize({ width: 700, height: 800 })
  await expect(sidebar).toBeHidden()
  await page.keyboard.press("Alt+A")
  await expect(sidebar).toBeVisible()
  await focusIs(page, "pane")
  await list.focus()
  await page.keyboard.press("Escape")
  await expect(sidebar).toBeHidden()
  await focusIs(page, "pane")
})

test("the sidebar's keys are its own: a terminal and the menu's search type them, and Alt+S, Alt+Z, Alt+U and Alt+A work from anywhere, the list too (ADR 0098, S7b)", async () => {
  test.setTimeout(240_000)
  window = await startWindow()
  const { page } = window
  await firstThread(page)
  for (const text of ["call one", "call two", "call three"]) {
    await send(window, text)
  }
  const sidebar = sidebarOf(page)
  const list = sidebar.getByRole("listbox")
  const tab = (name: string) => tabOf(sidebar, name)

  // In a terminal, s, z, u and the digits are typed: nothing is archived,
  // put off or shown.
  await openTerminal(page)
  await focusIs(page, "pane")
  await page.keyboard.type("echo s z u 1 2 3 4 /")
  await expect(tab("Inbox")).toHaveAttribute("aria-selected", "true")
  await expect(tab("Archive")).toHaveAccessibleName("Archive")
  await expect(tab("Later")).toHaveAccessibleName("Later")
  await expect(pickerOf(page)).toBeHidden()

  // Alt+A hides the sidebar and shows it again, the focus staying in the
  // terminal, where s still types.
  await page.keyboard.press("Alt+A")
  await expect(sidebar).toBeHidden()
  await page.keyboard.press("Alt+A")
  await expect(sidebar).toBeVisible()
  await focusIs(page, "pane")
  await page.keyboard.type("s")
  await expect(tab("Archive")).toHaveAccessibleName("Archive")

  // / in the list opens the search, the Banda menu's for now, whose field
  // types the letters.
  await list.focus()
  await page.keyboard.press("/")
  const menu = page.getByRole("dialog", { name: "Banda menu" })
  const search = menu.getByRole("combobox", { name: "Search" })
  await expect(search).toBeFocused()
  await page.keyboard.type("szu")
  await expect(search).toHaveValue("szu")
  await page.keyboard.press("Escape")
  await expect(menu).toBeHidden()
  expect(await focusOf(page)).not.toBe("body")
  await expect(tab("Archive")).toHaveAccessibleName("Archive")

  // From the list, Alt+Z and Alt+S act on the Thread in focus, as they do
  // from anywhere, not on the pick.
  await cardOf(list, "call one").click()
  await focusIs(page, "pane")
  await list.focus()
  await page.keyboard.press("ArrowDown")
  await picked(page, list, "call two")
  await page.keyboard.press("Alt+Z")
  const picker = pickerOf(page)
  await expect(picker).toContainText("call one")
  await page.keyboard.press("Escape")
  await expect(picker).toBeHidden()
  expect(await focusOf(page)).not.toBe("body")
  await list.focus()
  await page.keyboard.press("Alt+S")
  await expect(tab("Archive")).toHaveAccessibleName("Archive, 1")
  await expect(cardOf(list, "call one")).toHaveCount(0)
  await expect(cardOf(list, "call two")).toBeVisible()
  expect(await focusOf(page)).not.toBe("body")

  // Alt+U goes to what calls the Person: its Pane takes the focus, and the
  // pick follows it.
  await list.focus()
  await page.keyboard.press("Alt+U")
  await focusIs(page, "pane")
  await expect(list.locator("[aria-current=true]")).toHaveCount(1)
  const open = list.locator("[aria-current=true]")
  await expect(open).toHaveAttribute("aria-selected", "true")

  // Alt+A with the focus in the list hides it: the focus goes to the Pane
  // in focus, never to the page.
  await list.focus()
  await page.keyboard.press("Alt+A")
  await expect(sidebar).toBeHidden()
  await focusIs(page, "pane")
  await page.keyboard.press("Alt+A")
  await expect(sidebar).toBeVisible()
  await focusIs(page, "pane")
})

/** The window at 1440×900, its desk's glass made of a picture. */
async function wide(window: Window) {
  const { app, page, dir } = window
  wallpaper(dir)
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900)
  )
  await page.setViewportSize({ width: 1440, height: 900 })
}

/** The window in `mode`, on its glass, with no motion. */
async function look(window: Window, mode: "dark" | "light") {
  const { page, dir } = window
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

test("the pick's ring after a key, and none after a click, dark and light (ADR 0098, S7b)", async () => {
  test.setTimeout(240_000)
  window = await startWindow()
  const { page } = window
  await firstThread(page)
  await wide(window)
  for (const text of ["call one", "call two", "call three"]) {
    await send(window, text)
  }
  const waiting = Array.from({ length: 8 }, (_, at) => `wait ${at + 1}`)
  for (const text of waiting) await send(window, text)
  const sidebar = sidebarOf(page)
  const list = sidebar.getByRole("listbox")
  const tab = (name: string) => tabOf(sidebar, name)
  const ring = (card: Locator) =>
    card.evaluate((one) => getComputedStyle(one).outlineStyle)
  await expect(list.locator("[data-card]")).toHaveCount(9)
  await leaveSidebar(page)

  for (const mode of ["dark", "light"] as const) {
    await look(window, mode)
    // By key: Tab into the list, and ↓ to the second card.
    await tab("Inbox").focus()
    await page.keyboard.press("Tab")
    await page.keyboard.press("Home")
    await page.keyboard.press("ArrowDown")
    await picked(page, list, "call two")
    await expect(list).toHaveAttribute("data-keyed", "")
    expect(await ring(cardOf(list, "call two"))).toBe("solid")
    await sidebar.screenshot({
      path: `test-results/sidebar-s7b-key-${mode}.png`,
    })

    // By a click, on "+ 2 more": the rest shows, its first card is
    // picked, the list keeps the focus, and there is no ring.
    await list.getByRole("option", { name: "+ 2 more" }).click()
    await picked(page, list, "wait 7")
    await expect(list).toBeFocused()
    await expect(list).not.toHaveAttribute("data-keyed")
    expect(await ring(cardOf(list, "wait 7"))).toBe("none")
    await leaveSidebar(page)
    await sidebar.screenshot({
      path: `test-results/sidebar-s7b-click-${mode}.png`,
    })

    // A key brings the ring back, on the pick.
    await page.keyboard.press("ArrowDown")
    await picked(page, list, "wait 8")
    expect(await ring(cardOf(list, "wait 8"))).toBe("solid")

    // A tab switch cuts the shelf again.
    await tab("Working").click()
    await tab("Inbox").click()
  }
})
