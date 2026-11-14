/**
 * The sidebar list grouped (ADR 0098, S8b): by Project, each header its
 * sign, its name and a chevron, Play before Work by name; on its right how
 * many wait for the Person in the loudest call's colour, then how many
 * work in grey; folded, the loudest one's mark too. Under the pointer,
 * ⋯ takes the rollup's place, with no + (Roma, 2026-11-12); inside the
 * list, which keys pick (S7b),
 * none of it is a Tab stop, and the header is a stop of the pick, whose
 * Shift+F10 opens the Project's menu (S11). The view menu in
 * the sidebar's foot writes `group` into sidebar.toml, None or Project;
 * with None, one list, arc's cards among this machine's. A Project to trust, or one whose folder is
 * missing, is a card in Your turn, and with nothing at all the Inbox is
 * the first run (S11). Each is screenshot dark and light at 1440×900, as
 * `sidebar-s8b-*.png` and `sidebar-s11-*.png`.
 *
 * Threads start from outside the Window, as `banda call` starts them: one
 * whose first message says "wait" works until it is finished, and "ask"
 * asks; any other is answered at once and, unseen, calls its Person.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { expect, type Locator, type Page, test } from "@playwright/test"
import { type Arc, newArc, put, withArc } from "./arc"
import {
  call,
  firstThread,
  GLASS,
  groupBy,
  leaveSidebar,
  newProject,
  placeOf,
  projectId,
  send,
  sidebarOf,
  startWindow,
  threadNamed,
  viewMenuOf,
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
  arc = undefined
  stopArc = undefined
})

/** The card of the Thread named `title`: its name starts with it. */
const cardOf = (scope: Locator, title: string) =>
  scope.getByRole("option", { name: new RegExp(`^${title},`) })

/** A card's lines, top down. */
const linesOf = (card: Locator) => card.locator(":scope > span")

/** The header of the group `name`: its region's first item. */
const headerOf = (scope: Locator, name: string) => placeOf(scope, name).first()

/** The colour `element`'s text is drawn in. */
const colourOf = (element: Locator) =>
  element.evaluate((one) => getComputedStyle(one).color)

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
async function wide({ app, page, dir }: Window) {
  wallpaper(dir)
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900)
  )
  await page.setViewportSize({ width: 1440, height: 900 })
}

/** The window in `mode`, on its glass, with no motion, once the desk's
 * picture has painted and no toast is on its way out. */
async function look({ page, dir }: Window, mode: "dark" | "light") {
  const html = page.locator("html")
  writeFileSync(
    join(dir, "config/look.toml"),
    `mode = "${mode}"\n${GLASS}[motion]\noff = true\n`
  )
  if (mode === "dark") await expect(html).toHaveClass(/\bdark\b/)
  else await expect(html).not.toHaveClass(/\bdark\b/)
  await page.waitForTimeout(250)
  await expect(
    page.locator('[data-sonner-toast][data-removed="true"]')
  ).toHaveCount(0)
}

/** The window as it is now, dark and light, as
 * `sidebar-<step>-<name>-<mode>`; with `pointer`, the pointer stays where
 * it is. */
async function shots(
  window: Window,
  name: string,
  { pointer = false, step = "s8b" } = {}
) {
  if (!pointer) await window.page.mouse.move(1400, 450)
  for (const mode of ["dark", "light"] as const) {
    await look(window, mode)
    await window.page.screenshot({
      path: `test-results/sidebar-${step}-${name}-${mode}.png`,
      animations: "disabled",
    })
  }
}

/** Starts a Thread in Work with `text` that asks its Person, from outside
 * the Window: its card says so. */
async function asks(window: Window, card: Locator, text: string) {
  call(window, "agents.send", { harness: "fake", text, settings: null })
  await expect(card).toContainText("Asks Run a check")
}

test("grouped by Project, each header has its sign, name and chevron, by name; its rollup says 2 waiting in the asking orange and 1 working in grey, and folded the loudest mark too (ADR 0098, S8b)", async () => {
  test.setTimeout(240_000)
  window = await startWindow({ look: 'mode = "dark"\n' })
  const { page } = window
  await firstThread(page)
  await wide(window)
  const sidebar = sidebarOf(page)
  const panel = sidebar.getByRole("tabpanel")
  await leaveSidebar(page)

  // Work: two Threads that ask, one at work; Play: one done.
  await asks(window, cardOf(panel, "please ask first"), "please ask first")
  await asks(window, cardOf(panel, "please ask too"), "please ask too")
  await send(window, "wait one")
  await newProject(page, "Play")
  window.banda(
    "call",
    "agents.send",
    "--project",
    projectId(window, "Play"),
    "--params",
    JSON.stringify({ harness: "fake", text: "tidy notes", settings: null })
  )
  await expect(cardOf(panel, "tidy notes")).toBeVisible()
  await leaveSidebar(page)

  await groupBy(page, "Project")
  await sidebar.getByRole("button", { name: "View", exact: true }).blur()
  expect(readFileSync(join(window.dir, "config/sidebar.toml"), "utf8")).toMatch(
    /^group = "project"$/m
  )
  // A header each, by name; each Project's Threads under it.
  const folds = panel.locator("button[aria-expanded]")
  await expect(folds).toHaveCount(2)
  await expect(folds.first()).toHaveAccessibleName("Play")
  await expect(folds.last()).toHaveAccessibleName("Work")
  const work = headerOf(sidebar, "Work")
  // Folded, it is a stop of the pick too, an option.
  const fold = work.locator("button[aria-expanded]")
  await expect(fold).toHaveAttribute("aria-expanded", "true")
  await expect(placeOf(sidebar, "Work")).toHaveCount(4)
  await expect(placeOf(sidebar, "Play")).toHaveCount(2)

  // Work's rollup: 2 wait, in the asking orange; 1 works, in grey.
  const waiting = work.getByLabel("2 waiting", { exact: true })
  const working = work.getByLabel("1 working", { exact: true })
  await expect(waiting).toHaveText("2")
  await expect(working).toHaveText("1")
  const attention = await tokenOf(page, "--attention")
  expect(await colourOf(waiting)).toBe(attention)
  expect(await colourOf(working)).not.toBe(attention)
  // Unfolded, the mark is the cards'; Play's done is green.
  await expect(work.getByRole("img")).toHaveCount(0)
  expect(
    await colourOf(headerOf(sidebar, "Play").getByLabel("1 waiting"))
  ).toBe(await tokenOf(page, "--added"))

  // Every card has three lines, the Project left to its header.
  for (const title of ["please ask first", "wait one"]) {
    const lines = linesOf(cardOf(panel, title))
    await expect(lines).toHaveCount(3)
    await expect(lines.nth(2)).not.toContainText("Work")
  }
  await shots(window, "project")

  // The pointer over a header shows ⋯ in the rollup's place, and no +;
  // no Tab stop there, as the list's keys pick (S7b).
  const more = work.getByRole("button", { name: "Work menu" })
  await work.hover()
  await expect(work.locator("[data-head-acts]")).toHaveCSS("opacity", "1")
  await expect(more).toHaveAttribute("tabindex", "-1")
  await expect(more).toBeVisible()
  await expect(
    work.getByRole("button", { name: "New Thread in Work" })
  ).toHaveCount(0)
  await expect(waiting).toBeHidden()
  await shots(window, "project-focus", { pointer: true })
  await leaveSidebar(page)
  await expect(waiting).toBeVisible()

  // Folded by a click: its rows go, and the loudest mark joins the
  // rollup, which stays in sight.
  await fold.click()
  await expect(fold).toHaveAttribute("aria-expanded", "false")
  await expect(cardOf(panel, "please ask first")).toHaveCount(0)
  await expect(cardOf(panel, "wait one")).toHaveCount(0)
  await expect(placeOf(sidebar, "Work")).toHaveCount(1)
  await expect(work.getByRole("img", { name: "Asks you" })).toBeVisible()
  await expect(waiting).toBeVisible()
  await expect(working).toBeVisible()
  await shots(window, "project-folded")

  // Unfolded, they come back.
  await fold.click()
  await expect(cardOf(panel, "please ask first")).toBeVisible()
  await expect(work.getByRole("img")).toHaveCount(0)
})

test("the view menu in the sidebar's foot writes group = none into sidebar.toml: one list, arc's cards among this machine's, each of three lines (ADR 0098, S8b; decision 7, as amended)", async () => {
  test.setTimeout(240_000)
  arc = newArc()
  stopArc = await arc.start()
  const folder = join(arc.code.arc, "site")
  put(arc.disk(folder), { "README.md": "site\n" })
  const site = JSON.parse(arc.banda("project", "add", folder)).ok.id as string
  arc.send(site, "tidy the site")
  await expect
    .poll(() => arc!.states(site).find(([one]) => one === "tidy the site")?.[1])
    .toBe("done")
  window = await withArc(arc)
  // This machine by a name of its own, as this box may be named arc too.
  writeFileSync(
    join(window.dir, "config/machine.toml"),
    'name = "m1pro"\nicon = "laptop"\n'
  )
  const { page } = window
  await firstThread(page)
  await wide(window)
  const sidebar = sidebarOf(page)
  const panel = sidebar.getByRole("tabpanel")
  await leaveSidebar(page)
  await asks(window, cardOf(panel, "please ask first"), "please ask first")
  await send(window, "wait one")
  await expect(cardOf(sidebar, "tidy the site")).toBeVisible()
  await leaveSidebar(page)

  // The menu shows the file as it is: grouped by Project.
  const view = sidebar.getByRole("button", { name: "View", exact: true })
  await view.click()
  const menu = viewMenuOf(page)
  const group = menu.getByRole("radiogroup", { name: "Group by" })
  await expect(group.getByRole("radio", { name: "Project" })).toHaveAttribute(
    "aria-checked",
    "true"
  )
  await expect(menu.getByRole("switch")).toHaveCount(2)
  await shots(window, "view-menu")
  await expect(menu).toBeVisible()

  // Two ways to group, and no Card row: every card has three lines.
  await expect(group.getByRole("radio")).toHaveCount(2)
  await expect(menu.getByRole("radiogroup", { name: "Card" })).toHaveCount(0)
  await group.getByRole("radio", { name: "None" }).click()
  await expect
    .poll(() => readFileSync(join(window.dir, "config/sidebar.toml"), "utf8"))
    .toMatch(/^group = "none"$/m)
  await expect(group.getByRole("radio", { name: "None" })).toHaveAttribute(
    "aria-checked",
    "true"
  )
  await page.keyboard.press("Escape")
  await expect(menu).toBeHidden()
  await view.blur()

  // One list, the Inbox: no header; each card of three lines, arc's
  // naming arc on its line 3.
  await expect(panel.locator("button[aria-expanded]")).toHaveCount(0)
  await expect(linesOf(cardOf(panel, "please ask first"))).toHaveCount(3)
  const there = linesOf(cardOf(panel, "tidy the site"))
  await expect(there).toHaveCount(3)
  await expect(there.nth(2)).toContainText("arc")
  await shots(window, "none")

  // Project brings the headers back.
  await groupBy(page, "Project")
  await expect(panel.locator("button[aria-expanded]").first()).toBeVisible()
  expect(threadNamed(window, "wait one")?.latest?.state).toBe("running")
})

/** Focuses the sidebar list as the keys do, from its Inbox tab: its first
 * stop is picked. */
async function focusList(page: Page): Promise<Locator> {
  const sidebar = sidebarOf(page)
  const list = sidebar.getByRole("listbox")
  await sidebar.getByRole("tab", { name: /^Inbox/ }).focus()
  await page.keyboard.press("Tab")
  await expect(list).toBeFocused()
  return list
}

/** Adds a folder of code the Person did not write, from a terminal: one
 * that holds what a Harness loads, so the engine leaves it untrusted. */
function addForeign(window: Window, name: string): string {
  const folder = join(window.dir, "work", name)
  mkdirSync(join(folder, ".claude"), { recursive: true })
  writeFileSync(join(folder, ".mcp.json"), "{}\n")
  window.banda("project", "add", folder)
  return folder
}

/** Whether the engine trusts the Project `name`. */
const trusts = (window: Window, name: string) =>
  (
    JSON.parse(window.banda("call", "projects.list")) as {
      ok: { name: string; trusted: boolean }[]
    }
  ).ok.find((one) => one.name === name)?.trusted

test("a Project to trust is a card first in Your turn: Enter asks on the trust card by it, which trusts it; S, Z and U do nothing; Not now puts another off on this device (ADR 0098, S11)", async () => {
  test.setTimeout(240_000)
  window = await startWindow()
  const { page } = window
  await firstThread(page)
  await wide(window)
  await send(window, "Bench the window tests")
  const folder = addForeign(window, "widget")
  addForeign(window, "gadget")
  const sidebar = sidebarOf(page)
  const panel = sidebar.getByRole("tabpanel")
  const widget = panel.getByRole("option", { name: "Trust “widget”?" })
  const gadget = panel.getByRole("option", { name: "Trust “gadget”?" })
  await expect(widget).toBeVisible()
  await expect(gadget).toBeVisible()
  await expect(widget).toContainText(`Project ${folder}`)
  await expect(widget).toHaveAttribute(
    "aria-description",
    `Project ${folder}. Its settings, hooks and MCP servers wait for your trust. Trust… or Not now`
  )
  await expect(widget).toContainText("Trust…")
  await expect(widget).toContainText("Not now")
  // First in Your turn, above the Thread that calls; the tab counts them.
  const options = panel.getByRole("option")
  await expect(options.nth(0)).toHaveAttribute("data-asks", "trust")
  await expect(options.nth(1)).toHaveAttribute("data-asks", "trust")
  await expect(options.nth(2)).toHaveAccessibleName(/^Bench the window tests,/)
  await expect(
    sidebar.getByRole("tab", { name: /^Inbox/ })
  ).toHaveAccessibleName(/^Inbox, 3\b/)
  await leaveSidebar(page)
  await shots(window, "trust-card", { step: "s11" })

  // The keys pick it; S, Z and U do nothing on it.
  const list = await focusList(page)
  const first = options.nth(0)
  await expect(first).toHaveAttribute("aria-selected", "true")
  const name = (await first.getAttribute("aria-label"))!
  for (const key of ["s", "z", "u"]) await page.keyboard.press(key)
  await expect(panel.getByRole("option", { name })).toBeVisible()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect(list).toBeFocused()

  // Enter asks on the trust card, by the card; Trust trusts it, and its
  // card goes.
  await page.keyboard.press("Enter")
  const project = name === "Trust “widget”?" ? "widget" : "gadget"
  const card = page.getByRole("dialog", { name: `Trust ${project}?` })
  await expect(card).toContainText(".claude/")
  await shots(window, "trust-asked", { step: "s11", pointer: true })
  await card.getByRole("button", { name: "Trust", exact: true }).click()
  await expect(card).toBeHidden()
  await expect.poll(() => trusts(window, project)).toBe(true)
  await expect(panel.getByRole("option", { name })).toHaveCount(0)

  // Not now puts the other off on this device: the engine still does not
  // trust it, and its card stays off when the Projects are heard again.
  const other = project === "widget" ? gadget : widget
  const otherName = project === "widget" ? "gadget" : "widget"
  await other.hover()
  await other.getByText("Not now", { exact: true }).click()
  await expect(other).toHaveCount(0)
  // Pinned from a terminal, it is heard again (ADR 0127).
  window.banda(
    "call",
    "projects.update",
    "--params",
    JSON.stringify({ project: projectId(window, otherName), pinned: true })
  )
  await expect(panel.locator("[data-project-card]")).toHaveCount(0)
  expect(trusts(window, otherName)).toBe(false)
})

test("a Project whose folder is missing is a card in Your turn: Enter opens Locate…, and Remove… asks first, then removes it (ADR 0098, S11)", async () => {
  test.setTimeout(240_000)
  const id = "01a192e5-5e2b-76a7-931a-79a494cb1801"
  const manifest = {
    id,
    name: "old",
    folder: "/nonexistent/banda-old",
    author: { kind: "person", id: "01a192e5-416d-7657-825a-a16f9f43fba6" },
    command: "01a192e5-5e28-794a-b76c-76ef600978a9",
    created_at: 1,
  }
  window = await startWindow({
    files: { [`data/projects/${id}/project.json`]: JSON.stringify(manifest) },
  })
  const { page } = window
  await firstThread(page)
  await wide(window)
  const panel = sidebarOf(page).getByRole("tabpanel")
  const old = panel.getByRole("option", { name: "“old” is missing" })
  await expect(old).toContainText("Project /nonexistent/banda-old")
  await expect(old).toHaveAttribute(
    "aria-description",
    "Project /nonexistent/banda-old. Its folder moved or was deleted. Locate… or Remove…"
  )
  await expect(old).toContainText("Locate…")
  await expect(old).toContainText("Remove…")
  await leaveSidebar(page)
  await shots(window, "missing-card", { step: "s11" })

  // Enter on it opens the Banda menu's Locate folder where it was.
  await focusList(page)
  await expect(old).toHaveAttribute("aria-selected", "true")
  await page.keyboard.press("Enter")
  const menu = page.getByRole("dialog", { name: "Banda menu" })
  await expect(menu.getByRole("combobox", { name: "Search" })).toHaveValue(
    "/nonexistent/"
  )
  await page.keyboard.press("Escape")
  await expect(menu).toBeHidden()

  // Remove… asks first, as the settings do, though with its folder gone
  // the agents module counts no Threads; Remove Project removes it.
  await old.hover()
  await old.getByText("Remove…", { exact: true }).click()
  const ask = page.getByRole("dialog", {
    name: 'Remove Project "old" and delete its Threads?',
  })
  await expect(ask).toContainText("/nonexistent/banda-old")
  await ask.getByRole("button", { name: "Remove Project" }).click()
  await expect(ask).toBeHidden()
  await expect(old).toHaveCount(0)
  expect(window.banda("call", "projects.list")).not.toContain("banda-old")
})

test("a group's header is a stop of the pick: picked, it shows ⋯, and Shift+F10 or the Menu key opens the Project's menu, with no New Thread here (ADR 0098, S11; Roma 2026-11-12)", async () => {
  test.setTimeout(240_000)
  window = await startWindow()
  const { page } = window
  await firstThread(page)
  await wide(window)
  await send(window, "Bench the window tests")
  await send(window, "wait one")
  await leaveSidebar(page)
  await groupBy(page, "Project")
  const sidebar = sidebarOf(page)
  const work = headerOf(sidebar, "Work")
  const header = work.getByRole("option", { name: "Work", exact: true })
  await expect(header).toHaveAttribute("aria-expanded", "true")

  // Picked by the keys, unfolded, it shows its acts as the pointer does.
  const list = await focusList(page)
  await expect(header).toHaveAttribute("aria-selected", "true")
  await expect(work.locator("[data-head-acts]")).toHaveCSS("opacity", "1")
  await expect(
    work.getByRole("button", { name: "New Thread in Work" })
  ).toHaveCount(0)
  await shots(window, "group-picked", { step: "s11" })

  // Shift+F10 opens the Project's menu by the header; Esc gives the list
  // its focus back.
  const menu = page.getByRole("menu", { name: "Project menu" })
  await page.keyboard.press("Shift+F10")
  await expect(menu).toBeVisible()
  await expect(menu.getByRole("menuitem")).toHaveText([
    "Open folder",
    "Project settings…",
    "Archive its Threads",
    "Remove from Banda…",
  ])
  await expect(menu).toContainText("Work")
  await shots(window, "group-menu", { step: "s11" })
  await expect(menu).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(menu).toBeHidden()
  await expect(list).toBeFocused()

  // ← folds it; Enter unfolds it and picks its first card, ↑ the header
  // again. The Menu key opens the menu too; Esc gives the list its focus
  // back.
  await page.keyboard.press("ArrowLeft")
  await expect(header).toHaveAttribute("aria-expanded", "false")
  await expect(header).toHaveAttribute("aria-selected", "true")
  await page.keyboard.press("Enter")
  await expect(header).toHaveAttribute("aria-expanded", "true")
  await expect(header).toHaveAttribute("aria-selected", "false")
  await page.keyboard.press("ArrowUp")
  await expect(header).toHaveAttribute("aria-selected", "true")
  await page.keyboard.press("ContextMenu")
  await expect(menu).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(menu).toBeHidden()
  await expect(list).toBeFocused()

  // ⋯ under the pointer opens the same menu.
  await work.hover()
  await work.getByRole("button", { name: "Work menu" }).click()
  await expect(menu).toBeVisible()
  await page.keyboard.press("Escape")
})

test("with no Project and no Thread, the Inbox is the first run: Add Project… opens the Banda menu at Add Project (ADR 0098, S11)", async () => {
  test.setTimeout(240_000)
  window = await startWindow()
  const { page } = window
  await wide(window)
  await leaveSidebar(page)
  const panel = sidebarOf(page).getByRole("tabpanel")
  await expect(panel).toContainText("Add a project to start")
  await expect(panel).toContainText("A folder your Agents work in.")
  // It starts no Thread itself: a Thread starts in the New Thread Pane
  // (Roma, 2026-11-12).
  await expect(panel.getByRole("button")).toHaveText(["Add Project…"])
  await shots(window, "first-run", { step: "s11" })

  await panel.getByRole("button", { name: "Add Project…" }).click()
  const menu = page.getByRole("dialog", { name: "Banda menu" })
  await expect(menu.getByRole("option", { name: /New Project/ })).toBeVisible()
})
