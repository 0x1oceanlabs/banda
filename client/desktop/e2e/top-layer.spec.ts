/**
 * The Top layer is one stack (ADR 0110, step 3): Esc takes away the part
 * on top, one for each Esc, and the keys go back where they were as a
 * part goes, to the field of the Pane the Person wrote in.
 */
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { expect, type Locator, type Page, test } from "@playwright/test"
import { firstThread, sidebarOf, startWindow, type Window } from "./window"

let window: Window

test.afterEach(async () => {
  await window?.close()
})

const settingsIn = (page: Page): Locator =>
  page.getByRole("region", { name: "Settings", exact: true })

const menuIn = (page: Page): Locator =>
  page.getByRole("dialog", { name: "Banda menu" })

/** Opens the settings from the Banda menu, as its row does. */
async function settingsFromMenu(page: Page) {
  const menu = menuIn(page)
  await page.keyboard.press("Alt+KeyK")
  await menu.getByRole("combobox", { name: "Search" }).fill("Open the settings")
  await menu.getByRole("option", { name: /^Open the settings/ }).click()
  await expect(settingsIn(page)).toBeFocused()
}

test("the keys go back to the message the Person wrote in, whichever part of the Top layer goes: the Sheet from its key, the gear or the Banda menu, and the menu itself", async () => {
  window = await startWindow()
  const { page } = window
  const { composer } = await firstThread(page)
  const settings = settingsIn(page)
  await composer.click()
  await page.keyboard.type("half a ")

  // Alt+, and Esc: the caret is back in the message.
  await page.keyboard.press("Alt+Comma")
  await expect(settings).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(settings).toHaveCount(0)
  await expect(composer).toBeFocused()

  // From the sidebar's gear, a button pressed on the way.
  await page
    .getByRole("complementary", { name: "Sidebar" })
    .getByRole("button", { name: "Settings" })
    .click()
  await expect(settings).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(settings).toHaveCount(0)
  await expect(composer).toBeFocused()

  // From the Banda menu, which went as the Sheet came.
  await settingsFromMenu(page)
  await page.keyboard.press("Escape")
  await expect(settings).toHaveCount(0)
  await expect(composer).toBeFocused()

  // The menu alone.
  await page.keyboard.press("Alt+KeyK")
  await expect(menuIn(page).getByRole("combobox")).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(composer).toBeFocused()
  await expect(menuIn(page)).toBeHidden()

  // What was written is where it was, and the next keys go on from it.
  await page.keyboard.type("message")
  await expect(composer).toHaveText("half a message")
})

test("Esc takes away one part for each press: the Banda menu over the Sheet over the Drawer, then the Sheet, then the Drawer, and the keys go one level down each time", async () => {
  window = await startWindow()
  const { page } = window
  const { composer } = await firstThread(page)
  await composer.fill("hello")
  await composer.press("Enter")
  const mine = page
    .getByRole("region", { name: "hello" })
    .getByRole("textbox", { name: "Message to Fake AI" })
  await expect(mine).toBeFocused()
  const drawer = page.getByRole("dialog", { name: "Drawer" })
  const settings = settingsIn(page)
  const menu = menuIn(page)
  const search = settings.getByRole("textbox", { name: "Search settings" })

  // The Drawer, the Sheet over it, and the menu over both.
  await page.keyboard.press("Alt+Backquote")
  await expect(drawer).toHaveAttribute("data-drawer")
  const ask = drawer.getByRole("textbox", { name: "Message to Fake AI" })
  await expect(ask).toBeFocused()
  await settingsFromMenu(page)
  await expect(drawer).toHaveAttribute("data-drawer")
  await expect(search).toBeVisible()
  await page.keyboard.press("/")
  await expect(search).toBeFocused()
  await page.keyboard.type("radius")
  await page.keyboard.press("Alt+KeyK")
  await expect(menu.getByRole("combobox")).toBeFocused()

  // The menu goes, and the keys are in the Sheet's search again.
  await page.keyboard.press("Escape")
  await expect(menu).toBeHidden()
  await expect(settings).toBeVisible()
  await expect(drawer).toHaveAttribute("data-drawer")
  await expect(search).toBeFocused()

  // The search keeps its own Esc, which clears it; the next takes the
  // Sheet, and the keys are in the Drawer's message.
  await page.keyboard.press("Escape")
  await expect(search).toHaveValue("")
  await expect(settings).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(settings).toHaveCount(0)
  await expect(drawer).toHaveAttribute("data-drawer")
  await expect(ask).toBeFocused()

  // The Drawer lifts, and the keys are in the workspace's message.
  await page.keyboard.press("Escape")
  await expect(drawer).not.toHaveAttribute("data-drawer")
  await expect(mine).toBeFocused()
})

test("the Sheet over Quick Look goes first, the keys go back to the file tree, and the next Esc closes Quick Look", async () => {
  window = await startWindow()
  const { page, dir } = window
  const { thread } = await firstThread(page)
  const project = join(dir, "root", "Work")
  writeFileSync(join(project, "a.txt"), "one\n")
  writeFileSync(join(project, "b.txt"), "two\n")

  // Files beside the Thread, and Quick Look on a row: the tree keeps the
  // keys.
  await expect(thread).toHaveAttribute("data-focused", "true")
  await page.keyboard.press("Alt+e")
  const files = page
    .locator("section")
    .filter({ has: page.getByRole("navigation", { name: "Places" }) })
  await expect(files).toHaveAttribute("data-focused", "true")
  const row = (name: string) =>
    files.getByRole("tree").getByRole("treeitem", { name, exact: true })
  await row("a.txt").click()
  await page.keyboard.press("Space")
  const peek = page.locator("[data-peek]")
  await expect(peek).toHaveAttribute("aria-label", "Quick Look: a.txt")

  // The Sheet lies over it, and takes the keys.
  await page.keyboard.press("Alt+Comma")
  const settings = settingsIn(page)
  await expect(settings).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(settings).toHaveCount(0)
  await expect(peek).toBeVisible()
  // The tree has its arrows again: Quick Look follows the row.
  await page.keyboard.press("ArrowDown")
  await expect(peek).toHaveAttribute("aria-label", "Quick Look: b.txt")
  // An Esc the Sidebar's list keeps, to give the keys to the Pane, is not
  // the Top layer's: Quick Look stays, and goes on the next.
  const list = sidebarOf(page).getByRole("listbox")
  await list.focus()
  await page.keyboard.press("Escape")
  await expect(list).not.toBeFocused()
  await expect(peek).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(peek).toHaveCount(0)
})
