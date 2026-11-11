/**
 * The sidebar as the Person's inbox (ADR 0098, S5b): its tabs, Your turn
 * oldest first, Open newest first under a hairline, the Working shelf in
 * grey with "+ N more", Later by day, the Archive, inbox zero in words and
 * each tab empty. Each state is screenshot in the dark and the light, on
 * glass and on a solid desk, at 1440×900, as `sidebar-s5b-*.png`. And the
 * list holding still under the pointer (ADR 0098, S5c): what comes waits,
 * what leaves stays dimmed in its slot, and both land as the pointer
 * leaves, screenshot as a strip of three frames, `sidebar-s5c-*.png`.
 * And a card's acts under the pointer (ADR 0098, S7a): Archive at once,
 * a ghost line in its slot until the pointer leaves and the toast that
 * takes it back, Later's picker at the card, an asking card's Later
 * alone; each place's card at rest and under the pointer, the ghost line
 * and the toast, as `sidebar-s7a-*.png`.
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
 * that order, with nothing between, as the window draws them, and the
 * batch that drew them is over. The engine says a Thread is done before
 * the window's list has it there: the list may draw it Open first, before
 * its turn begins, then Working, a batch each. What a batch takes away,
 * as the hairline above Open, the Working head or inbox zero, fades in its
 * slot for a moment, and a slot that closes once the pointer is on the
 * list moves the cards under it, which the hold never stops. */
async function landed(sidebar: Locator, titles: string[]) {
  await expect(placeOf(sidebar, "Threads")).toHaveText([
    /^Your turn/,
    ...titles.map((title) => new RegExp(title)),
  ])
  await expect(sidebar.locator("[data-going]")).toHaveCount(0)
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

test("a call that comes while the pointer is on the list waits until the pointer leaves, and no pill counts it (ADR 0098, S5c)", async () => {
  test.setTimeout(180_000)
  window = await startWindow()
  const { page } = window
  await firstThread(page)
  await wide(window)
  await send(window, "call one")
  await send(window, "call two")
  const sidebar = page.getByRole("complementary", { name: "Sidebar" })
  const rows = sidebar.getByRole("tabpanel").locator("[data-row]")
  const come = rows.filter({ hasText: "call three" })
  const pill = sidebar.getByText(/\d+ updates?/)
  await landed(sidebar, ["call one", "call two"])

  // The pointer rests on the list: the call that comes waits, though the
  // Inbox's tab counts it at once, and no card moves.
  await rows.first().hover()
  const held = await topsOf(rows)
  await send(window, "call three")
  await expect(
    sidebar.getByRole("tab", { name: /^Inbox/ })
  ).toHaveAccessibleName("Inbox, 3")
  await page.waitForTimeout(1_000)
  await expect(come).toHaveCount(0)
  expect(await topsOf(rows)).toEqual(held)
  await expect(pill).toHaveCount(0)

  // Away, it comes in the next batch, as silently.
  await leaveSidebar(page)
  await expect(come).toHaveCount(1)
  await expect(rows).toHaveCount(3)
  await expect(pill).toHaveCount(0)
})

/** `frames`, screenshots of one height, side by side, 8 px apart, into
 * `path`: drawn on a canvas in the page, from their bytes. */
async function strip(page: Page, frames: Buffer[], path: string) {
  const drawn = await page.evaluate(
    async (shots) => {
      const images = await Promise.all(
        shots.map((shot) =>
          createImageBitmap(
            new Blob([Uint8Array.from(atob(shot), (c) => c.charCodeAt(0))], {
              type: "image/png",
            })
          )
        )
      )
      const gap = 8
      const canvas = document.createElement("canvas")
      canvas.width =
        images.reduce((sum, image) => sum + image.width, 0) +
        gap * (images.length - 1)
      canvas.height = Math.max(...images.map((image) => image.height))
      const context = canvas.getContext("2d")!
      let x = 0
      for (const image of images) {
        context.drawImage(image, x, 0)
        x += image.width + gap
      }
      return canvas.toDataURL("image/png").split(",")[1]!
    },
    frames.map((frame) => frame.toString("base64"))
  )
  writeFileSync(path, Buffer.from(drawn, "base64"))
}

test("a Thread archived elsewhere while the list holds stays in its slot, dimmed and saying Archived, and goes as the pointer leaves; in the dark and the light, as a strip of three frames (ADR 0098, S5c)", async () => {
  test.setTimeout(240_000)
  window = await startWindow()
  const { page, dir } = window
  await firstThread(page)
  await wide(window)
  const calls = ["call one", "call two", "call three", "call four"]
  for (const text of calls) await send(window, text)
  const sidebar = page.getByRole("complementary", { name: "Sidebar" })
  const rows = sidebar.getByRole("tabpanel").locator("[data-row]")
  const archive = sidebar.getByRole("tab", { name: /^Archive/ })
  const html = page.locator("html")
  await landed(sidebar, calls)
  // The fades played ten times slower as the hold lets go, for the strip's
  // middle frame to catch one on its way.
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("Animation.enable")
  const looks = [
    ["dark", "call two"],
    ["light", "call three"],
  ] as const
  for (const [i, [mode, title]] of looks.entries()) {
    writeFileSync(join(dir, "config/look.toml"), `mode = "${mode}"\n${GLASS}`)
    if (mode === "dark") await expect(html).toHaveClass(/\bdark\b/)
    else await expect(html).not.toHaveClass(/\bdark\b/)
    await page.waitForTimeout(250)
    const box = (await sidebar.boundingBox())!
    const frame = () => page.screenshot({ clip: box })

    // Held: archived on another machine, it stays in its slot, at half,
    // saying where it went, with no action of its own; no card moves.
    await rows.first().hover()
    const held = await topsOf(rows)
    call(window, "agents.archive", { thread: idOf(window, title) })
    await expect(archive).toHaveAccessibleName(`Archive, ${i + 1}`)
    const gone = rows.filter({ hasText: title })
    await expect(gone).toContainText("Archived")
    await expect
      .poll(() =>
        gone.evaluate(
          (one) =>
            getComputedStyle(one.closest("[data-key]")!.firstElementChild!)
              .opacity
        )
      )
      .toBe("0.5")
    await expect(gone.getByRole("button", { name: "Later" })).toHaveCount(0)
    expect(await topsOf(rows)).toEqual(held)
    const frames = [await frame()]

    // Let go: it fades out where it stood, and the rows below close up.
    await cdp.send("Animation.setPlaybackRate", { playbackRate: 0.1 })
    await leaveSidebar(page)
    await page.waitForTimeout(600)
    frames.push(await frame())
    await cdp.send("Animation.setPlaybackRate", { playbackRate: 1 })
    await expect(gone).toHaveCount(0)
    await expect(rows).toHaveCount(3 - i)
    await page.waitForTimeout(400)
    frames.push(await frame())
    await page.screenshot({ path: `test-results/sidebar-s5c-${mode}.png` })
    await strip(page, frames, `test-results/sidebar-s5c-${mode}-strip.png`)
  }
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

/** The cards of `scope` whose title is `title`, as the list draws them,
 * a ghost's too. */
const rowsNamed = (scope: Locator, title: string) =>
  scope.locator("[data-row]").filter({ hasText: title })

/** The act `name` of the card titled `title` in `scope`. */
const actOf = (scope: Locator, title: string, name: string) =>
  rowsNamed(scope, title).getByRole("button", { name, exact: true })

test("a card's acts: Archive acts at once, its ghost line holds the slot until the pointer leaves, and Archived · Undo brings it back; Later opens the picker at the card, whose ghost's Undo wakes it; an asking card offers Later alone (ADR 0098, S7a)", async () => {
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

  // An asking card offers Later alone, which names its key.
  await rowsNamed(panel, "please ask first").hover()
  const later = actOf(panel, "please ask first", "Later")
  await expect(later).toBeVisible()
  await expect(later).toHaveAttribute("title", "Later (Alt+Z)")
  await expect(actOf(panel, "please ask first", "Archive")).toHaveCount(0)

  // A done one offers Later, then Archive; under the pointer its time
  // fades out where they stand.
  const two = rowsNamed(panel, "call two")
  await two.hover()
  const archive = actOf(panel, "call two", "Archive")
  await expect(archive).toBeVisible()
  await expect(archive).toHaveAttribute("title", "Archive (Alt+S)")
  await expect(two.locator("[data-acts-time]")).toHaveCSS("opacity", "0")
  const held = await topsOf(rows)

  // Archive acts at once: the Archive's tab counts it, a ghost line stands
  // in its slot, and the toast says so, with Undo. No card moves while the
  // pointer stays on the list.
  await archive.click()
  await expect(tab("Archive")).toHaveAccessibleName("Archive, 1")
  const ghost = panel.locator("[data-key] > p").filter({ hasText: /^Archived/ })
  await expect(ghost).toHaveText("Archived·Undo")
  await expect(ghost.getByRole("button", { name: "Undo" })).toBeVisible()
  const toast = toastsOf(page)
    .getByRole("listitem")
    .filter({ hasText: "Archived" })
  await expect(toast).toBeVisible()
  await expect(toast.getByRole("button", { name: "Undo" })).toBeVisible()
  await rowsNamed(panel, "call three").hover()
  await page.waitForTimeout(500)
  expect(await topsOf(rows)).toEqual(held)
  await expect(rowsNamed(panel, "call two")).toHaveCount(1)

  // The pointer leaves: the slot closes. The toast's Undo brings it back.
  await leaveSidebar(page)
  await expect(rowsNamed(panel, "call two")).toHaveCount(0)
  await expect(rows).toHaveCount(3)
  await toast.getByRole("button", { name: "Undo" }).click()
  await expect(tab("Archive")).toHaveAccessibleName("Archive")
  await expect(rowsNamed(panel, "call two")).toHaveCount(1)
  await expect(ghost).toHaveCount(0)

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
  // Picked, its ghost line says till when; the ghost's Undo wakes it, and
  // it is back in its slot at once.
  const field = picker.getByRole("textbox", { name: "When it comes back" })
  await field.fill("2h")
  await field.press("Enter")
  await expect(tab("Later")).toHaveAccessibleName("Later, 1")
  const put = panel.locator("[data-key] > p").filter({ hasText: /^Later · / })
  await expect(put).toHaveText(/^Later · (\S+ )?\d+:\d\d·Undo$/)
  await put.getByRole("button", { name: "Undo" }).click()
  await expect(tab("Later")).toHaveAccessibleName("Later")
  await expect(put).toHaveCount(0)
  await expect(rowsNamed(panel, "call one")).toHaveCount(1)
  expect(await topsOf(rows)).toEqual(held)
})

test("each place's card at rest and under the pointer, a ghost line and the toast, dark and light (ADR 0098, S7a)", async () => {
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

  // A ghost line and the toast, each look its own card archived.
  for (const [mode, title] of [
    ["dark", "Bench the window tests"],
    ["light", "Review the sidebar spec"],
  ] as const) {
    await look(window, mode)
    await tab("Inbox").click()
    const row = rowsNamed(panel, title)
    await row.hover()
    await actOf(panel, title, "Archive").click()
    const ghost = panel
      .locator("[data-key] > p")
      .filter({ hasText: /^Archived/ })
    await expect(ghost).toBeVisible()
    await expect(
      toastsOf(page).getByRole("listitem").filter({ hasText: "Archived" })
    ).toBeVisible()
    await cardShot(page, ghost, `test-results/sidebar-s7a-ghost-${mode}.png`)
    await page.screenshot({
      path: `test-results/sidebar-s7a-toast-${mode}.png`,
    })
    await leaveSidebar(page)
    await expect(ghost).toHaveCount(0)
    await toastsOf(page).getByRole("button", { name: "Undo" }).click()
    await expect(rowsNamed(panel, title)).toHaveCount(1)
  }
})
