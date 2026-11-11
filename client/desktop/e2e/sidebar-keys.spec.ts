/**
 * The sidebar by its keys (ADR 0098, decision 13; spec S7b): one list,
 * one Tab stop, whose pick the arrows move while the focus stays on it;
 * S, Z, Enter and U act on the pick, and the pick goes on as a card
 * leaves; Esc goes out one layer a press; the keys are the sidebar's
 * alone, so a terminal and a field type them, and Alt+S, Alt+Z, Alt+U and
 * Alt+A work as they did. The focus never goes to the page. The pick's
 * ring after a key, and none after a click, dark and light, as
 * `sidebar-s7b-*.png`. Ctrl+Z takes back the last act and the pick goes
 * back to its card; S on a card that asks or works says why in a toast,
 * and the pick stays; the region `#sb-said` tells of a call and of inbox
 * zero (S7c), and the refusal and the Undo, dark and light, as
 * `sidebar-s7c-*.png`. Several at once (S10b): Shift+↓, X, Ctrl+A,
 * Ctrl+click and Shift+click check cards, S, Z and U act on them all as
 * one act, one Undo takes it back, and Esc, ✕ or a tab switch clears;
 * "Archive N done" on Your turn's head leaves what asks, failed or woke;
 * the bar, the head and the picker for three, dark and light, as
 * `sidebar-s10b-*.png`.
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
  threadNamed,
  toastsOf,
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

test("Esc goes out one layer a press: the picker, the title's field, the search, the sidebar over the Strip, then back to the Pane in focus; a field types the sidebar's letters (ADR 0098, S7b)", async () => {
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

  // 3, check mode, comes with its step (S10b). 4, the search: / opens
  // it, and Esc ends it, the Inbox and the list's focus back (S12a).
  await page.keyboard.press("/")
  const search = sidebar.getByRole("combobox", { name: "Search" })
  await expect(search).toBeFocused()
  await page.keyboard.type("two")
  await expect(tab("All")).toHaveAttribute("aria-selected", "true")
  await page.keyboard.press("Escape")
  await expect(search).toHaveValue("")
  await expect(tab("Inbox")).toHaveAttribute("aria-selected", "true")
  await expect(list).toBeFocused()

  // 6, docked: back to the Pane in focus, the sidebar stays.
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

test("the sidebar's keys are its own: a terminal and its Search type them, and Alt+S, Alt+Z, Alt+U and Alt+A work from anywhere, the list too (ADR 0098, S7b)", async () => {
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

  // / in the list goes to the sidebar's Search, whose field types the
  // letters and the digits (S12a).
  await list.focus()
  await page.keyboard.press("/")
  const search = sidebar.getByRole("combobox", { name: "Search" })
  await expect(search).toBeFocused()
  await page.keyboard.type("szu 12")
  await expect(search).toHaveValue("szu 12")
  await page.keyboard.press("Escape")
  await expect(search).toHaveValue("")
  await expect(list).toBeFocused()
  await expect(tab("Inbox")).toHaveAttribute("aria-selected", "true")
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

/** The toast that says `words`. */
const toastOf = (page: Page, words: string | RegExp) =>
  toastsOf(page).getByRole("listitem").filter({ hasText: words })

/** Starts the Thread `text` from outside the Window, which asks its
 * Person at once. */
async function asking(window: Window, text: string) {
  call(window, "agents.send", { harness: "fake", text, settings: null })
  await expect(cardOf(sidebarOf(window.page), text)).toContainText("Asks")
}

/** The words of an asking card's refusal, and of a working one's: its
 * title, then its next line. */
const ASKS = /^“please ask first” asks you\.\s*Answer it, or Z puts it off\.$/
const WORKS =
  /^“wait for the build” is at work\.\s*Z puts it off until it's done\.$/

test("Undo by its key, S S Ctrl+Z, brings back the second card and the pick with it; S on a card that asks or works toasts why and the pick stays; the region says a call and inbox zero (ADR 0098, S7c)", async () => {
  test.setTimeout(240_000)
  window = await startWindow()
  const { page } = window
  await firstThread(page)
  await asking(window, "please ask first")
  await send(window, "wait for the build")
  for (const text of ["call one", "call two", "call three"]) {
    await send(window, text)
  }
  const sidebar = sidebarOf(page)
  const list = sidebar.getByRole("listbox")
  const tab = (name: string) => tabOf(sidebar, name)
  // The region is there from the start, empty: the calls came while the
  // focus was in the New Thread's box, and 2 s on nothing was said.
  const said = page.locator("#sb-said")
  await expect(said).toHaveAttribute("role", "status")
  await expect(said).toHaveAttribute("aria-live", "polite")
  expect(await focusOf(page)).toBe("pane")
  await page.waitForTimeout(2500)
  await expect(said).toHaveText("")

  // Into the list, described by the hint of its keys.
  await tab("Inbox").focus()
  await page.keyboard.press("Tab")
  await expect(list).toBeFocused()
  await expect(list).toHaveAccessibleDescription(
    "S archives, Z puts off, U marks unread, X selects. Shift+F10 for more."
  )
  await picked(page, list, "please ask first")

  // S on the card that asks: its toast says why, the pick stays, nothing
  // is archived.
  await page.keyboard.press("s")
  await expect(toastOf(page, ASKS)).toBeVisible()
  await picked(page, list, "please ask first")
  await expect(tab("Archive")).toHaveAccessibleName("Archive")
  // And on the one at work, last in the list.
  await page.keyboard.press("End")
  await picked(page, list, "wait for the build")
  await page.keyboard.press("s")
  await expect(toastOf(page, WORKS)).toBeVisible()
  await picked(page, list, "wait for the build")
  await expect(tab("Archive")).toHaveAccessibleName("Archive")

  // S S: two archived, the pick on the third.
  await page.keyboard.press("Home")
  await page.keyboard.press("ArrowDown")
  await picked(page, list, "call one")
  await page.keyboard.press("s")
  await picked(page, list, "call two")
  await page.keyboard.press("s")
  await picked(page, list, "call three")
  await expect(tab("Archive")).toHaveAccessibleName("Archive, 2")
  await expect(toastOf(page, "Archived 2")).toBeVisible()

  // Ctrl+Z brings back the second, the pick goes back to it, and the
  // toast tells of the first alone; again, the first.
  await page.keyboard.press("Control+z")
  await expect(tab("Archive")).toHaveAccessibleName("Archive, 1")
  await expect(cardOf(list, "call two")).toBeVisible()
  await picked(page, list, "call two")
  await expect(toastOf(page, /^Archived(?! 2)/)).toBeVisible()
  await page.keyboard.press("Control+z")
  await expect(tab("Archive")).toHaveAccessibleName("Archive")
  await expect(cardOf(list, "call one")).toBeVisible()
  await picked(page, list, "call one")
  expect(await focusOf(page)).toBe("list")

  // A call that comes while the focus is in the list is said.
  await send(window, "call four")
  await expect(said).toHaveText("call four is done.")

  // The last card goes: the one that asks is put off, the rest archived,
  // and the region says inbox zero in its own words.
  await page.keyboard.press("Home")
  await picked(page, list, "please ask first")
  await page.keyboard.press("z")
  const when = pickerOf(page).getByRole("textbox", {
    name: "When it comes back",
  })
  await when.fill("2h")
  await when.press("Enter")
  await expect(list).toBeFocused()
  for (const title of ["call one", "call two", "call three", "call four"]) {
    await picked(page, list, title)
    await page.keyboard.press("s")
  }
  await expect(sidebar.getByText("Nothing waits for you")).toBeVisible()
  // In 2h past 22:00 is tomorrow, which names its day: "Thu 1:25".
  await expect(said).toHaveText(
    /^Inbox zero\. Nothing waits for you\. 1 at work\. Next wakes at (\w+ )?\d+:\d\d\.$/
  )
  expect(await focusOf(page)).toBe("list")

  // The hint was read once: the list is described by it no more.
  await page.keyboard.press("Escape")
  await focusIs(page, "pane")
  await list.focus()
  await expect(list).toHaveAccessibleDescription("")
})

test("a refusal's toast, and the Undo after Ctrl+Z, dark and light (ADR 0098, S7c)", async () => {
  test.setTimeout(240_000)
  window = await startWindow()
  const { page } = window
  await firstThread(page)
  await wide(window)
  await asking(window, "please ask first")
  for (const text of ["call one", "call two", "call three"]) {
    await send(window, text)
  }
  const sidebar = sidebarOf(page)
  const list = sidebar.getByRole("listbox")
  const tab = (name: string) => tabOf(sidebar, name)
  await leaveSidebar(page)

  for (const mode of ["dark", "light"] as const) {
    await look(window, mode)
    await tab("Inbox").focus()
    await page.keyboard.press("Tab")
    await page.keyboard.press("Home")
    await picked(page, list, "please ask first")
    await page.keyboard.press("s")
    const refusal = toastOf(page, ASKS)
    await expect(refusal).toBeVisible()
    await page.screenshot({
      path: `test-results/sidebar-s7c-refusal-${mode}.png`,
    })
    await expect(refusal).toBeHidden({ timeout: 15_000 })

    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("s")
    await page.keyboard.press("s")
    await expect(tab("Archive")).toHaveAccessibleName("Archive, 2")
    await page.keyboard.press("Control+z")
    await picked(page, list, "call two")
    await expect(tab("Archive")).toHaveAccessibleName("Archive, 1")
    await expect(toastOf(page, /^Archived(?! 2)/)).toBeVisible()
    await page.screenshot({ path: `test-results/sidebar-s7c-undo-${mode}.png` })

    // Back as it was, for the other look.
    // The toast that asks for the Thread that asks stays: Notifications'.
    await page.keyboard.press("Control+z")
    await expect(tab("Archive")).toHaveAccessibleName("Archive")
    await expect(toastOf(page, /^Archived/)).toHaveCount(0)
  }
})

/** The selection's bar. */
const barOf = (sidebar: Locator) =>
  sidebar.getByRole("toolbar", { name: /selected$/ })

/** The titles of the cards checked in `list`, top down. */
const checkedIn = (list: Locator) =>
  list
    .locator("[data-card][data-checked]")
    .evaluateAll((cards) =>
      cards.map((card) => card.getAttribute("aria-label")!.split(",")[0])
    )

test("Shift+↓ ↓ checks three, S archives them all, one Ctrl+Z brings them back; X, Ctrl+A, Ctrl+click and Shift+click check, and Esc, ✕ and a tab switch clear (ADR 0098, S10b)", async () => {
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
  const bar = barOf(sidebar)
  const said = page.locator("#sb-said")
  await expect(list.locator("[data-card]")).toHaveCount(5)
  await expect(bar).toBeHidden()
  await leaveSidebar(page)

  // Shift+↓ ↓: three checked, a check in each mark's place, the pick on
  // the third, and the bar over the foot; the rest are not selected.
  await tab("Inbox").focus()
  await page.keyboard.press("Tab")
  await picked(page, list, "call one")
  await expect(list).toHaveAttribute("aria-multiselectable", "true")
  await page.keyboard.press("Shift+ArrowDown")
  await page.keyboard.press("Shift+ArrowDown")
  await expect
    .poll(() => checkedIn(list))
    .toEqual(["call one", "call two", "call three"])
  await expect(bar).toBeVisible()
  await expect(bar).toHaveAccessibleName("3 selected")
  await expect(cardOf(list, "call three")).toHaveAttribute("data-picked", "")
  await expect(cardOf(list, "call four")).toHaveAttribute(
    "aria-selected",
    "false"
  )
  await expect(cardOf(list, "call one").locator("[data-check]")).toBeVisible()
  await expect(said).toHaveText("3 selected")

  // S archives all three, as one act: the pick goes on to the fourth,
  // the bar goes, and the list keeps the focus.
  await page.keyboard.press("s")
  await expect(tab("Archive")).toHaveAccessibleName("Archive, 3")
  for (const title of titles.slice(0, 3))
    await expect(cardOf(list, title)).toHaveCount(0)
  await expect(toastOf(page, "Archived 3")).toBeVisible()
  await expect(bar).toBeHidden()
  await picked(page, list, "call four")
  expect(await focusOf(page)).toBe("list")

  // One Ctrl+Z brings all three back, and the pick with the first.
  await page.keyboard.press("Control+z")
  await expect(tab("Archive")).toHaveAccessibleName("Archive")
  for (const title of titles.slice(0, 3))
    await expect(cardOf(list, title)).toBeVisible()
  await picked(page, list, "call one")
  expect(await focusOf(page)).toBe("list")

  // X checks the pick and Space leaves it out; Ctrl+A checks every card;
  // Esc clears, said, and the focus stays on the list.
  await page.keyboard.press("x")
  await expect.poll(() => checkedIn(list)).toEqual(["call one"])
  await page.keyboard.press("Space")
  await expect(bar).toBeHidden()
  await page.keyboard.press("Control+a")
  await expect.poll(() => checkedIn(list)).toEqual(titles)
  await expect(bar).toHaveAccessibleName("5 selected")
  await page.keyboard.press("Escape")
  await expect(bar).toBeHidden()
  await focusIs(page, "list")
  await expect(said).toHaveText("Selection cleared")

  // Ctrl+click checks a card and opens nothing; Shift+click checks the
  // range from it. Tab goes into the bar, End to ✕, which clears, and the
  // focus goes back to the list.
  await cardOf(list, "call two").click({ modifiers: ["ControlOrMeta"] })
  await cardOf(list, "call four").click({ modifiers: ["Shift"] })
  await expect
    .poll(() => checkedIn(list))
    .toEqual(["call two", "call three", "call four"])
  await focusIs(page, "list")
  await picked(page, list, "call four")
  await page.keyboard.press("Tab")
  await expect(bar.getByRole("button", { name: "Archive" })).toBeFocused()
  await page.keyboard.press("End")
  const clear = bar.getByRole("button", { name: "Clear the selection" })
  await expect(clear).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(bar).toBeHidden()
  await focusIs(page, "list")

  // A tab switch clears it too.
  await page.keyboard.press("x")
  await expect(bar).toBeVisible()
  await page.keyboard.press("4")
  await page.keyboard.press("1")
  await expect(bar).toBeHidden()
  await expect.poll(() => checkedIn(list)).toEqual([])
})

test("Archive 3 done, on Your turn's head under the pointer, archives the cards that are done and leaves what asks, failed and woke; its toast's Undo brings them back (ADR 0098, S10b)", async () => {
  test.setTimeout(240_000)
  window = await startWindow()
  const { page } = window
  await firstThread(page)
  const sidebar = sidebarOf(page)
  const list = sidebar.getByRole("listbox")
  const tab = (name: string) => tabOf(sidebar, name)
  await leaveSidebar(page)
  // Woke: put off for two seconds, its time wakes it into Your turn.
  await send(window, "nap one")
  call(window, "agents.later", {
    thread: threadNamed(window, "nap one")!.id,
    until: Date.now() + 2000,
  })
  await expect(
    cardOf(list, "nap one").getByRole("img", { name: "Woke" })
  ).toBeVisible()
  call(window, "agents.send", {
    harness: "fake",
    text: "fail now",
    settings: null,
  })
  await expect
    .poll(() => threadNamed(window, "fail now")?.latest?.state)
    .toBe("failed")
  await asking(window, "please ask first")
  const done = ["call one", "call two", "call three"]
  for (const text of done) await send(window, text)
  await expect(list.locator("[data-card]")).toHaveCount(6)

  // Hidden till the pointer is on the head; there it counts the done.
  const head = list.locator('[data-block="turn:head"]')
  const button = head.locator("[data-done-all]")
  await expect(button).toBeHidden()
  await head.hover()
  await expect(button).toBeVisible()
  await expect(button).toHaveText("Archive 3 done")
  await button.click()
  await expect(tab("Archive")).toHaveAccessibleName("Archive, 3")
  await expect(toastOf(page, "Archived 3")).toBeVisible()
  // What asks, failed and woke stays in Your turn.
  await leaveSidebar(page)
  for (const title of done) await expect(cardOf(list, title)).toHaveCount(0)
  for (const title of ["nap one", "fail now", "please ask first"])
    await expect(cardOf(list, title)).toBeVisible()
  // None done is left: the head offers nothing.
  await head.hover()
  await expect(button).toHaveCount(0)

  // The toast's Undo brings all three back.
  await toastOf(page, "Archived 3")
    .getByRole("button", { name: "Undo" })
    .click()
  await expect(tab("Archive")).toHaveAccessibleName("Archive")
  await leaveSidebar(page)
  for (const title of done) await expect(cardOf(list, title)).toBeVisible()
})

test("check mode with its bar, Archive 3 done under the pointer, and the Later picker for 3 Threads, dark and light (ADR 0098, S10b)", async () => {
  test.setTimeout(300_000)
  window = await startWindow()
  const { page } = window
  await firstThread(page)
  await wide(window)
  await asking(window, "please ask first")
  for (const text of [
    "Bench the window tests",
    "Review the sidebar spec",
    "Fix blank window on reload",
  ])
    await send(window, text)
  await send(window, "wait for the build")
  const sidebar = sidebarOf(page)
  const list = sidebar.getByRole("listbox")
  const tab = (name: string) => tabOf(sidebar, name)
  const bar = barOf(sidebar)
  await expect(list.locator("[data-card]")).toHaveCount(5)
  await leaveSidebar(page)
  // The calls' toast of the three done goes first, out of the shots.
  await expect(toastOf(page, /done/)).toHaveCount(0, { timeout: 15_000 })

  for (const mode of ["dark", "light"] as const) {
    await look(window, mode)
    // Archive 3 done, under the pointer on Your turn's head.
    const head = list.locator('[data-block="turn:head"]')
    await head.hover()
    await expect(head.locator("[data-done-all]")).toBeVisible()
    await sidebar.screenshot({
      path: `test-results/sidebar-s10b-done-${mode}.png`,
    })

    // Check mode: the three done, by Shift+↓ from the first of them.
    await tab("Inbox").focus()
    await page.keyboard.press("Tab")
    await page.keyboard.press("Home")
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("Shift+ArrowDown")
    await page.keyboard.press("Shift+ArrowDown")
    await expect(bar).toHaveAccessibleName("3 selected")
    await leaveSidebar(page)
    await sidebar.screenshot({
      path: `test-results/sidebar-s10b-checks-${mode}.png`,
    })

    // Z: one picker for all three.
    await page.keyboard.press("z")
    const picker = pickerOf(page)
    await expect(picker).toContainText("Later · 3 Threads")
    await page.waitForTimeout(250)
    await page.screenshot({
      path: `test-results/sidebar-s10b-later-${mode}.png`,
      animations: "disabled",
    })
    // Esc closes the picker, then clears the selection.
    await page.keyboard.press("Escape")
    await expect(picker).toBeHidden()
    await expect(bar).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(bar).toBeHidden()
    await focusIs(page, "list")
    // The next Esc gives the focus back to the Pane: the next look starts
    // as this one did, with no ring.
    await page.keyboard.press("Escape")
    await expect.poll(() => focusOf(page)).not.toBe("list")
  }
})
