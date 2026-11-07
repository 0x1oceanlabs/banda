import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { crc32, deflateSync } from "node:zlib"
import { expect, type Locator, type Page, test } from "@playwright/test"
import { firstThread, startWindow, type Window } from "./window"

let window: Window

test.afterEach(async () => {
  await window?.close()
})

/** Writes `text` at `path` under `folder`, its folders first. */
function put(folder: string, path: string, text: string | Buffer = "") {
  mkdirSync(join(folder, path, ".."), { recursive: true })
  writeFileSync(join(folder, path), text)
}

/** A PNG `width` by `height` of one colour, written here so no test
 * carries one. */
function pngOf(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8)
    head.writeUInt32BE(data.length, 0)
    head.write(type, 4, "ascii")
    const sum = Buffer.alloc(4)
    sum.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0)
    return Buffer.concat([head, data, sum])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 2, 0, 0, 0], 8)
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x9c)])
  const rows = Buffer.concat(Array.from({ length: height }, () => row))
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ])
}

/** Files beside the Thread, on the Project's folder, once the Thread has
 * the keys; and once Files has them, on the row `first`, picked. */
async function filesOn(page: Page, thread: Locator, first: string) {
  await expect(thread).toHaveAttribute("data-focused", "true")
  await page.keyboard.press("Alt+e")
  const files = page
    .locator("section")
    .filter({ has: page.getByRole("navigation", { name: "Places" }) })
  await expect(files).toHaveAttribute("data-focused", "true")
  const row = files.getByRole("tree").getByRole("treeitem", { name: first })
  await row.click()
  await expect(row).toHaveAttribute("aria-selected", "true")
  return files
}

test("Ctrl+2 shows Columns, where → goes into a folder and the last column previews a file; Ctrl+3 a Gallery with a picture's thumbnail, where → moves; Ctrl+I the info with a picture's size", async () => {
  window = await startWindow()
  const { page, dir } = window
  const { thread } = await firstThread(page)
  const project = join(dir, "root", "Work")
  put(project, "docs/guide.md", "# The guide\n\nRead me first.\n")
  put(project, "docs/wide.png", pngOf(40, 30))
  put(project, "src/a.ts", "export const a = 1\n")
  const files = await filesOn(page, thread, "docs")

  // Ctrl+2: Columns, the folder picked opening the next, with the keys.
  await page.keyboard.press("Control+Digit2")
  await expect(files.getByRole("radio", { name: "Columns" })).toHaveAttribute(
    "aria-checked",
    "true"
  )
  const columns = files.getByRole("group", { name: "Files of Work" })
  await expect(columns).toBeFocused()
  await expect(
    columns
      .getByRole("listbox", { name: "Work" })
      .getByRole("option", { name: "docs" })
  ).toHaveAttribute("aria-selected", "true")
  const docs = columns.getByRole("listbox", { name: "docs" })
  await expect(docs.getByRole("option")).toHaveCount(2)

  // → goes into it, and its last column draws the file in quick mode.
  await page.keyboard.press("ArrowRight")
  await expect(docs.getByRole("option", { name: "guide.md" })).toHaveAttribute(
    "aria-selected",
    "true"
  )
  const preview = columns.getByLabel("Preview")
  await expect(
    preview.getByRole("heading", { name: "The guide" })
  ).toBeVisible()
  // ← back to its folder, and ↓ in the column.
  await page.keyboard.press("ArrowLeft")
  await expect(preview).toBeHidden()
  await page.keyboard.press("ArrowDown")
  await expect(columns.getByRole("listbox", { name: "src" })).toBeVisible()
  await page.keyboard.press("ArrowUp")
  await page.keyboard.press("ArrowRight")
  await page.keyboard.press("ArrowDown")
  await expect(docs.getByRole("option", { name: "wide.png" })).toHaveAttribute(
    "aria-selected",
    "true"
  )
  await page.screenshot({ path: "test-results/files-columns.png" })

  // Ctrl+3: the Gallery of the pick's folder, a picture's own small one
  // in its strip, from the engine.
  await page.keyboard.press("Control+Digit3")
  const strip = files.getByRole("listbox", { name: "Files of Work" })
  await expect(strip).toBeFocused()
  const wide = strip.getByRole("option", { name: "wide.png" })
  await expect(wide).toHaveAttribute("aria-selected", "true")
  await expect(wide.locator("img")).toHaveAttribute(
    "src",
    /^data:image\/png;base64,/
  )
  // A file that is no picture has its icon.
  const guide = strip.getByRole("option", { name: "guide.md" })
  await expect(guide.locator("[data-slot=file-icon]")).toBeVisible()
  await expect(guide.locator("img")).toHaveCount(0)

  // ← moves along the strip, and the big preview follows.
  await page.keyboard.press("ArrowLeft")
  await expect(guide).toHaveAttribute("aria-selected", "true")
  await expect(files.getByRole("heading", { name: "The guide" })).toBeVisible()
  await page.keyboard.press("ArrowRight")
  await expect(wide).toHaveAttribute("aria-selected", "true")

  // Ctrl+I: the info of the row picked, beside, with a picture's size.
  await page.keyboard.press("Control+KeyI")
  const info = files.getByRole("region", { name: "Info" })
  await expect(info).toContainText("Dimensions")
  await expect(info).toContainText("40 × 30 px")
  await expect(info).toContainText("image/png")
  await page.screenshot({ path: "test-results/files-gallery.png" })

  // The view and the info are the Pane's: Ctrl+1 is the tree again, the
  // pick and the info as they were, and the keys the tree's.
  await page.keyboard.press("Control+Digit1")
  await expect(
    files.getByRole("tree").getByRole("treeitem", { name: "wide.png" })
  ).toHaveAttribute("aria-selected", "true")
  await expect(info).toContainText("40 × 30 px")
  await expect
    .poll(() => files.evaluate((pane) => pane.contains(document.activeElement)))
    .toBe(true)
  await page.keyboard.press("Control+KeyI")
  await expect(info).toBeHidden()
})

test("the key sheet lists Files' keys, each an action of its scope", async () => {
  window = await startWindow()
  const { page } = window
  const { composer } = await firstThread(page)
  await expect(composer).toBeFocused()
  const menu = page.getByRole("dialog", { name: "Banda menu" })
  await page.keyboard.press("Alt+KeyK")
  const group = menu.getByRole("group", { name: "Files" })
  await expect(group).toBeVisible()
  await expect(
    group.getByRole("option", { name: /^Rename the files picked/ })
  ).toContainText("F2")
  await expect(
    group.getByRole("option", { name: /^Quick Look/ })
  ).toContainText("Space")
  const search = menu.getByRole("combobox", { name: "Search" })
  await search.fill("folder as columns")
  await expect(
    menu.getByRole("option", { name: /^Show the folder as columns/ })
  ).toContainText("2")
  await search.fill("info of the file picked")
  await expect(
    menu.getByRole("option", { name: /^Show the info of the file picked/ })
  ).toContainText("I")
})
