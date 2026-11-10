/**
 * The sidebar as the Person's inbox (ADR 0098, S5b): its tabs, Your turn
 * oldest first, Open newest first under a hairline, the Working shelf in
 * grey with "+ N more", Later by day, the Archive, inbox zero in words and
 * each tab empty. Each state is screenshot in the dark and the light, on
 * glass and on a solid desk, at 1440×900, as `sidebar-s5b-*.png`.
 *
 * Threads start from outside the Window, as `banda call` starts them: one
 * whose first message says "wait" works until the test ends, any other is
 * answered at once and, unseen, calls its Person.
 */
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { expect, type Locator, type Page, test } from "@playwright/test"
import {
  firstThread,
  GLASS,
  projectId,
  startWindow,
  wallpaper,
  type Window,
} from "./window"

let window: Window

test.afterEach(async () => {
  await window?.close()
})

/** Work's id in each window, looked up once. */
const works = new WeakMap<Window, string>()

/** What the engine's `method` answers in the Project "Work", run as the
 * Person's `banda call`, from outside the Window. */
function call(window: Window, method: string, params?: object) {
  if (!works.has(window)) works.set(window, projectId(window, "Work"))
  const work = works.get(window)!
  const args = params ? ["--params", JSON.stringify(params)] : []
  return JSON.parse(window.banda("call", method, "--project", work, ...args)).ok
}

/** The id of Work's Thread named `title`, as the engine lists it; none
 * until it is listed. */
function idOf(window: Window, title: string): string | undefined {
  const { threads } = call(window, "agents.threads") as {
    threads: { id: string; title: string; latest: { state: string } }[]
  }
  return threads.find((thread) => thread.title === title)?.id
}

/** The state of the latest turn of Work's Thread named `title`. */
function stateOf(window: Window, title: string): string | undefined {
  const { threads } = call(window, "agents.threads") as {
    threads: { title: string; latest: { state: string } }[]
  }
  return threads.find((thread) => thread.title === title)?.latest.state
}

/** A Thread in Work started with `text`, one after the other, so each is
 * newer than the one before: at work while its words say "wait", else
 * answered. */
async function send(window: Window, text: string) {
  call(window, "agents.send", { harness: "fake", text, settings: null })
  await expect
    .poll(() => stateOf(window, text))
    .toBe(text.includes("wait") ? "running" : "done")
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
 * pointer is away from the list, which holds still under it. */
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
  const threads = sidebar.getByRole("group", { name: "Threads" })
  await expect(threads).toContainText(/Your turn\s*· 3/)
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
  const shelf = sidebar.getByRole("group", { name: "Working" })
  await expect(shelf).toContainText(/Working\s*· 9/)
  await expect(shelf.locator("[data-row]")).toHaveText(
    working.slice(0, 6).map((text) => new RegExp(text))
  )
  expect(
    await colourOf(shelf.getByText("wait one", { exact: true }).first())
  ).not.toBe(
    await colourOf(threads.getByText("read four", { exact: true }).first())
  )
  const more = shelf.getByRole("button", { name: "+ 3 more" })
  await expect(more).toBeVisible()
  await shots(window, "inbox")
  // It shows the rest in place, and the focus goes on to the first of
  // them as it goes, never to the page.
  await more.click()
  await expect(shelf.locator("[data-row]")).toHaveCount(9)
  await expect(more).toBeHidden()
  await expect(shelf.locator(":focus")).toHaveCount(1)
  await expect(page.locator("body")).not.toBeFocused()

  // 1–4 show the tabs, from anywhere in the sidebar, a card too: the focus
  // goes to the tab shown, as the card goes with the tab it was in, never
  // to the page. The arrows go along them. Each draws at once.
  await threads.locator("[data-row] button").first().focus()
  await page.keyboard.press("2")
  await expect(tab("Working")).toHaveAttribute("aria-selected", "true")
  await expect(tab("Working")).toBeFocused()
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
  const later = sidebar.getByRole("group", { name: "Later" })
  await expect(later).toContainText("Someday")
  await expect(later.locator("[data-row]")).toHaveText([
    /call three/,
    /read one/,
  ])
  await shots(window, "later")
  await tab("Archive").click()
  const archive = sidebar.getByRole("group", { name: "Archive" })
  await expect(archive).toContainText("Today")
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
  // Each tab with nothing in it says what goes there; Working's starts a
  // Thread.
  await tab("Working").click()
  await expect(panel).toContainText("No Agent works now")
  await expect(panel.getByRole("button", { name: "New Thread" })).toBeVisible()
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
