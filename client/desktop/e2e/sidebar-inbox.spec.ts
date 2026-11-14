/**
 * The sidebar as the Person's inbox (ADR 0098, S5b): its tabs, Your turn
 * oldest first, Open newest first under a hairline, the Working shelf in
 * grey with "+ N more", Later by day, the Archive, inbox zero in words and
 * each tab empty. Each state is screenshot in the dark and the light, on
 * glass and on a solid desk, at 1440×900, as `sidebar-s5b-*.png`. And the
 * list's order kept under the pointer (ADR 0098, decision 6, as amended
 * 2026-11-14): what comes waits for the pointer to leave, and what left
 * goes at once.
 * And a card's acts under the pointer (ADR 0098, S7a): Archive at once,
 * with the toast that takes it back, Later's picker at the card, an
 * asking card's Later alone; each place's card at rest and under the
 * pointer, and the toast, as `sidebar-s7a-*.png`. And a card's menu (ADR 0098,
 * S10a): a right click opens it at the pointer, Shift+F10 and the Menu
 * key at the card picked; Delete… is the Archive's alone and asks first,
 * Cancel in focus; the menu on a done, a working and an archived card and
 * the question, dark and light, as `sidebar-s10a-*.png`.
 * And a Thread an Agent started (ADR 0098, S14b): under its parent with ↳
 * at work, past three "↳ + N more at work", and in Your turn by itself
 * when it asks, screenshot dark and light as `sidebar-s14b-*.png`.
 *
 * Threads start from outside the Window, as `banda call` starts them: one
 * whose first message says "wait" works until the test ends, any other is
 * answered at once and, unseen, calls its Person.
 */
import { copyFileSync, existsSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, type Locator, type Page, test } from "@playwright/test"
import {
  agentCalls,
  call,
  firstThread,
  GLASS,
  pickerOf,
  placeOf,
  leaveSidebar,
  send,
  sidebarOf,
  startWindow,
  threadNamed,
  toastsOf,
  topsOf,
  wallpaper,
  type Window,
} from "./window"

let window: Window

test.afterEach(async () => {
  await window?.close()
})

/** The id of Work's Thread named `title`, as the engine lists it; none
 * until it is listed. */
const idOf = (window: Window, title: string) => threadNamed(window, title)?.id

/** Waits until the Person's Threads are Your turn's head and `titles`, in
 * that order, with nothing between, as the window draws them. The engine
 * says a Thread is done before the window's list has it there: the list
 * may draw it Open first, before its turn begins, then Working. */
async function landed(sidebar: Locator, titles: string[]) {
  await expect(placeOf(sidebar, "Threads")).toHaveText([
    /^Your turn/,
    ...titles.map((title) => new RegExp(title)),
  ])
}

/** The colour `element`'s text is drawn in. */
const colourOf = (element: Locator) =>
  element.evaluate((one) => getComputedStyle(one).color)

/** Whether the Archive's tab stands whole inside the sidebar, the border
 * left out, with the sidebar `rem` wide. */
async function archiveFits(page: Page, rem: number) {
  await page.evaluate(
    (width) =>
      document.documentElement.style.setProperty("--sidebar-width", width),
    `${rem}rem`
  )
  return page.evaluate(() => {
    const aside = document.querySelector<HTMLElement>(
      'aside[aria-label="Sidebar"]'
    )!
    const tab = document.getElementById("sb-tab-archive")!
    const inside =
      aside.getBoundingClientRect().left + aside.clientLeft + aside.clientWidth
    return tab.getBoundingClientRect().right <= inside
  })
}

/** The tabs whose words are cut short, with the sidebar `rem` wide. */
async function cutTabs(page: Page, rem: number) {
  await page.evaluate(
    (width) =>
      document.documentElement.style.setProperty("--sidebar-width", width),
    `${rem}rem`
  )
  return page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        'aside[aria-label="Sidebar"] [role="tab"] .truncate'
      ),
    ]
      .filter((words) => words.scrollWidth > words.clientWidth)
      .map((words) => words.textContent)
  )
}

/** Each look a screenshot is taken in: dark and light, on glass and on a
 * solid desk. */
const LOOKS = [
  ["dark", true],
  ["dark", false],
  ["light", true],
  ["light", false],
] as const

/** The window at 1440×900, its desk's glass made of a picture. */
async function wide(window: Window) {
  const { app, page, dir } = window
  wallpaper(dir)
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900)
  )
  await page.setViewportSize({ width: 1440, height: 900 })
}

/** The window as it is now, in each look, as `sidebar-s5b-<name>-…`. The
 * pointer is away from the list, which keeps its order under it. */
async function shots(window: Window, name: string) {
  const { page, dir } = window
  const html = page.locator("html")
  await page.mouse.move(1400, 450)
  for (const [mode, glass] of LOOKS) {
    writeFileSync(
      join(dir, "config/look.toml"),
      `mode = "${mode}"\n${GLASS}${glass ? "" : "glass = false\n"}[motion]\noff = true\n`
    )
    if (mode === "dark") await expect(html).toHaveClass(/\bdark\b/)
    else await expect(html).not.toHaveClass(/\bdark\b/)
    if (glass) await expect(html).toHaveAttribute("data-glass", "")
    else await expect(html).not.toHaveAttribute("data-glass")
    // The desk's picture paints a frame after the look comes.
    await page.waitForTimeout(250)
    await page.screenshot({
      path: `test-results/sidebar-s5b-${name}-${mode}-${glass ? "glass" : "solid"}.png`,
      animations: "disabled",
    })
  }
}

test("the Inbox: Your turn oldest first, Open newest first under a hairline, the Working shelf's first six with + N more; 1–4, the arrows and a click show the tabs (ADR 0098, S5b)", async () => {
  test.setTimeout(300_000)
  window = await startWindow()
  const { page } = window
  await firstThread(page)
  await wide(window)
  const calls = ["call one", "call two", "call three"]
  const read = ["read one", "read two", "read three", "read four"]
  const working = [
    "wait one",
    "wait two",
    "wait three",
    "wait four",
    "wait five",
    "wait six",
    "wait seven",
    "wait eight",
    "wait nine",
  ]
  for (const text of calls) await send(window, text)
  for (const text of read) {
    await send(window, text)
    call(window, "agents.read", { thread: idOf(window, text) })
  }
  for (const text of working) await send(window, text)

  const sidebar = page.getByRole("complementary", { name: "Sidebar" })
  const tab = (name: string) =>
    sidebar.getByRole("tab", { name: new RegExp(`^${name}`) })
  const panel = sidebar.getByRole("tabpanel")
  const rows = panel.locator("[data-row]")
  // The tabs count what each holds; the Inbox is in view.
  await expect(tab("Inbox")).toHaveAccessibleName("Inbox, 7")
  await expect(tab("Inbox")).toHaveAttribute("aria-selected", "true")
  await expect(tab("Working")).toHaveAccessibleName("Working, 9")
  await expect(tab("Later")).toHaveAccessibleName("Later")
  await expect(tab("Archive")).toHaveAccessibleName("Archive")

  // Your turn, the oldest first, under its head; Open, the newest first,
  // under a hairline.
  const threads = placeOf(sidebar, "Threads")
  await expect(threads.first()).toContainText(/Your turn\s*· 3/)
  await expect(threads.getByRole("separator")).toHaveCount(1)
  await expect(threads.locator("[data-row]")).toHaveText([
    /call one/,
    /call two/,
    /call three/,
    /read four/,
    /read three/,
    /read two/,
    /read one/,
  ])
  // The Working shelf: its first six, the oldest first, and how many more,
  // in grey, where Open is in the text's colour.
  const shelf = placeOf(sidebar, "Working")
  await expect(shelf.first()).toContainText(/Working\s*· 9/)
  await expect(shelf.locator("[data-row]")).toHaveText(
    working.slice(0, 6).map((text) => new RegExp(text))
  )
  expect(
    await colourOf(shelf.getByText("wait one", { exact: true }).first())
  ).not.toBe(
    await colourOf(threads.getByText("read four", { exact: true }).first())
  )
  const more = shelf.getByRole("option", { name: "+ 3 more" })
  await expect(more).toBeVisible()
  await shots(window, "inbox")
  // It shows the rest in place, and the pick goes on to the first of them
  // as it goes; the focus stays where it was, never on the page (S7b).
  await more.click()
  await expect(shelf.locator("[data-row]")).toHaveCount(9)
  await expect(more).toBeHidden()
  await expect(shelf.locator("[data-picked]")).toHaveText(/wait seven/)
  await expect(page.locator("body")).not.toBeFocused()

  // 1–4 show the tabs, from anywhere in the sidebar, the list too, which
  // keeps the focus as it goes with the tab shown, never to the page. The
  // arrows go along the tabs. Each draws at once.
  const list = panel.getByRole("listbox")
  await list.focus()
  await page.keyboard.press("2")
  await expect(tab("Working")).toHaveAttribute("aria-selected", "true")
  await expect(list).toBeFocused()
  await expect(page.locator("body")).not.toBeFocused()
  await expect(panel).toHaveAccessibleName("Working, 9")
  await expect(rows).toHaveCount(9)
  await page.keyboard.press("3")
  await expect(tab("Later")).toHaveAttribute("aria-selected", "true")
  await expect(panel).toContainText("Nothing for later")
  await page.keyboard.press("4")
  await expect(tab("Archive")).toHaveAttribute("aria-selected", "true")
  await expect(panel).toContainText("Nothing archived yet")
  await page.keyboard.press("1")
  await expect(tab("Inbox")).toHaveAttribute("aria-selected", "true")
  // The shelf shows its first six again, as a tab switch cuts it.
  await expect(shelf.locator("[data-row]")).toHaveCount(6)
  await tab("Inbox").focus()
  await page.keyboard.press("ArrowRight")
  await expect(tab("Working")).toBeFocused()
  await expect(tab("Working")).toHaveAttribute("aria-selected", "true")
  await page.keyboard.press("End")
  await expect(tab("Archive")).toHaveAttribute("aria-selected", "true")
  await page.keyboard.press("Home")
  await expect(tab("Inbox")).toHaveAttribute("aria-selected", "true")

  // Working: every Thread at work, the oldest first.
  await tab("Working").click()
  await expect(rows).toHaveText(working.map((text) => new RegExp(text)))
  await shots(window, "working")

  // Later by day, Someday after a time; the Archive under Today.
  call(window, "agents.later", {
    thread: idOf(window, "call three"),
    after: "2h",
  })
  call(window, "agents.later", {
    thread: idOf(window, "read one"),
    someday: true,
  })
  call(window, "agents.archive", { thread: idOf(window, "read two") })
  await expect(tab("Later")).toHaveAccessibleName("Later, 2")
  await expect(tab("Archive")).toHaveAccessibleName("Archive, 1")
  await expect(tab("Inbox")).toHaveAccessibleName("Inbox, 4")
  // Three counts fit the tabs, at the sidebar's width and at its
  // narrowest: at its width every word is whole, whichever tab is shown;
  // at its narrowest the words are cut short, the Archive never.
  const width = await page.evaluate(() =>
    document.documentElement.style.getPropertyValue("--sidebar-width")
  )
  expect(await archiveFits(page, 16)).toBe(true)
  expect(await cutTabs(page, 16)).toEqual([])
  await tab("Working").click()
  expect(await cutTabs(page, 16)).toEqual([])
  await tab("Inbox").click()
  expect(await archiveFits(page, 13)).toBe(true)
  await page.evaluate(
    (was) => document.documentElement.style.setProperty("--sidebar-width", was),
    width
  )
  await tab("Later").click()
  // Later's two cards do not fill the list, so no scrollbar stays from
  // the Inbox, which did.
  await expect(
    sidebar.locator('[data-slot="scroll-area-scrollbar"]')
  ).toHaveCount(0)
  const later = placeOf(sidebar, "Later")
  await expect(later.filter({ hasText: "Someday" })).not.toHaveCount(0)
  await expect(later.locator("[data-row]")).toHaveText([
    /call three/,
    /read one/,
  ])
  await shots(window, "later")
  await tab("Archive").click()
  const archive = placeOf(sidebar, "Archive")
  await expect(archive.first()).toContainText("Today")
  await expect(archive.locator("[data-row]")).toHaveText([/read two/])
  await shots(window, "archive")
})

test("inbox zero says how many work and when the next wakes, once a week how many sleep until Someday, and each empty tab says what goes there (ADR 0098, S5b)", async () => {
  test.setTimeout(300_000)
  window = await startWindow()
  const { page } = window
  await firstThread(page)
  await wide(window)
  const sidebar = page.getByRole("complementary", { name: "Sidebar" })
  const tab = (name: string) =>
    sidebar.getByRole("tab", { name: new RegExp(`^${name}`) })
  const panel = sidebar.getByRole("tabpanel")

  // Nothing at all: inbox zero, and no Agent works.
  await expect(panel).toContainText("Nothing waits for you")
  await expect(panel).toContainText("No Agent works now")
  await shots(window, "zero-empty")
  // Each tab with nothing in it says what goes there; none starts a Thread
  // (Roma, 2026-11-12).
  await tab("Working").click()
  await expect(panel).toContainText("No Agent works now")
  await expect(panel.getByRole("button")).toHaveCount(0)
  await shots(window, "working-empty")
  await tab("Later").click()
  await expect(panel).toContainText("Nothing for later")
  await expect(panel).toContainText(/on a Thread puts it here\./)
  await shots(window, "later-empty")
  await tab("Archive").click()
  await expect(panel).toContainText("Nothing archived yet")
  await expect(panel).toContainText(/on a Thread closes it here\./)
  await shots(window, "archive-empty")

  // Two at work, one asleep till a time and one till Someday: inbox zero
  // says so, and on the week's first, how many sleep until Someday.
  await tab("Inbox").click()
  await send(window, "wait one")
  await send(window, "wait two")
  await send(window, "soon")
  call(window, "agents.later", { thread: idOf(window, "soon"), after: "2h" })
  await send(window, "one day")
  call(window, "agents.later", {
    thread: idOf(window, "one day"),
    someday: true,
  })
  await expect(tab("Inbox")).toHaveAccessibleName("Inbox")
  await expect(panel).toContainText("Nothing waits for you")
  await expect(panel).toContainText(/2 at work · next wakes at (\S+ )?\d/)
  const someday = panel.getByRole("button", { name: "1 someday ›" })
  await expect(someday).toBeVisible()
  await shots(window, "zero")

  // Told once this week, the next inbox zero in this window says no more:
  // a call comes and is read and archived.
  await send(window, "call again")
  await expect(tab("Inbox")).toHaveAccessibleName("Inbox, 1")
  await expect(someday).toBeHidden()
  call(window, "agents.read", { thread: idOf(window, "call again") })
  call(window, "agents.archive", { thread: idOf(window, "call again") })
  await expect(tab("Inbox")).toHaveAccessibleName("Inbox")
  await expect(panel).toContainText(/2 at work · next wakes at (\S+ )?\d/)
  await expect(someday).toBeHidden()

  // A week on, as this device forgets it told, the line shows Later at
  // Someday, and the focus goes to Later's tab, never to the page.
  await page.evaluate(() => {
    localStorage.removeItem("banda.sidebar.someday")
    localStorage.removeItem("banda.starts")
  })
  await page.reload()
  await expect(someday).toBeVisible()
  await someday.click()
  await expect(tab("Later")).toHaveAttribute("aria-selected", "true")
  await expect(tab("Later")).toBeFocused()
  await expect(page.locator("body")).not.toBeFocused()
  await expect(
    panel.locator('[data-block="later:someday:head"]')
  ).toBeInViewport()

  // Told once this week, it tells no more, the window drawn again.
  await page.evaluate(() => localStorage.removeItem("banda.starts"))
  await page.reload()
  await expect(tab("Inbox")).toHaveAttribute("aria-selected", "true")
  await expect(panel).toContainText(/2 at work · next wakes at (\S+ )?\d/)
  await expect(someday).toBeHidden()
})

test("under the pointer the list keeps its order: a call that comes waits, a card that left goes at once, and off the list the new order shows; no pill counts it (ADR 0098, decision 6)", async () => {
  test.setTimeout(180_000)
  window = await startWindow()
  const { page } = window
  await firstThread(page)
  await wide(window)
  const calls = ["call one", "call two", "call three"]
  for (const text of calls) await send(window, text)
  const sidebar = page.getByRole("complementary", { name: "Sidebar" })
  const rows = sidebar.getByRole("tabpanel").locator("[data-row]")
  const titled = (title: string) => rows.filter({ hasText: title })
  const pill = sidebar.getByText(/\d+ updates?/)
  await landed(sidebar, calls)

  // The pointer rests on the list: the call that comes waits, though the
  // Inbox's tab counts it at once, and no card moves.
  await titled("call three").hover()
  const held = await topsOf(rows)
  await send(window, "call four")
  await expect(
    sidebar.getByRole("tab", { name: /^Inbox/ })
  ).toHaveAccessibleName("Inbox, 4")
  await page.waitForTimeout(1_000)
  await expect(titled("call four")).toHaveCount(0)
  expect(await topsOf(rows)).toEqual(held)
  await expect(pill).toHaveCount(0)

  // Archived on another machine, a card goes at once, with no word in its
  // place; the rest keep their order, and the call still waits.
  call(window, "agents.archive", { thread: idOf(window, "call one") })
  await expect(titled("call one")).toHaveCount(0)
  await expect(rows).toHaveText([/call two/, /call three/])
  await expect(sidebar.getByText("Archived", { exact: true })).toHaveCount(0)
  await expect(titled("call four")).toHaveCount(0)

  // Away, the list is drawn as it is, as silently.
  await leaveSidebar(page)
  await expect(rows).toHaveText([/call two/, /call three/, /call four/])
  await expect(pill).toHaveCount(0)
})

/** The window in `mode`, on its glass, with no motion, so what the
 * pointer shows shows at once; no toast is on its way out. */
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
  await expect(
    page.locator('[data-sonner-toast][data-removed="true"]')
  ).toHaveCount(0)
}

/** `row`, a card of the list, and 8 px round it, as `path`. */
async function cardShot(page: Page, row: Locator, path: string) {
  const box = (await row.boundingBox())!
  await page.screenshot({
    path,
    clip: {
      x: box.x - 8,
      y: box.y - 8,
      width: box.width + 16,
      height: box.height + 16,
    },
  })
}

/** The cards of `scope` whose title is `title`, as the list draws them. */
const rowsNamed = (scope: Locator, title: string) =>
  scope.locator("[data-row]").filter({ hasText: title })

/** The act `name` of the card titled `title` in `scope`: hidden from a
 * screen reader, which has the pick's keys and the menu's rows (S7b). */
const actOf = (scope: Locator, title: string, name: string) =>
  rowsNamed(scope, title).locator(`[data-acts] [aria-label="${name}"]`)

test("a card's acts: Archive acts at once, the card goes, and Archived · Undo brings it back where it was; Later opens the picker at the card, which goes once a time is picked; an asking card offers Later alone (ADR 0098, S7a)", async () => {
  test.setTimeout(240_000)
  window = await startWindow()
  const { page } = window
  await firstThread(page)
  await wide(window)
  const calls = ["call one", "call two", "call three"]
  for (const text of calls) await send(window, text)
  call(window, "agents.send", {
    harness: "fake",
    text: "please ask first",
    settings: null,
  })
  const sidebar = sidebarOf(page)
  const panel = sidebar.getByRole("tabpanel")
  const rows = panel.locator("[data-row]")
  const tab = (name: string) =>
    sidebar.getByRole("tab", { name: new RegExp(`^${name}`) })
  await expect(rowsNamed(panel, "please ask first")).toContainText(
    "Asks Run a check"
  )
  await landed(sidebar, [...calls, "please ask first"])

  // An asking card offers Later alone, which names its key on the pick.
  await rowsNamed(panel, "please ask first").hover()
  const later = actOf(panel, "please ask first", "Later")
  await expect(later).toBeVisible()
  await expect(later).toHaveAttribute("title", "Later (Z)")
  await expect(actOf(panel, "please ask first", "Archive")).toHaveCount(0)

  // A done one offers Later, then Archive; under the pointer its time
  // fades out where they stand.
  const two = rowsNamed(panel, "call two")
  await two.hover()
  const archive = actOf(panel, "call two", "Archive")
  await expect(archive).toBeVisible()
  await expect(archive).toHaveAttribute("title", "Archive (S)")
  await expect(two.locator("[data-acts-time]")).toHaveCSS("opacity", "0")
  const held = await topsOf(rows)

  // Archive acts at once: the Archive's tab counts it, the card goes,
  // under the pointer too, and the toast says so, with Undo, which brings
  // it back where it was.
  await archive.click()
  await expect(tab("Archive")).toHaveAccessibleName("Archive, 1")
  await expect(rowsNamed(panel, "call two")).toHaveCount(0)
  await expect(rows).toHaveCount(3)
  const toast = toastsOf(page)
    .getByRole("listitem")
    .filter({ hasText: "Archived" })
  await expect(toast).toBeVisible()
  await toast.getByRole("button", { name: "Undo" }).click()
  await expect(tab("Archive")).toHaveAccessibleName("Archive")
  await expect(rowsNamed(panel, "call two")).toHaveCount(1)
  await leaveSidebar(page)
  expect(await topsOf(rows)).toEqual(held)

  // Later opens the picker at the card: beside it, level with its top.
  const one = rowsNamed(panel, "call one")
  await one.hover()
  await actOf(panel, "call one", "Later").click()
  const picker = pickerOf(page)
  await expect(picker).toContainText("call one")
  const card = (await one.boundingBox())!
  const box = (await picker.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(card.x + card.width)
  expect(Math.abs(box.y - card.y)).toBeLessThanOrEqual(8)
  // Picked, the card goes to Later at once.
  const field = picker.getByRole("textbox", { name: "When it comes back" })
  await field.fill("2h")
  await field.press("Enter")
  await expect(tab("Later")).toHaveAccessibleName("Later, 1")
  await expect(rowsNamed(panel, "call one")).toHaveCount(0)
  await expect(rows).toHaveCount(3)
})

test("each place's card at rest and under the pointer, and the toast, dark and light (ADR 0098, S7a)", async () => {
  test.setTimeout(300_000)
  window = await startWindow()
  const { page } = window
  await firstThread(page)
  await wide(window)
  await send(window, "Bench the window tests")
  await send(window, "Review the sidebar spec")
  await send(window, "wait for the build")
  await send(window, "Sleep till the review")
  call(window, "agents.later", {
    thread: idOf(window, "Sleep till the review"),
    after: "2h",
  })
  await send(window, "Old notes")
  call(window, "agents.archive", { thread: idOf(window, "Old notes") })
  call(window, "agents.send", {
    harness: "fake",
    text: "please ask first",
    settings: null,
  })
  const sidebar = sidebarOf(page)
  const panel = sidebar.getByRole("tabpanel")
  const tab = (name: string) =>
    sidebar.getByRole("tab", { name: new RegExp(`^${name}`) })
  await expect(tab("Archive")).toHaveAccessibleName("Archive, 1")
  await expect(tab("Later")).toHaveAccessibleName("Later, 1")
  await expect(rowsNamed(panel, "please ask first")).toContainText("Asks")
  await leaveSidebar(page)

  // Each place: its tab, its card, and the acts it shows.
  const places = [
    ["asks", "Inbox", "please ask first", ["Later"]],
    ["done", "Inbox", "Bench the window tests", ["Later", "Archive"]],
    ["working", "Working", "wait for the build", ["Later"]],
    ["later", "Later", "Sleep till the review", ["Wake"]],
    ["archive", "Archive", "Old notes", ["Unarchive"]],
  ] as const
  for (const mode of ["dark", "light"] as const) {
    await look(window, mode)
    for (const [place, name, title, acts] of places) {
      await tab(name).click()
      const row = rowsNamed(panel, title)
      await expect(row).toHaveCount(1)
      await leaveSidebar(page)
      await expect(row.locator("[data-acts]")).toHaveCSS("opacity", "0")
      await cardShot(
        page,
        row,
        `test-results/sidebar-s7a-${place}-rest-${mode}.png`
      )
      await row.hover()
      await expect(row.locator("[data-acts]")).toHaveCSS("opacity", "1")
      expect(
        await row
          .locator("[data-acts] button")
          .evaluateAll((all) => all.map((one) => one.ariaLabel))
      ).toEqual(acts)
      await cardShot(
        page,
        row,
        `test-results/sidebar-s7a-${place}-pointer-${mode}.png`
      )
    }
    await leaveSidebar(page)
  }

  // The toast, each look its own card archived.
  for (const [mode, title] of [
    ["dark", "Bench the window tests"],
    ["light", "Review the sidebar spec"],
  ] as const) {
    await look(window, mode)
    await tab("Inbox").click()
    const row = rowsNamed(panel, title)
    await row.hover()
    await actOf(panel, title, "Archive").click()
    await expect(row).toHaveCount(0)
    await expect(
      toastsOf(page).getByRole("listitem").filter({ hasText: "Archived" })
    ).toBeVisible()
    await page.screenshot({
      path: `test-results/sidebar-s7a-toast-${mode}.png`,
    })
    await leaveSidebar(page)
    await toastsOf(page).getByRole("button", { name: "Undo" }).click()
    await expect(rowsNamed(panel, title)).toHaveCount(1)
  }
})

/** The card of the Thread `title` in `scope`: its name starts with it. */
const cardOf = (scope: Locator, title: string) =>
  scope.getByRole("option", { name: new RegExp(`^${title},`) })

/** The question Delete asks for the Thread `title`. */
const askOf = (page: Page, title: string) =>
  page.getByRole("alertdialog", { name: `Delete “${title}”?` })

test("a card's menu: a right click opens it at the pointer, Shift+F10 and the Menu key at the card picked; Delete is the Archive's alone, asks first with Cancel in focus, and deletes (ADR 0098, S10a)", async () => {
  test.setTimeout(240_000)
  window = await startWindow()
  const { page } = window
  await firstThread(page)
  await wide(window)
  await send(window, "Bench the window tests")
  await send(window, "Review the sidebar spec")
  await send(window, "Old notes")
  call(window, "agents.archive", { thread: idOf(window, "Old notes") })
  await send(window, "Older notes")
  call(window, "agents.archive", { thread: idOf(window, "Older notes") })
  const sidebar = sidebarOf(page)
  const list = sidebar.getByRole("listbox")
  const tab = (name: string) =>
    sidebar.getByRole("tab", { name: new RegExp(`^${name}`) })
  const menu = page.getByRole("menu", { name: "Thread menu" })
  await expect(tab("Archive")).toHaveAccessibleName("Archive, 2")
  await landed(sidebar, ["Bench the window tests", "Review the sidebar spec"])

  // A right click: the menu at the pointer; no
  // Delete… outside the Archive.
  const bench = cardOf(list, "Bench the window tests")
  const at = (await bench.boundingBox())!
  await bench.click({ button: "right", position: { x: 120, y: 10 } })
  await expect(menu).toBeVisible()
  const shown = (await menu.boundingBox())!
  expect(Math.abs(shown.x - (at.x + 120))).toBeLessThanOrEqual(8)
  await expect(menu.getByRole("menuitem", { name: /^Archive/ })).toBeVisible()
  await expect(menu.getByRole("menuitem", { name: /^Delete/ })).toHaveCount(0)
  await page.keyboard.press("Escape")
  await expect(menu).toBeHidden()

  // Shift+F10 on the pick: the menu at its card, under its left edge, the
  // focus in it; Esc gives the focus back to the list.
  await tab("Inbox").focus()
  await page.keyboard.press("Tab")
  await expect(list).toBeFocused()
  await page.keyboard.press("ArrowDown")
  await expect(cardOf(list, "Review the sidebar spec")).toHaveAttribute(
    "aria-selected",
    "true"
  )
  const review = (await cardOf(list, "Review the sidebar spec").boundingBox())!
  await page.keyboard.press("Shift+F10")
  await expect(menu).toBeVisible()
  const keyed = (await menu.boundingBox())!
  expect(keyed.x).toBeGreaterThanOrEqual(review.x)
  expect(keyed.x).toBeLessThanOrEqual(review.x + 24)
  expect(Math.abs(keyed.y - (review.y + review.height))).toBeLessThanOrEqual(8)
  await page.keyboard.press("Escape")
  await expect(menu).toBeHidden()
  await expect(list).toBeFocused()
  // And the Menu key; its rows are the pick's.
  await page.keyboard.press("ContextMenu")
  await expect(menu).toBeVisible()
  await expect(menu.getByRole("menuitem").first()).toHaveText(/^Open/)
  await page.keyboard.press("Escape")
  await expect(list).toBeFocused()

  // Delete outside the Archive does nothing.
  await page.keyboard.press("Delete")
  await expect(page.getByRole("alertdialog")).toHaveCount(0)
  await expect(cardOf(list, "Review the sidebar spec")).toBeVisible()

  // In the Archive, Delete asks first, Cancel in focus; Cancel keeps it,
  // and the focus goes back to the list.
  await page.keyboard.press("4")
  await expect(tab("Archive")).toHaveAttribute("aria-selected", "true")
  await expect(list).toBeFocused()
  await page.keyboard.press("Home")
  const first = (await list
    .locator('[aria-selected="true"]')
    .getAttribute("aria-label"))!.split(",")[0]
  await page.keyboard.press("Delete")
  const ask = askOf(page, first)
  await expect(ask).toBeVisible()
  await expect(ask).toContainText(
    "Its messages and its worktree go. This can't be undone."
  )
  await expect(ask.getByRole("button", { name: "Cancel" })).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(ask).toBeHidden()
  await expect(list).toBeFocused()
  expect(idOf(window, first)).toBeDefined()

  // Through the menu's Delete…, last on its own: Delete deletes it.
  const other = first === "Old notes" ? "Older notes" : "Old notes"
  await cardOf(list, other).click({ button: "right" })
  const rows = menu.getByRole("menuitem")
  await expect(rows.last()).toHaveText(/^Delete…\s*Delete$/)
  await expect(menu.getByRole("menuitem", { name: /^Unarchive/ })).toBeVisible()
  await rows.last().click()
  await askOf(page, other).getByRole("button", { name: "Delete" }).click()
  await expect(askOf(page, other)).toBeHidden()
  await expect.poll(() => idOf(window, other)).toBeUndefined()
  await leaveSidebar(page)
  await expect(tab("Archive")).toHaveAccessibleName("Archive, 1")
  await expect(cardOf(list, other)).toHaveCount(0)
})

test("the card's menu on a done, a working and an archived card, and Delete's question, dark and light (ADR 0098, S10a)", async () => {
  test.setTimeout(300_000)
  window = await startWindow()
  const { page } = window
  await firstThread(page)
  await wide(window)
  await send(window, "Bench the window tests")
  await send(window, "Review the sidebar spec")
  await send(window, "wait for the build")
  await send(window, "Old notes")
  call(window, "agents.archive", { thread: idOf(window, "Old notes") })
  const sidebar = sidebarOf(page)
  const panel = sidebar.getByRole("tabpanel")
  const tab = (name: string) =>
    sidebar.getByRole("tab", { name: new RegExp(`^${name}`) })
  const menu = page.getByRole("menu", { name: "Thread menu" })
  await expect(tab("Archive")).toHaveAccessibleName("Archive, 1")
  await leaveSidebar(page)

  const places = [
    ["done", "Inbox", "Bench the window tests"],
    ["working", "Working", "wait for the build"],
    ["archived", "Archive", "Old notes"],
  ] as const
  for (const mode of ["dark", "light"] as const) {
    await look(window, mode)
    for (const [place, name, title] of places) {
      await tab(name).click()
      const row = rowsNamed(panel, title)
      await expect(row).toHaveCount(1)
      await row.click({ button: "right", position: { x: 120, y: 12 } })
      await expect(menu).toBeVisible()
      // Whole, past its fade in.
      await page.waitForTimeout(250)
      await page.screenshot({
        path: `test-results/sidebar-s10a-menu-${place}-${mode}.png`,
        animations: "disabled",
      })
      await page.keyboard.press("Escape")
      await expect(menu).toBeHidden()
    }
    // Delete's question, over the Archive.
    await rowsNamed(panel, "Old notes").click({ button: "right" })
    await menu.getByRole("menuitem", { name: /^Delete…/ }).click()
    const ask = askOf(page, "Old notes")
    await expect(ask.getByRole("button", { name: "Cancel" })).toBeFocused()
    await page.waitForTimeout(250)
    await page.screenshot({
      path: `test-results/sidebar-s10a-delete-${mode}.png`,
      animations: "disabled",
    })
    await page.keyboard.press("Escape")
    await expect(ask).toBeHidden()
    await leaveSidebar(page)
  }
})

/** The window as it is now, dark and light on its glass, with no motion,
 * as `sidebar-s14b-<name>-<mode>.png`; the pointer is away from the list. */
async function s14bShots({ page, dir }: Window, name: string) {
  const html = page.locator("html")
  await page.mouse.move(1400, 450)
  for (const mode of ["dark", "light"] as const) {
    writeFileSync(
      join(dir, "config/look.toml"),
      `mode = "${mode}"\n${GLASS}[motion]\noff = true\n`
    )
    if (mode === "dark") await expect(html).toHaveClass(/\bdark\b/)
    else await expect(html).not.toHaveClass(/\bdark\b/)
    await page.waitForTimeout(250)
    await page.screenshot({
      path: `test-results/sidebar-s14b-${name}-${mode}.png`,
      animations: "disabled",
    })
  }
}

test("a Thread an Agent started sits under its parent with ↳, past three a parent shows how many more at work, and when it asks it goes to Your turn by itself, naming its parent (ADR 0098, S14b)", async () => {
  test.setTimeout(300_000)
  window = await startWindow()
  const { page, dir } = window
  await firstThread(page)
  await wide(window)
  const sidebar = page.getByRole("complementary", { name: "Sidebar" })
  const panel = sidebar.getByRole("tabpanel")
  const shelf = placeOf(sidebar, "Working")
  const cardOf = (title: string) =>
    panel.getByRole("option", { name: new RegExp(`^${title},`) })

  // The parent works until the test ends. Its Person names it anew: what
  // its Agent writes names it, and so says "wait" no more. Its Agent's
  // pass to `banda mcp` is kept, as the next session to open writes its
  // own in its place.
  const parent = "Ship the inbox sidebar"
  await send(window, `${parent}, await review`)
  const thread = idOf(window, `${parent}, await review`)
  call(window, "agents.rename", { thread, title: parent })
  await expect.poll(() => idOf(window, parent)).toBe(thread)
  const pass = mkdtempSync(join(tmpdir(), "banda-parent-"))
  await expect.poll(() => existsSync(join(dir, "mcp.json"))).toBe(true)
  copyFileSync(join(dir, "mcp.json"), join(pass, "mcp.json"))
  // One the Person started after it, which no Agent did.
  await send(window, "Lint the repo, await")
  /** The parent's Agent starts a Thread with `text`, as its Harness does
   * through Banda's `send`, and waits until its turn runs. */
  const start = async (text: string) => {
    const sent = await agentCalls({ dir: pass }, "send", {
      harness: "fake",
      text,
    })
    expect(sent.isError).toBeFalsy()
    await expect
      .poll(() => {
        const thread = threadNamed(window, text) as
          { parent?: string; latest?: { state: string } } | undefined
        return [thread?.parent, thread?.latest?.state]
      })
      .toEqual([idOf(window, parent), "running"])
  }
  const children = [
    "Card row model, await checks",
    "Fold tests, await CI",
    "Empty places audit, await",
  ]
  for (const text of children) await start(text)
  await leaveSidebar(page)

  // At work, its children sit under it with ↳, by when each began, before
  // the Thread the Person started after it; each says who started it.
  await expect(shelf.first()).toContainText(/Working\s*· 5/)
  await expect(shelf.locator("[data-row]")).toHaveText([
    new RegExp(parent),
    ...children.map((text) => new RegExp(`↳.*${text}`)),
    /Lint the repo/,
  ])
  await expect(cardOf(parent)).not.toContainText("↳")
  await expect(cardOf("Lint the repo")).not.toContainText("↳")
  for (const text of children)
    await expect(cardOf(text)).toHaveAccessibleDescription(
      new RegExp(`\\. Started by ${parent}$`)
    )
  await expect(cardOf(parent)).toHaveAccessibleName(/, Working, /)
  await s14bShots(window, "children")

  // Past three, the rest fold into one line, which unfolds on a click, the
  // pick going on to the first it shows.
  const more = ["Shots, await light", "Lift check, await"]
  for (const text of more) await start(text)
  await leaveSidebar(page)
  const rest = shelf.getByRole("option", { name: "+ 2 more at work" })
  await expect(rest).toBeVisible()
  await expect(shelf.locator("[data-row]")).toHaveCount(5)
  await s14bShots(window, "more")
  await rest.click()
  await expect(rest).toBeHidden()
  await expect(shelf.locator("[data-row]")).toHaveText([
    new RegExp(parent),
    ...[...children, ...more].map((text) => new RegExp(`↳.*${text}`)),
    /Lint the repo/,
  ])
  await expect(cardOf(more[0]!)).toHaveAttribute("aria-selected", "true")

  // One that asks goes to Your turn by itself, line 3 naming its parent;
  // the parent keeps working, its own mark, none of its child's.
  const asker = "Split Sidebar.tsx, ask first"
  await start(asker)
  await leaveSidebar(page)
  const threads = placeOf(sidebar, "Threads")
  const asks = threads.getByRole("option", { name: new RegExp(`^${asker},`) })
  await expect(asks).toContainText("Asks Run a check")
  await expect(asks.locator(":scope > span").nth(2)).toHaveText(
    new RegExp(`^↳${parent}`)
  )
  await expect(shelf.getByText(asker)).toHaveCount(0)
  await expect(cardOf(parent)).toHaveAccessibleName(/, Working, /)
  await s14bShots(window, "asks")
})
