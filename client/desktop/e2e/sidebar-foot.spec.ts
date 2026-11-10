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
 * on ✎ while it is open shuts it, and starts nothing. Pictures for Roma,
 * dark and light, with glass and without, at 1440×900:
 * `test-results/sidebar-s9a-*.png`.
 */
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { expect, test } from "@playwright/test"
import {
  firstThread,
  GLASS,
  newProject,
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
 * glass off: `sidebar-s9a-<name>-<mode>.png` and
 * `sidebar-s9a-<name>-<mode>-noglass.png`. */
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
        path: `test-results/sidebar-s9a-${name}-${mode}${glass ? "" : "-noglass"}.png`,
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
    hello: sidebar.getByRole("button", { name: /hello/ }),
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
  await shots(window, "menu")

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
  await shots(window, "header")
})
