/**
 * The sidebar's header and foot (ADR 0098, decisions 19–21). ✎ starts a
 * Thread at once where Alt+Enter does (`Here.starts`, ADR 0102): in the
 * Project in front, on the machine that lists it, with the default
 * Harness (S9a). A right click, a press held, ↓ or Shift+F10 opens its
 * menu instead, which starts nothing by opening: New Thread with its key
 * in force; "in", the Projects and No Project; "with", the Harnesses;
 * then Add Project… and Projects…. A tick marks what a click takes, and a
 * pick starts one at once. With one machine the menu names none (ADR
 * 0095, decision 4). Esc gives ✎ the focus back, never the page; a press
 * on ✎ while it is open shuts it, and starts nothing. The Flow left the
 * header for the bar, after the workspaces, as it arranges the desk, not
 * the list (decision 20, S9b). The foot keeps Settings and View, each
 * tooltip with its key; the key sheet and the theme went to the Banda
 * menu, which the bar's logo opens now, not the sidebar, and Add Project
 * to ✎'s menu (decision 21, S9c). Quiet's bell is the foot's third: on
 * for 30 minutes, nothing calls, and both bells are crossed (S9d).
 * Pictures for Roma, dark and light, with glass and without, at 1440×900:
 * `test-results/sidebar-s9a-*.png`, `test-results/sidebar-s9b-*.png`,
 * `test-results/sidebar-s9c-*.png` and `test-results/sidebar-s9d-*.png`.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { expect, test } from "@playwright/test"
import {
  countNotes,
  desktopOf,
  firstThread,
  GLASS,
  newProject,
  placeOf,
  sendAndLeave,
  setInFront,
  startWindow,
  wallpaper,
  type Window,
} from "./window"

let window: Window | undefined

test.afterEach(async () => {
  await window?.close()
  window = undefined
})

/** Still, so the pictures are of what stays. */
const STILL = "[motion]\noff = true\n"

/** The window at 1440×900, as Roma's pictures are. */
async function wide({ app, page }: Window) {
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900)
  )
  await page.setViewportSize({ width: 1440, height: 900 })
}

/** Pictures of the window as it is, in the dark and the light, on glass
 * made of a wallpaper, as Banda's desk is by default (ADR 0100), and with
 * glass off: `sidebar-<name>-<mode>.png` and
 * `sidebar-<name>-<mode>-noglass.png`, the name led by its step,
 * `s9a-menu`. */
async function shots({ dir, page }: Window, name: string) {
  const html = page.locator("html")
  wallpaper(dir)
  for (const glass of [true, false])
    for (const mode of ["dark", "light"] as const) {
      const desk = glass ? GLASS : "[desk]\nglass = false\n"
      writeFileSync(
        join(dir, "config/look.toml"),
        `mode = "${mode}"\n${desk}${STILL}`
      )
      if (glass) await expect(html).toHaveAttribute("data-glass", "")
      else await expect(html).not.toHaveAttribute("data-glass")
      if (mode === "dark") await expect(html).toHaveClass(/dark/)
      else await expect(html).not.toHaveClass(/dark/)
      await page.screenshot({
        path: `test-results/sidebar-${name}-${mode}${glass ? "" : "-noglass"}.png`,
        animations: "disabled",
      })
    }
}

/** A window with a Thread of Work started, and a draft of lab after it,
 * on Fake AI and Other AI. */
async function withTwoProjects() {
  window = await startWindow({ other: true, look: `mode = "dark"\n${STILL}` })
  await wide(window)
  const { page } = window
  const { composer } = await firstThread(page)
  await composer.fill("hello")
  await composer.press("Enter")
  await expect(page.getByText("You said: hello")).toBeVisible()
  await newProject(page, "lab")
  const sidebar = page.getByRole("complementary", { name: "Sidebar" })
  return {
    window,
    page,
    sidebar,
    pen: sidebar.getByRole("button", { name: "New Thread", exact: true }),
    hello: sidebar.getByRole("option", { name: /hello/ }),
    menu: page.getByRole("menu", { name: "New Thread" }),
    drafts: page.getByRole("region", { name: "New Thread" }),
    focused: page
      .getByRole("region", { name: "New Thread" })
      .and(page.locator('[data-focused="true"]')),
  }
}

test("✎'s menu ticks what a click takes, and starts one elsewhere at once: in Work, with Other AI", async () => {
  const { window, page, pen, hello, menu, drafts, focused } =
    await withTwoProjects()
  await hello.click()
  const before = await drafts.count()

  // A right click opens it, and starts nothing.
  await pen.click({ button: "right" })
  await expect(menu).toBeVisible()
  await expect(drafts).toHaveCount(before)
  await expect(pen).toHaveAttribute("aria-expanded", "true")
  // New Thread first, with its key in force.
  await expect(menu.getByRole("menuitem").first()).toHaveText(
    /^New Thread\s*Alt\+Return$/
  )
  // in: the Projects, then No Project; Work, where a click starts, ticked.
  const inside = menu.getByRole("group", { name: "in" })
  await expect(inside.getByRole("menuitem", { name: "Work" })).toHaveAttribute(
    "aria-current",
    "true"
  )
  await expect(
    inside.getByRole("menuitem", { name: "lab" })
  ).not.toHaveAttribute("aria-current")
  await expect(inside.getByRole("menuitem").last()).toHaveAccessibleName(
    "No Project"
  )
  // One machine: none named, so no "on".
  await expect(menu.getByRole("group", { name: "on" })).toHaveCount(0)
  // with: the Harnesses on, by their emblems and names, the first ticked.
  const harnesses = menu.getByRole("group", { name: "with" })
  await expect(harnesses.getByRole("menuitem")).toHaveCount(2)
  await expect(harnesses.getByRole("menuitem").first()).toHaveAccessibleName(
    "Fake AI"
  )
  await expect(
    harnesses.getByRole("menuitem", { name: "Fake AI" })
  ).toHaveAttribute("aria-current", "true")
  await expect(
    harnesses.getByRole("menuitem", { name: "Other AI" })
  ).not.toHaveAttribute("aria-current")
  await expect(
    menu.getByRole("menuitem", { name: "Add Project…" })
  ).toBeVisible()
  await expect(menu.getByRole("menuitem", { name: "Projects…" })).toBeVisible()
  await shots(window, "s9a-menu")

  // A pick starts one at once: in Work, the click's, with Other AI.
  await harnesses.getByRole("menuitem", { name: "Other AI" }).click()
  await expect(menu).toBeHidden()
  await expect(
    focused.getByRole("button", { name: "Project: Work" })
  ).toBeVisible()
  await expect(
    focused.getByRole("textbox", { name: "Message to Other AI" })
  ).toBeVisible()

  // In lab, on the default Harness.
  await pen.click({ button: "right" })
  await menu
    .getByRole("group", { name: "in" })
    .getByRole("menuitem", { name: "lab" })
    .click()
  await expect(
    focused.getByRole("button", { name: "Project: lab" })
  ).toBeVisible()
  await expect(
    focused.getByRole("textbox", { name: "Message to Fake AI" })
  ).toBeVisible()

  // Projects…: the settings, at the Projects.
  await pen.click({ button: "right" })
  await menu.getByRole("menuitem", { name: "Projects…" }).click()
  await expect(
    page.getByRole("region", { name: "Settings", exact: true })
  ).toBeVisible()

  // Add Project…: the Banda menu, at Add Project.
  await pen.click({ button: "right" })
  await menu.getByRole("menuitem", { name: "Add Project…" }).click()
  const banda = page.getByRole("dialog", { name: "Banda menu" })
  await expect(banda.getByRole("option", { name: /New Project/ })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(banda).toBeHidden()
})

test("✎'s menu opens by the keys, a right click and a press held, and starts nothing; Esc gives ✎ the focus back; a click starts a Thread at once where Alt+Enter does", async () => {
  const { window, page, pen, hello, menu, drafts, focused } =
    await withTwoProjects()
  await expect(
    focused.getByRole("button", { name: "Project: lab" })
  ).toBeVisible()
  await hello.click()
  const before = await drafts.count()
  const shut = async () => {
    await page.keyboard.press("Escape")
    await expect(menu).toBeHidden()
    await expect(pen).toBeFocused()
    await expect(page.locator("body")).not.toBeFocused()
  }

  // ↓, then Shift+F10, on ✎ in focus.
  await pen.focus()
  await page.keyboard.press("ArrowDown")
  await expect(menu).toBeVisible()
  await shut()
  await page.keyboard.press("Shift+F10")
  await expect(menu).toBeVisible()
  await shut()

  // A press on ✎ while its menu is open shuts it, and starts nothing.
  await pen.click({ button: "right" })
  await expect(menu).toBeVisible()
  await pen.click()
  await expect(menu).toBeHidden()
  await expect(drafts).toHaveCount(before)

  // A press held half a second opens it; let go, it stays, and nothing
  // started.
  const box = (await pen.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await expect(menu).toBeVisible()
  await page.mouse.up()
  await expect(menu).toBeVisible()
  await expect(drafts).toHaveCount(before)
  await shut()

  // Shut after a right click, which has no click of its own, Enter on ✎
  // starts one at once all the same. The count shows no press above
  // started one either.
  await pen.click({ button: "right" })
  await expect(menu).toBeVisible()
  await shut()
  await page.keyboard.press("Enter")
  await expect(drafts).toHaveCount(before + 1)
  // Closed again, so the picture below has Work's Thread and one draft.
  await focused.getByRole("button", { name: "Close New Thread" }).click()
  await expect(drafts).toHaveCount(before)

  // Back in Work's Thread, a short press is a click: it starts the next
  // one there, with no question and no menu.
  await hello.click()
  await expect(pen).toHaveAttribute("title", "New Thread (Alt+Return)")
  await pen.click()
  await expect(menu).toBeHidden()
  await expect(drafts).toHaveCount(before + 1)
  await expect(
    focused.getByRole("button", { name: "Project: Work" })
  ).toBeVisible()
  await expect(
    focused.getByRole("textbox", { name: "Message to Fake AI" })
  ).toBeVisible()
  // The pointer off the sidebar, for the picture of its header at rest.
  await page.mouse.move(900, 450)
  await shots(window, "s9a-header")
})

test("the Flow on the bar, and its menu: the one in force checked, its key beside the two it goes between", async () => {
  // Where it stands, its words, a pick and Alt+Shift+M are roma-day's
  // Flow test; this one takes the pictures.
  const { window, page } = await withTwoProjects()
  const flow = page.getByRole("banner").getByRole("button", { name: /^Flow: / })
  await expect(flow).toHaveAccessibleName("Flow: Row")
  // The pointer off the bar, for the picture of it at rest.
  await page.mouse.move(900, 450)
  await shots(window, "s9b-bar")

  await flow.click()
  const items = page
    .getByRole("menu", { name: "Flow" })
    .getByRole("menuitemradio")
  await expect(items).toHaveCount(3)
  await expect(items.nth(1)).toHaveAttribute("aria-checked", "true")
  const shortcut = '[data-slot="dropdown-menu-shortcut"]'
  await expect(items.nth(0).locator(shortcut)).toHaveCount(0)
  await expect(items.nth(1).locator(shortcut)).toHaveText("Alt+Shift+M")
  await expect(items.nth(2).locator(shortcut)).toHaveText("Alt+Shift+M")
  // In the row it offers Arrange by Project too (ADR 0102, decision 9).
  await expect(
    page.getByRole("menuitem", { name: "Arrange by Project" })
  ).toBeVisible()
  await shots(window, "s9b-menu")
})

test("the foot keeps the gear and the view; the bar's logo opens the Banda menu, whose root holds the sidebar's toggle, the key sheet and the theme, and the theme writes look.toml", async () => {
  const { window, page, sidebar } = await withTwoProjects()
  const html = page.locator("html")
  const file = join(window.dir, "config/look.toml")

  // The foot: the gear and the view, no words; the gear's tooltip names
  // its key in force. The key sheet, the theme and Add Project left it.
  await expect(
    sidebar.getByRole("button", { name: "Settings" })
  ).toHaveAttribute("title", "Settings (Alt+,)")
  await expect(
    sidebar.getByRole("button", { name: "View", exact: true })
  ).toBeVisible()
  for (const gone of ["Every action and its key", /^Theme/, "Add Project"])
    await expect(sidebar.getByRole("button", { name: gone })).toHaveCount(0)
  // The pointer off the sidebar, for the picture of its foot at rest.
  await page.mouse.move(900, 450)
  await shots(window, "s9c-foot")

  // The bar's logo opens the Banda menu, not the sidebar's toggle (§5
  // E2); its tooltip names the menu's key in force.
  const logo = page
    .getByRole("banner")
    .getByRole("button", { name: /^Banda(:|$)/ })
  await expect(logo).toHaveAttribute("title", /^Banda menu \(Alt\+Space\)/)
  await logo.click()
  const banda = page.getByRole("dialog", { name: "Banda menu" })
  const actions = banda.getByRole("group", { name: "Actions" })
  await expect(
    actions.getByRole("option", { name: /^Show or hide the sidebar/ })
  ).toBeVisible()
  await expect(
    actions.getByRole("option", { name: /^Every action and its key/ })
  ).toBeVisible()
  await expect(actions.getByRole("option", { name: /^Theme/ })).toBeVisible()
  // The click left the sidebar shown. The menu is modal, so the page
  // behind it is hidden from the accessibility tree: the sidebar is
  // found by its element, not its role.
  await expect(page.locator('aside[aria-label="Sidebar"]')).toBeVisible()
  await shots(window, "s9c-menu")

  // The key sheet's row opens the menu at its Actions, as Alt+K does.
  await actions
    .getByRole("option", { name: /^Every action and its key/ })
    .click()
  await expect(banda.getByRole("group", { name: "Banda" })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(banda).toBeHidden()

  // The toggle's row hides the sidebar, and Alt+A shows it again.
  await logo.click()
  await actions
    .getByRole("option", { name: /^Show or hide the sidebar/ })
    .click()
  await expect(banda).toBeHidden()
  await expect(sidebar).toBeHidden()
  await page.keyboard.press("Alt+A")
  await expect(sidebar).toBeVisible()

  // The theme: Light, Dark and As the system, the one in force ticked by
  // look.toml, then Themes…; Dark writes look.toml, and the window darkens.
  await expect(html).not.toHaveClass(/dark/)
  await logo.click()
  await actions.getByRole("option", { name: /^Theme/ }).click()
  await expect(banda.getByRole("option")).toHaveText([
    /^Light/,
    /^Dark/,
    /^As the system/,
    /^Themes…\s*Banda/,
  ])
  await shots(window, "s9c-theme")
  await banda.getByRole("option", { name: /^Dark/ }).click()
  await expect(banda).toBeHidden()
  await expect(html).toHaveClass(/dark/)
  await expect
    .poll(() => readFileSync(file, "utf8"))
    .toMatch(/^mode = "dark"$/m)

  // Themes…: this device's first, the default, which a look.toml with no
  // theme takes; then Banda's own pairs, by the names the menu gives them
  // (ADR 0100, decision 2). A pick writes look.toml's theme.
  const themes = async () => {
    await logo.click()
    await actions.getByRole("option", { name: /^Theme/ }).click()
    await banda.getByRole("option", { name: /^Themes…/ }).click()
  }
  await themes()
  const options = banda.getByRole("option")
  await expect(options.nth(0)).toHaveText(
    /^This device's\s*the default, Banda here/
  )
  await expect(options.nth(1)).toHaveText(/^Banda\s*light and dark/)
  await expect(options.nth(2)).toHaveText(/^Banda macOS/)
  await shots(window, "s9c-themes")
  await banda.getByRole("option", { name: /^Banda macOS/ }).click()
  await expect(banda).toBeHidden()
  await expect
    .poll(() => readFileSync(file, "utf8"))
    .toMatch(/^theme = "macos"$/m)

  // And back to this device's.
  await themes()
  await banda.getByRole("option", { name: /^This device's/ }).click()
  await expect(banda).toBeHidden()
  await expect
    .poll(() => readFileSync(file, "utf8"))
    .toMatch(/^theme = "platform"$/m)
})

// ADR 0098, decision 21; ADR 0099, decision 7 (S9d): Quiet. The foot's
// bell turns it on for 30 minutes: a Thread that finishes out of sight
// makes no sound and no toast, nor, the window behind, a notice on the
// desktop, and still lands in Your turn. The foot's bell and the logo's
// small one are crossed. Turned off, nothing is played back.
test("with Quiet on for 30 minutes, a finished Thread makes no sound, no toast and no notice, and still lands in Your turn; both bells are crossed", async () => {
  window = await startWindow({ look: `mode = "dark"\n${STILL}` })
  await wide(window)
  const { app, page } = window
  const html = page.locator("html")
  const sidebar = page.getByRole("complementary", { name: "Sidebar" })
  const logo = page
    .getByRole("banner")
    .getByRole("button", { name: /^Banda(:|$)/ })
  const { composer } = await firstThread(page)
  const notes = await countNotes(page)

  // The bell, uncrossed, its tooltip with its key in force.
  const bell = sidebar.getByRole("button", { name: /^Quiet/ })
  await expect(bell).toHaveAccessibleName("Quiet")
  await expect(bell).toHaveAttribute("title", "Quiet · Alt+Q")
  await expect(bell.locator("svg").first()).toHaveCSS("opacity", "1")
  await expect(bell.locator("svg").last()).toHaveCSS("opacity", "0")
  await expect(logo.locator("[data-quiet]")).toHaveCount(0)

  // Its popover, in the prototype's words.
  await bell.click()
  const popover = page.getByRole("dialog", { name: "Quiet" })
  await expect(popover).toContainText(
    "No sounds, no notifications, marks do not call. The inbox still fills."
  )
  await expect(popover.getByRole("button")).toHaveText([
    "30 minutes",
    "1 hour",
    /^Until (tomorrow )?9:00$/,
    "Until I turn it off",
  ])
  await shots(window, "s9d-popover")

  // On for 30 minutes: both bells crossed, the page says so.
  const picked = Date.now()
  await popover.getByRole("button", { name: "30 minutes" }).click()
  await expect(popover).toBeHidden()
  await expect(bell).toHaveAttribute("data-quiet", "")
  await expect(bell).toHaveAccessibleName(/^Quiet until \d{1,2}:\d\d$/)
  await expect(bell).toHaveAttribute(
    "title",
    /^Quiet until \d{1,2}:\d\d · Alt\+Q$/
  )
  await expect(bell.locator("svg").first()).toHaveCSS("opacity", "0")
  await expect(bell.locator("svg").last()).toHaveCSS("opacity", "1")
  await expect(html).toHaveAttribute("data-quiet", "")
  await expect(logo).toHaveAccessibleName(/^Banda: (.+, )?Quiet on$/)
  await expect(logo.locator("svg[data-quiet]")).toBeVisible()
  const until = Number(
    await page.evaluate(() => localStorage.getItem("banda.quiet"))
  )
  expect(until - picked).toBeGreaterThan(29 * 60_000)
  expect(until - picked).toBeLessThan(31 * 60_000)

  // A Thread that ends while the Person is in another: no sound, no
  // toast, and it lands in Your turn all the same. The pointer leaves the
  // sidebar, which holds its list still under it.
  await page.mouse.move(900, 450)
  await sendAndLeave(page, composer, "slow hello")
  const card = sidebar.getByRole("option", { name: /slow hello/ })
  await expect(card.getByRole("img", { name: "Done" })).toBeVisible()
  await expect(placeOf(sidebar, "Threads")).toHaveText([
    /^Your turn/,
    /slow hello/,
  ])
  await page.waitForTimeout(500)
  expect(await notes()).toBe(0)
  const toasts = page
    .getByRole("region", { name: "Notifications" })
    .getByRole("listitem")
  await expect(toasts).toHaveCount(0)

  // One that ends with the window behind: no notice on the desktop.
  const draft = page.getByRole("region", { name: "New Thread" })
  const again = draft.getByRole("textbox", { name: /^Message to/ })
  await again.fill("slow again")
  await again.press("Enter")
  await expect(draft).toBeHidden()
  await setInFront(page, false)
  await expect(
    sidebar
      .getByRole("option", { name: /slow again/ })
      .getByRole("img", { name: "Done" })
  ).toBeVisible()
  await page.waitForTimeout(500)
  expect((await desktopOf(app)).shown).toEqual([])
  expect(await notes()).toBe(0)
  await setInFront(page, true)

  // The foot and the logo while Quiet, the pointer off the sidebar.
  await page.mouse.move(900, 450)
  await shots(window, "s9d-quiet")

  // Turned off, both bells are whole again, and nothing is played back.
  await bell.click()
  await popover.getByRole("button", { name: "Turn off" }).click()
  await expect(bell).toHaveAccessibleName("Quiet")
  await expect(bell).not.toHaveAttribute("data-quiet")
  await expect(html).not.toHaveAttribute("data-quiet")
  await expect(logo.locator("[data-quiet]")).toHaveCount(0)
  await expect(logo).not.toHaveAccessibleName(/Quiet/)
  await page.waitForTimeout(500)
  expect(await notes()).toBe(0)
  await expect(toasts).toHaveCount(0)
  expect((await desktopOf(app)).shown).toEqual([])
  expect(
    await page.evaluate(() => localStorage.getItem("banda.quiet"))
  ).toBeNull()

  // Alt+Q turns it on until turned off, and off.
  await page.keyboard.press("Alt+KeyQ")
  await expect(bell).toHaveAccessibleName("Quiet on")
  await expect(logo.locator("svg[data-quiet]")).toBeVisible()
  await page.keyboard.press("Alt+KeyQ")
  await expect(bell).toHaveAccessibleName("Quiet")
})
