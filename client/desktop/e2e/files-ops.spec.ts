import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { expect, type Locator, type Page, test } from "@playwright/test"
import { firstThread, startWindow, textOf, type Window } from "./window"

let window: Window

test.afterEach(async () => {
  await window?.close()
})

/** Writes `text` at `path` under `folder`, its folders first. */
function put(folder: string, path: string, text = "") {
  mkdirSync(join(folder, path, ".."), { recursive: true })
  writeFileSync(join(folder, path), text)
}

/** Files on the Project's folder, once the window has the keys: its
 * tree, a row by its name, and the field a row is renamed in. */
async function openFiles(page: Page, composer: Locator) {
  await expect(composer).toBeFocused()
  await page.keyboard.press("Alt+e")
  const pane = page
    .locator("section")
    .filter({ has: page.getByRole("navigation", { name: "Places" }) })
  const tree = pane.getByRole("tree")
  const row = (name: string) =>
    tree.getByRole("treeitem", { name, exact: true })
  const renaming = pane.locator("[data-item-rename-input]")
  await expect(row("docs")).toBeVisible()
  return { pane, tree, row, renaming }
}

/** The part of the field a rename picked. */
const pickedIn = (field: Locator) =>
  field.evaluate((input: HTMLInputElement) =>
    input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0)
  )

/** Drops Banda's files back on `box`, as main's drag brings them: by their
 * names, through the tree's shadow, with Alt for a copy. */
async function dropOn(box: Locator, files: string[], alt = false) {
  await box.evaluate(
    (element, { files, alt }) => {
      const data = new DataTransfer()
      for (const name of files) data.items.add(new File(["x"], name))
      for (const type of ["dragenter", "dragover", "drop"])
        element.dispatchEvent(
          new DragEvent(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            altKey: alt,
            dataTransfer: data,
          })
        )
    },
    { files, alt }
  )
}

/** The names the throwaway Trash holds. */
const trashed = (dir: string) => {
  const files = join(dir, "xdg-data/Trash/files")
  return existsSync(files) ? readdirSync(files).sort() : []
}

test("Files makes a file, renames in place, duplicates, pastes with a clash kept both, and moves a row dropped on a folder, each with Undo", async () => {
  window = await startWindow()
  const { app, page, dir } = window
  const { composer } = await firstThread(page)
  const project = join(dir, "root", "Work")
  put(project, "docs/a.txt", "a")
  put(project, "docs/b.txt", "b")
  put(project, "lib/a.txt", "the lib's a")
  const { row, renaming } = await openFiles(page, composer)
  await row("docs").click()
  await expect(row("a.txt").first()).toBeVisible()

  // A row's menu makes a file beside it, named in place: all of
  // "untitled" is picked, and typing names it.
  await row("b.txt").click({ button: "right" })
  const menu = page.getByRole("menu", { name: "Row" })
  await expect(menu.getByRole("menuitem")).toContainText([
    "Open",
    "Quick Look",
    "Add to chat",
    "Copy path",
    "New file",
    "New folder",
    "Rename",
    "Duplicate",
    "Copy",
    "Cut",
    "Move to Trash",
  ])
  await menu.getByRole("menuitem", { name: "New file" }).click()
  await expect(renaming).toBeFocused()
  await expect.poll(() => pickedIn(renaming)).toBe("untitled")
  await page.keyboard.type("made.md")
  await page.keyboard.press("Enter")
  await expect(row("made.md")).toBeVisible()
  expect(existsSync(join(project, "docs/made.md"))).toBe(true)
  expect(existsSync(join(project, "docs/untitled"))).toBe(false)
  await expect(page.getByText("Made “made.md”")).toBeVisible()

  // F2 renames in place, the name before its extension picked.
  await row("made.md").click()
  await page.keyboard.press("F2")
  await expect(renaming).toBeFocused()
  // Pierre picks all of it as the field takes the keys, the stem a frame
  // after.
  await expect.poll(() => pickedIn(renaming)).toBe("made")
  await page.keyboard.type("notes")
  await page.keyboard.press("Enter")
  await expect(row("notes.md")).toBeVisible()
  expect(existsSync(join(project, "docs/notes.md"))).toBe(true)
  await expect(page.getByText("Renamed “made.md” to “notes.md”")).toBeVisible()
  // Ctrl+Z names it back.
  await row("notes.md").click()
  await page.keyboard.press("Control+z")
  await expect(row("made.md")).toBeVisible()
  expect(existsSync(join(project, "docs/notes.md"))).toBe(false)

  // Ctrl+D duplicates beside it, the copy picked, alone.
  await row("b.txt").click()
  await page.keyboard.press("Control+d")
  await expect(row("b 2.txt")).toHaveAttribute("aria-selected", "true")
  await expect(row("b.txt")).toHaveAttribute("aria-selected", "false")
  expect(textOf(join(project, "docs/b 2.txt"))).toBe("b")
  await expect(page.getByText("Duplicated “b.txt” as “b 2.txt”")).toBeVisible()

  // Copied and pasted where its name is taken, it asks: kept both.
  await row("a.txt").first().click()
  await page.keyboard.press("Control+c")
  await row("lib").click()
  await expect(row("a.txt")).toHaveCount(2)
  await page.keyboard.press("Control+v")
  const clash = page.getByRole("dialog", { name: "“a.txt” is there" })
  await expect(clash).toContainText(
    "An item named “a.txt” is already in “lib”."
  )
  await page.screenshot({ path: "test-results/files-clash.png" })
  await clash.getByRole("button", { name: "Keep both" }).click()
  await expect(clash).toBeHidden()
  await expect.poll(() => textOf(join(project, "lib/a 2.txt"))).toBe("a")
  expect(textOf(join(project, "lib/a.txt"))).toBe("the lib's a")

  // A row dragged onto a folder moves there: main drags it out, and it
  // drops back on the folder.
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeAllListeners("files.drag")
    ipcMain.on("files.drag", () => {})
  })
  await row("b.txt").dragTo(row("lib"))
  await dropOn(row("lib"), ["b.txt"])
  await expect.poll(() => textOf(join(project, "lib/b.txt"))).toBe("b")
  expect(existsSync(join(project, "docs/b.txt"))).toBe(false)
  await expect(page.getByText("Moved “b.txt” to “lib”")).toBeVisible()
  // Its toast's Undo moves it back.
  await page
    .locator("[data-sonner-toast]")
    .filter({ hasText: "Moved “b.txt” to “lib”" })
    .getByRole("button", { name: "Undo" })
    .click()
  await expect.poll(() => textOf(join(project, "docs/b.txt"))).toBe("b")
  expect(existsSync(join(project, "lib/b.txt"))).toBe(false)
})

test("a row goes to the Trash and Undo puts it back; the Trash place puts back too; three names are renamed as text through a diff", async () => {
  window = await startWindow()
  const { page, dir } = window
  const { composer } = await firstThread(page)
  const project = join(dir, "root", "Work")
  put(project, "docs/a.txt", "a")
  put(project, "docs/b.txt", "b")
  put(project, "docs/c.txt", "c")
  const { pane, row } = await openFiles(page, composer)
  await row("docs").click()

  // Ctrl+⌫ sends it to the system's Trash, a throwaway one here; the
  // toast's Undo puts it back.
  await row("a.txt").click()
  await page.keyboard.press("Control+Backspace")
  await expect(row("a.txt")).toHaveCount(0)
  expect(trashed(dir)).toEqual(["a.txt"])
  const toast = page
    .locator("[data-sonner-toast]")
    .filter({ hasText: "Moved “a.txt” to the Trash" })
  await toast.getByRole("button", { name: "Undo" }).click()
  await expect(row("a.txt")).toBeVisible()
  expect(textOf(join(project, "docs/a.txt"))).toBe("a")
  expect(trashed(dir)).toEqual([])

  // The Trash place lists it, with where it came from, and puts it back.
  await row("c.txt").click()
  await page.keyboard.press("Delete")
  await expect(row("c.txt")).toHaveCount(0)
  await pane.getByRole("button", { name: "Trash", exact: true }).click()
  const bin = pane.getByRole("listbox", { name: "Trash" })
  const item = bin.getByRole("option", { name: "c.txt" })
  await expect(item).toContainText("Work/docs")
  await page.screenshot({ path: "test-results/files-trash.png" })
  await item.click()
  await pane.getByRole("button", { name: "Put back" }).click()
  await expect(pane.getByText("The Trash is empty")).toBeVisible()
  expect(textOf(join(project, "docs/c.txt"))).toBe("c")

  // Three rows picked rename as text: their names, one a line, then the
  // diff, then the files.
  await pane.getByRole("button", { name: "Work", exact: true }).click()
  await row("docs").click()
  await row("a.txt").click()
  await row("c.txt").click({ modifiers: ["Shift"] })
  await page.keyboard.press("F2")
  const dialog = page.getByRole("dialog", { name: "Rename 3 items" })
  await expect(dialog).toContainText("a.txt")
  await expect(dialog.locator("diffs-container")).toBeFocused()
  await page.keyboard.press("Control+a")
  await page.keyboard.type("one.txt\ntwo.txt\nthree.txt")
  await dialog.getByRole("button", { name: "Review changes" }).click()
  await expect(dialog).toContainText("3 names change")
  await page.screenshot({ path: "test-results/files-bulk-rename.png" })
  await dialog.getByRole("button", { name: "Rename 3" }).click()
  await expect(dialog).toBeHidden()
  await expect.poll(() => textOf(join(project, "docs/three.txt"))).toBe("c")
  expect(textOf(join(project, "docs/one.txt"))).toBe("a")
  expect(textOf(join(project, "docs/two.txt"))).toBe("b")
  // They undo as one.
  await row("one.txt").click()
  await page.keyboard.press("Control+z")
  await expect.poll(() => textOf(join(project, "docs/a.txt"))).toBe("a")
  expect(textOf(join(project, "docs/c.txt"))).toBe("c")
})

test("Ctrl+Shift+F finds a word and opens its file at the line; Alt+P opens a file of the Project", async () => {
  window = await startWindow()
  const { page, dir } = window
  const { composer } = await firstThread(page)
  const project = join(dir, "root", "Work")
  put(project, "src/main.ts", "export const one = 1\n// a needle here\n")
  put(project, "src/util.ts", "export const two = 2\n")
  put(project, "docs/notes.md", "no NEEDLE\n")
  const { pane, row } = await openFiles(page, composer)

  await row("src").click()
  await page.keyboard.press("Control+Shift+f")
  const field = pane.getByRole("textbox", { name: "Search in files" })
  await expect(field).toBeFocused()
  await field.fill("needle")
  const found = pane.getByRole("tree", { name: "Found" })
  await expect(
    found.getByRole("treeitem", { name: "src/main.ts:2" })
  ).toContainText("a needle here")
  await expect(
    found.getByRole("treeitem", { name: "docs/notes.md:1" })
  ).toBeVisible()
  // The case counts once asked.
  await pane.getByRole("button", { name: "Match case" }).click()
  await expect(
    found.getByRole("treeitem", { name: "docs/notes.md:1" })
  ).toHaveCount(0)
  await page.screenshot({ path: "test-results/files-search.png" })
  await found.getByRole("treeitem", { name: "src/main.ts:2" }).dblclick()
  const file = page.getByRole("region", { name: "main.ts", exact: true })
  await expect(file.locator('[data-lit-line="2"]')).toHaveCount(1)

  // Quick open: the Banda menu with the Project's files alone.
  await page.keyboard.press("Alt+p")
  const menu = page.getByRole("dialog", { name: "Banda menu" })
  await expect(menu.getByText("Files", { exact: true })).toBeVisible()
  const search = menu.getByRole("combobox", { name: "Search" })
  await expect(search).toBeFocused()
  // Before a word, the file opened lately comes first; those found stay
  // as a word is typed, only those that fit it, until the engine answers.
  await expect(menu.getByRole("option").first()).toHaveAccessibleName(
    /^main\.ts/
  )
  await search.fill("util")
  await expect(menu.getByRole("option", { name: /^util\.ts/ })).toBeVisible()
  await search.press("Enter")
  await expect(
    page.getByRole("region", { name: "util.ts", exact: true })
  ).toBeVisible()
})
