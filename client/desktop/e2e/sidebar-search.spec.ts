/**
 * Search in place (ADR 0098, decision 17; spec S12a): the sidebar's
 * Search filters its list by the titles, in every tab at once; while it
 * runs, All comes first and is picked, and each tab counts what it found.
 * ↑↓ move the pick while the focus stays in the field, Enter opens it,
 * and Esc brings back the tab, its pick and the focus. `is:`, `in:`,
 * `on:` and `by:` filter by where a Thread stands, its Project, its
 * machine and its Harness, arc's too. Alt+Space focuses Search while the
 * sidebar shows, and again in an empty field opens the Banda menu, as it
 * does with the sidebar hidden (decision 17, P3 option A). The results
 * with All's counts, the hint and no match, dark and light, as
 * `sidebar-s12a-*.png`.
 *
 * Threads start from outside the Window, as `banda call` starts them: one
 * whose first message says "wait" works until the test ends, one that
 * says "fail" fails, one that says "ask" asks, any other is answered at
 * once and, unseen, calls its Person.
 */
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { expect, type Locator, type Page, test } from "@playwright/test"
import { type Arc, newArc, put, withArc } from "./arc"
import {
  call,
  firstThread,
  GLASS,
  leaveSidebar,
  send,
  sidebarOf,
  startWindow,
  threadNamed,
  toastsOf,
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

/** The card of the Thread `title` in `scope`: its name starts with it. */
const cardOf = (scope: Locator, title: string) =>
  scope.getByRole("option", { name: new RegExp(`^${title},`) })

/** The sidebar's parts a search uses. */
function partsOf(page: Page) {
  const sidebar = sidebarOf(page)
  return {
    sidebar,
    search: sidebar.getByRole("combobox", { name: "Search" }),
    list: sidebar.getByRole("listbox"),
    hint: sidebar.locator("#sb-search-hint"),
    tab: (name: string) =>
      sidebar.getByRole("tab", { name: new RegExp(`^${name}`) }),
  }
}

/** Waits until `list` has picked the card titled `title`, which both
 * `list` and Search name as their active descendant. */
async function picked(list: Locator, search: Locator, title: string) {
  const card = cardOf(list, title)
  await expect(card).toHaveAttribute("aria-selected", "true")
  const id = (await card.getAttribute("id"))!
  await expect(list).toHaveAttribute("aria-activedescendant", id)
  await expect(search).toHaveAttribute("aria-activedescendant", id)
}

/** A Thread in Work named `text` that ends as `state`, started from
 * outside the Window. */
async function started(window: Window, text: string, state: string) {
  call(window, "agents.send", { harness: "fake", text, settings: null })
  await expect.poll(() => threadNamed(window, text)?.latest?.state).toBe(state)
}

/** Work's Threads in every place: Your turn, Open, Working, Later and the
 * Archive, five of them with "sidebar" in their titles. */
async function threads(window: Window) {
  await send(window, "Bench the window tests")
  await send(window, "Old sidebar notes")
  call(window, "agents.archive", {
    thread: threadNamed(window, "Old sidebar notes")!.id,
  })
  await send(window, "Move sidebar settings")
  call(window, "agents.later", {
    thread: threadNamed(window, "Move sidebar settings")!.id,
    until: Date.now() + 3 * 3_600_000,
  })
  await send(window, "wait on the sidebar tests")
  await started(window, "Fix the failing sidebar build", "failed")
  await send(window, "Review the sidebar spec")
}

test("Search finds titles in every tab: All comes first and is picked, each tab counts its own, ↑↓ move the pick from the field, Enter opens it, Esc brings back the tab, its pick and the focus, and no match says so (ADR 0098, S12a)", async () => {
  test.setTimeout(240_000)
  window = await startWindow()
  const { page } = window
  await firstThread(page)
  await threads(window)
  const { sidebar, search, list, tab } = partsOf(page)
  await leaveSidebar(page)
  await expect(tab("Archive")).toHaveAccessibleName("Archive, 1")
  await expect(tab("All")).toHaveCount(0)

  // The pick on the Inbox's second card, then / goes to Search.
  await list.focus()
  await page.keyboard.press("Home")
  await page.keyboard.press("ArrowDown")
  const before = await list.getAttribute("aria-activedescendant")
  expect(before).toBeTruthy()
  await page.keyboard.press("/")
  await expect(search).toBeFocused()

  // What it finds, in every place: All first and picked, each tab its
  // count, the Archive's by its icon.
  await page.keyboard.type("SIDEBAR")
  await expect(tab("All")).toHaveAttribute("aria-selected", "true")
  await expect(tab("All")).toHaveAccessibleName("All, 5")
  await expect(sidebar.getByRole("tab")).toHaveCount(5)
  await expect(sidebar.getByRole("tab").first()).toHaveAccessibleName("All, 5")
  await expect(tab("Inbox")).toHaveAccessibleName("Inbox, 2")
  await expect(tab("Working")).toHaveAccessibleName("Working, 1")
  await expect(tab("Later")).toHaveAccessibleName("Later, 1")
  await expect(tab("Archive")).toHaveAccessibleName("Archive, 1")
  await expect(list.getByRole("option")).toHaveCount(5)
  await expect(cardOf(list, "Bench the window tests")).toHaveCount(0)
  // The first is picked; ↓ and ↑ move the pick, and the focus stays.
  const first = (await list.getByRole("option").first().textContent())!
  const second = (await list.getByRole("option").nth(1).textContent())!
  const titleOf = (text: string) =>
    [
      "Fix the failing sidebar build",
      "Review the sidebar spec",
      "wait on the sidebar tests",
      "Move sidebar settings",
      "Old sidebar notes",
    ].find((title) => text.includes(title))!
  await picked(list, search, titleOf(first))
  await page.keyboard.press("ArrowDown")
  await picked(list, search, titleOf(second))
  await expect(search).toBeFocused()
  await page.keyboard.press("ArrowUp")
  await picked(list, search, titleOf(first))

  // Words narrow it, case and order aside; a tab shows its own finds.
  await page.keyboard.type(" spec")
  await expect(list.getByRole("option")).toHaveCount(1)
  await expect(tab("All")).toHaveAccessibleName("All, 1")
  // A tab that found nothing goes while the search runs.
  await expect(tab("Working")).toHaveCount(0)

  // Esc: the field empties, and the Inbox, its pick and the list's focus
  // come back.
  await page.keyboard.press("Escape")
  await expect(search).toHaveValue("")
  await expect(tab("All")).toHaveCount(0)
  await expect(tab("Inbox")).toHaveAttribute("aria-selected", "true")
  await expect(list).toBeFocused()
  await expect(list).toHaveAttribute("aria-activedescendant", before!)

  // Enter in the field opens the pick in its Pane, which takes the focus.
  await page.keyboard.press("/")
  await page.keyboard.type("review")
  await picked(list, search, "Review the sidebar spec")
  await page.keyboard.press("Enter")
  await expect(
    page.getByRole("region", { name: "Review the sidebar spec", exact: true })
  ).toBeVisible()
  await expect(cardOf(list, "Review the sidebar spec")).toHaveAttribute(
    "aria-current",
    "true"
  )
  await expect(search).not.toBeFocused()

  // No match: in its words, in every tab.
  await search.click()
  await search.fill("zed")
  await expect(sidebar.getByText("No Thread matches “zed”")).toBeVisible()
  await expect(sidebar.getByText("Searched titles.")).toBeVisible()
  await expect(tab("All")).toHaveAccessibleName("All")
  await page.keyboard.press("Escape")
  await expect(search).toHaveValue("")
  await expect(sidebar.getByText("No Thread matches “zed”")).toHaveCount(0)
})

test("is:, on: and by: filter by where a Thread stands, its machine and its Harness, arc's with this machine's; the hint offers each filter's values (ADR 0098, S12a)", async () => {
  test.setTimeout(300_000)
  // arc fails a Thread and finishes another in its Project "dots"; this
  // machine, "mac", fails one of the same title in Work.
  arc = newArc()
  stopArc = await arc.start()
  const folder = join(arc.code.arc, "dots")
  put(arc.disk(folder), { "README.md": "arc\n" })
  const dots = JSON.parse(arc.banda("project", "add", folder)).ok.id as string
  for (const [title, state] of [
    ["Fix the failing theme", "failed"],
    ["Done on arc", "done"],
  ]) {
    arc.send(dots, title!)
    await expect
      .poll(() => arc!.states(dots).find(([one]) => one === title)?.[1])
      .toBe(state)
  }
  window = await withArc(arc, {
    sidebar: 'preset = "inbox"\n',
    files: { "config/machine.toml": 'name = "mac"\nicon = "laptop"\n' },
  })
  const { page } = window
  await firstThread(page)
  await started(window, "Fix the failing theme", "failed")
  await send(window, "Done on mac")
  const { sidebar, search, list, hint } = partsOf(page)
  await leaveSidebar(page)
  await expect(list.getByRole("option")).toHaveCount(4)

  // The hint under the empty field: each filter, with what it takes.
  await search.click()
  await expect(hint).toBeVisible()
  await expect(search).toHaveAttribute("aria-describedby", "sb-search-hint")
  await expect(hint).toContainText("is:asking · failed · done")
  await expect(hint).toContainText("in:dots · Work")
  await expect(hint).toContainText("on:mac · arc")
  await expect(hint).toContainText("by:fake")
  // As a filter is typed, that one alone; a value clicked completes it,
  // and the focus stays.
  await page.keyboard.type("is:fa")
  await expect(hint).toHaveText(/^Filtersis:failed$/)
  await hint.getByRole("button", { name: "failed" }).click()
  await expect(search).toHaveValue("is:failed ")
  await expect(search).toBeFocused()
  await expect(hint).toBeHidden()
  await expect(list.getByRole("option")).toHaveCount(2)

  // on:arc keeps arc's alone, its machine on its card; on:mac this one's.
  await page.keyboard.type("on:arc")
  const found = list.getByRole("option")
  await expect(found).toHaveCount(1)
  await expect(found.locator('[data-machine-icon="server"]')).toBeVisible()
  await expect(found).toContainText("dots")
  await search.fill("is:failed on:mac")
  await expect(found).toHaveCount(1)
  await expect(found).toContainText("Work")
  await expect(found.locator("[data-machine-icon]")).toHaveCount(0)
  // Words and filters at once; by: the Harness; in: the Project.
  await search.fill("done by:fake in:dots")
  await expect(found).toHaveCount(1)
  await expect(found).toContainText("Done on arc")
  await search.fill("is:working")
  await expect(
    sidebar.getByText("No Thread matches “is:working”")
  ).toBeVisible()
  await expect(
    sidebar.getByText("Searched titles on mac and arc.")
  ).toBeVisible()
})

test("Alt+Space focuses Search while the sidebar shows, and in an empty field opens the Banda menu; with words typed it stays; with the sidebar hidden it opens the menu; the field shows its key under the pointer (ADR 0098, decision 17)", async () => {
  test.setTimeout(240_000)
  window = await startWindow()
  const { page } = window
  await firstThread(page)
  await send(window, "Bench the window tests")
  const { sidebar, search } = partsOf(page)
  const menu = page.getByRole("dialog", { name: "Banda menu" })

  // Its key, under the pointer, as the keymap has it.
  const key = sidebar.getByText("Alt Space", { exact: true })
  await search.hover()
  await expect(key).toHaveCSS("opacity", "1")
  await leaveSidebar(page)
  await expect(key).toHaveCSS("opacity", "0")

  // From the Pane: Search, then the menu, which Esc closes.
  await expect(search).not.toBeFocused()
  await page.keyboard.press("Alt+Space")
  await expect(search).toBeFocused()
  await expect(menu).toBeHidden()
  await page.keyboard.press("Alt+Space")
  await expect(menu).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(menu).toBeHidden()

  // With words typed, the key stays in Search.
  await search.focus()
  await page.keyboard.type("bench")
  await page.keyboard.press("Alt+Space")
  await expect(search).toBeFocused()
  await expect(menu).toBeHidden()
  await page.keyboard.press("Escape")
  await expect(search).toHaveValue("")

  // With the sidebar hidden, it is the menu's.
  await page.keyboard.press("Alt+A")
  await expect(sidebar).toBeHidden()
  await page.keyboard.press("Alt+Space")
  await expect(menu).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(menu).toBeHidden()
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

test("what a search finds with All's counts, the hint and no match, dark and light (ADR 0098, S12a)", async () => {
  test.setTimeout(300_000)
  window = await startWindow()
  const { page } = window
  await firstThread(page)
  await wide(window)
  await threads(window)
  const { sidebar, search, list, hint, tab } = partsOf(page)
  await expect(tab("Archive")).toHaveAccessibleName("Archive, 1")
  await leaveSidebar(page)
  // The failed Thread's toast has gone.
  await expect(toastsOf(page).getByRole("listitem")).toHaveCount(0, {
    timeout: 30_000,
  })
  const shot = (subject: string, mode: string) =>
    page.screenshot({
      path: `test-results/sidebar-s12a-${subject}-${mode}.png`,
      animations: "disabled",
    })

  for (const mode of ["dark", "light"] as const) {
    await look(window, mode)
    await search.focus()
    await expect(hint).toBeVisible()
    await shot("hint", mode)
    await page.keyboard.type("sidebar")
    await expect(tab("All")).toHaveAccessibleName("All, 5")
    await expect(list.getByRole("option")).toHaveCount(5)
    await shot("results", mode)
    await search.fill("zed")
    await expect(sidebar.getByText("No Thread matches “zed”")).toBeVisible()
    await shot("none", mode)
    await page.keyboard.press("Escape")
    await expect(search).toHaveValue("")
    await leaveSidebar(page)
  }
})
