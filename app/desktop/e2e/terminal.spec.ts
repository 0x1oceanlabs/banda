import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { expect, test } from "@playwright/test"
import {
  newTerminal,
  read as readFile,
  startWindow,
  type Window,
} from "./window"

let window: Window

test.afterEach(async () => {
  await window?.close()
})

test("a terminal's right click copies, pastes, selects all, clears and acts on a link", async () => {
  window = await startWindow()
  const { app, page, dir } = window
  const space = join(dir, "root", "Work")
  const read = (name: string) => readFile(join(space, name))
  const clipboard = () => app.evaluate(({ clipboard }) => clipboard.readText())
  const screen = await newTerminal(page)
  writeFileSync(join(space, "notes.txt"), "Notes\n")
  await screen.click()
  // The path on the first row, then the prompt.
  await page.keyboard.type("clear; printf './notes.txt\\n'; : > printed")
  await page.keyboard.press("Enter")
  await expect.poll(() => read("printed")).toBe("")
  const canvas = screen.locator("canvas").first()
  const box = (await canvas.boundingBox())!
  const menu = page.getByRole("menu", { name: "Terminal" })
  const item = (name: string) => menu.getByRole("menuitem", { name })
  // Its name ends with its key.
  const copy = menu.getByRole("menuitem", { name: /^Copy\s*(Ctrl|⌘)/ })

  // On the path: what a link does, and copy, which waits for a selection.
  await canvas.click({ button: "right", position: { x: 24, y: 8 } })
  await expect(item("Open in Banda")).toBeVisible()
  await expect(item("Open in its app")).toBeVisible()
  await expect(copy).toBeDisabled()
  await page.screenshot({ path: "test-results/terminal-menu.png" })
  await item("Copy path").click()
  await expect(menu).toBeHidden()
  await expect.poll(clipboard).toBe(join(space, "notes.txt"))

  // Away from it: no link; Select all then Copy takes the screen's text.
  const below = { x: box.width / 2, y: box.height - 20 }
  await canvas.click({ button: "right", position: below })
  await expect(item("Copy path")).toHaveCount(0)
  await item("Select all").click()
  await canvas.click({ button: "right", position: below })
  await copy.click()
  await expect.poll(clipboard).toContain("./notes.txt")

  // Paste types the clipboard to the program, and Clear types Ctrl+L, as
  // it hears them; the focus is back on the screen.
  await page.keyboard.type("cat > typed.txt")
  await page.keyboard.press("Enter")
  await app.evaluate(({ clipboard }) => clipboard.writeText("pasted\n"))
  await canvas.click({ button: "right", position: below })
  await menu.getByRole("menuitem", { name: /^Paste/ }).click()
  await expect.poll(() => read("typed.txt")).toBe("pasted\n")
  await canvas.click({ button: "right", position: below })
  await menu.getByRole("menuitem", { name: /^Clear/ }).click()
  await page.keyboard.press("Enter")
  await expect.poll(() => read("typed.txt")).toBe("pasted\n\f\n")
  await page.keyboard.press("Control+d")

  // A program that takes the mouse hears the right click; with Shift the
  // menu opens all the same.
  await page.keyboard.type("printf '\\033[?1000h'; : > tracking")
  await page.keyboard.press("Enter")
  await expect.poll(() => read("tracking")).toBe("")
  await canvas.click({ button: "right", position: below })
  await expect(menu).toBeHidden()
  await canvas.click({ button: "right", position: below, modifiers: ["Shift"] })
  await expect(menu).toBeVisible()
  // Escape gives the screen its focus back.
  await page.keyboard.press("Escape")
  await expect(menu).toBeHidden()
  await expect(
    page.getByRole("textbox", { name: "Terminal input" })
  ).toBeFocused()
})
