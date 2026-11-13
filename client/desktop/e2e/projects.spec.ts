/**
 * A change of a Project is a fact the window follows (ADR 0127; track 3,
 * WS9): one added, renamed or removed from outside the window, as `banda
 * project add` does from a terminal, shows in the open window at once. The
 * page is not loaded again, and its window never comes to the front: a
 * headless window takes no focus, and the test gives it none.
 */
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { expect, type Locator, test } from "@playwright/test"
import {
  firstThread,
  groupBy,
  leaveSidebar,
  sidebarOf,
  startWindow,
  type Window,
} from "./window"

let window: Window

test.afterEach(async () => {
  await window?.close()
})

/** The card of the Thread named `title`: its name starts with it. */
const cardOf = (scope: Locator, title: string) =>
  scope.getByRole("option", { name: new RegExp(`^${title},`) })

test("a Project added, renamed and removed from a terminal shows in the open window at once, with no reload and no focus (ADR 0127, WS9)", async () => {
  window = await startWindow()
  const { page, dir } = window
  await firstThread(page)
  const sidebar = sidebarOf(page)
  const panel = sidebar.getByRole("tabpanel")
  await groupBy(page, "Project")
  await sidebar.getByRole("button", { name: "View", exact: true }).blur()
  // The list holds still under the pointer (ADR 0098): away from it.
  await leaveSidebar(page)
  // The page as it is now: one loaded again would forget the mark, and
  // one that came to the front would count it.
  await page.evaluate(() => {
    const own = globalThis as unknown as { marked: boolean; fronts: number }
    own.marked = true
    own.fronts = 0
    addEventListener("focus", () => own.fronts++)
  })
  // A Project's header in the list grouped by Project, by its whole name.
  const header = (name: string) =>
    panel.getByRole("option", { name, exact: true })

  // Added from a terminal, with a Thread started there too: its header
  // and its Thread show.
  const folder = join(dir, "work", "lab")
  mkdirSync(folder, { recursive: true })
  const project = JSON.parse(window.banda("project", "add", folder)).ok
    .id as string
  window.banda(
    "call",
    "agents.send",
    "--project",
    project,
    "--params",
    JSON.stringify({ harness: "fake", text: "Facts first", settings: null })
  )
  await expect(cardOf(panel, "Facts first")).toBeVisible()
  await expect(header("lab")).toBeVisible()

  // Renamed from a terminal: its header says so.
  window.banda(
    "call",
    "projects.update",
    "--params",
    JSON.stringify({ project, name: "Lab two" })
  )
  await expect(header("Lab two")).toBeVisible()
  await expect(header("lab")).toHaveCount(0)
  await expect(cardOf(panel, "Facts first")).toBeVisible()

  // Removed from a terminal: it goes, with its Thread.
  window.banda(
    "call",
    "projects.remove",
    "--params",
    JSON.stringify({ project })
  )
  await expect(header("Lab two")).toHaveCount(0)
  await expect(cardOf(panel, "Facts first")).toHaveCount(0)

  expect(
    await page.evaluate(() => {
      const own = globalThis as unknown as { marked: boolean; fronts: number }
      return [own.marked, own.fronts]
    })
  ).toEqual([true, 0])
})
