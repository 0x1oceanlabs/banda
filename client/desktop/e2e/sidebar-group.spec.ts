/**
 * The sidebar list grouped (ADR 0098, S8b): by Project, each header its
 * sign, its name and a chevron, Play before Work by name; on its right how
 * many wait for the Person in the loudest call's colour, then how many
 * work in grey; folded, the loudest one's mark too. Under the focus, as
 * under the pointer, + and ⋯ take the rollup's place. The view menu in
 * the sidebar's foot writes `group` into sidebar.toml; by machine, this
 * machine's group and arc's. Each is screenshot dark and light at
 * 1440×900, as `sidebar-s8b-*.png`.
 *
 * Threads start from outside the Window, as `banda call` starts them: one
 * whose first message says "wait" works until it is finished, and "ask"
 * asks; any other is answered at once and, unseen, calls its Person.
 */
import { readFileSync, writeFileSync } from "node:fs"
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
  scope.getByRole("button", { name: new RegExp(`^${title},`) })

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

/** The window as it is now, dark and light, as `sidebar-s8b-<name>-<mode>`;
 * with `pointer`, the pointer stays where it is. */
async function shots(window: Window, name: string, { pointer = false } = {}) {
  if (!pointer) await window.page.mouse.move(1400, 450)
  for (const mode of ["dark", "light"] as const) {
    await look(window, mode)
    await window.page.screenshot({
      path: `test-results/sidebar-s8b-${name}-${mode}.png`,
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
  const fold = work.getByRole("button", { name: "Work", exact: true })
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

  // Your turn's cards have two lines: the header names the Project.
  await expect(linesOf(cardOf(panel, "please ask first"))).toHaveCount(2)
  await expect(linesOf(cardOf(panel, "wait one"))).toHaveCount(1)
  await shots(window, "project")

  // The keyboard's focus in a header shows + and ⋯ in the rollup's place.
  const plus = work.getByRole("button", { name: "New Thread in Work" })
  await fold.focus()
  await page.keyboard.press("Tab")
  await expect(plus).toBeFocused()
  await expect(plus).toHaveCSS("opacity", "1")
  await expect(work.getByRole("button", { name: "Work menu" })).toBeVisible()
  await expect(waiting).toBeHidden()
  await shots(window, "project-focus", { pointer: true })
  await plus.blur()
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

test("the view menu in the sidebar's foot writes group = machine into sidebar.toml: this machine's group, then arc's (ADR 0098, S8b)", async () => {
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
  await expect(menu.getByRole("switch")).toHaveCount(3)
  await shots(window, "view-menu")
  await expect(menu).toBeVisible()

  await group.getByRole("radio", { name: "Machine" }).click()
  await expect
    .poll(() => readFileSync(join(window.dir, "config/sidebar.toml"), "utf8"))
    .toMatch(/^group = "machine"$/m)
  await expect(group.getByRole("radio", { name: "Machine" })).toHaveAttribute(
    "aria-checked",
    "true"
  )
  await page.keyboard.press("Escape")
  await expect(menu).toBeHidden()
  await view.blur()

  // A header for each machine, this one first; each one's Threads under
  // it, Your turn's cards with three lines.
  const here = headerOf(sidebar, "This machine")
  await expect(here).toHaveText(/^m1pro/)
  await expect(here.locator("button[aria-expanded]")).toHaveAttribute(
    "aria-expanded",
    "true"
  )
  await expect(here.getByLabel("1 waiting")).toBeVisible()
  await expect(here.getByLabel("1 working")).toBeVisible()
  await expect(headerOf(sidebar, "arc")).toBeVisible()
  await expect(linesOf(cardOf(panel, "please ask first"))).toHaveCount(3)
  // Neither header starts a Thread nor has a Project's menu.
  await expect(here.getByRole("button", { name: /^New Thread/ })).toHaveCount(0)
  await shots(window, "machine")

  // None takes the headers away.
  await groupBy(page, "None")
  await expect(headerOf(sidebar, "This machine")).toHaveCount(0)
  await expect(panel.locator("button[aria-expanded]")).toHaveCount(0)
  expect(threadNamed(window, "wait one")?.latest?.state).toBe("running")
})
