import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { expect, type Locator, type Page, test } from "@playwright/test"
import { firstThread, startWindow, type Window } from "./window"

let window: Window

test.afterEach(async () => {
  await window?.close()
})

/** A 2×2 PNG. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP4X2FjU/GfAUIBAC+iBs0PBoz7AAAAAElFTkSuQmCC",
  "base64"
)

/** Opens the file the Banda menu finds for `words`, and its Pane. */
async function openFromMenu(page: Page, words: string, title: string) {
  const menu = page.getByRole("dialog", { name: "Banda menu" })
  const search = menu.getByRole("combobox", { name: "Search" })
  await page.keyboard.press("Alt+Space")
  await search.fill(words)
  const files = menu.getByRole("group", { name: "Files" })
  await expect(files.getByRole("option").first()).toContainText(title)
  await files.getByRole("option").first().click()
  await expect(menu).toBeHidden()
  const pane = page.getByRole("region", {
    name: title.replace(/:\d+$/, ""),
    exact: true,
  })
  await expect(pane).toBeVisible()
  return pane
}

/** Whether `pane` lit line `line` last, and shows it. */
async function litAt(pane: Locator, line: number) {
  await expect(pane.locator("[data-lit-line]")).toHaveAttribute(
    "data-lit-line",
    String(line)
  )
  await expect(pane.locator(`[data-line="${line}"]`).first()).toBeInViewport()
}

test("a file opens in Files: code at a line, markdown and its source, an image through the file host, and a reply's path", async () => {
  window = await startWindow()
  const { app, page, dir } = window
  const { composer } = await firstThread(page)
  const project = join(dir, "root", "Work")
  mkdirSync(join(project, "src"))
  mkdirSync(join(project, "docs"))
  const code = Array.from(
    { length: 300 },
    (_, n) => `export const line${n + 1} = ${n + 1}`
  )
  writeFileSync(join(project, "src", "long.ts"), `${code.join("\n")}\n`)
  writeFileSync(
    join(project, "docs", "guide.md"),
    "# The guide\n\nSome **words**, and a dot:\n\n![a dot](dot.png)\n"
  )
  writeFileSync(join(project, "docs", "dot.png"), PNG)

  // The Banda menu's Files finds it, and opens it at the line typed.
  let pane = await openFromMenu(page, "long.ts:120", "long.ts:120")
  await expect(pane.locator("header")).toContainText("src")
  await litAt(pane, 120)
  await page.screenshot({ path: "test-results/files-code.png" })

  // Lines picked in the gutter copy as a path and its lines.
  await pane.locator('[data-column-number="118"]').click()
  await pane
    .locator('[data-column-number="121"]')
    .click({ modifiers: ["Shift"] })
  const picked = pane.getByRole("status", { name: "Picked lines" })
  await expect(picked).toContainText("src/long.ts:118-121")
  await picked.getByRole("button", { name: "Copy src/long.ts:118-121" }).click()
  await expect
    .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
    .toBe("src/long.ts:118-121")
  await picked.getByRole("button", { name: "Unpick the lines" }).click()
  await expect(picked).toBeHidden()

  // Markdown is rendered, its source a toggle away; its picture comes
  // from the file host.
  pane = await openFromMenu(page, "guide.md", "guide.md")
  await expect(pane.getByRole("heading", { name: "The guide" })).toBeVisible()
  const dot = pane.getByRole("img", { name: "a dot" })
  await expect(dot).toHaveAttribute("src", /^app:\/\/files\//)
  await expect
    .poll(() => dot.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBe(2)
  await page.screenshot({ path: "test-results/files-markdown.png" })
  const source = pane.getByRole("button", { name: "Source" })
  await source.click()
  await expect(source).toHaveAttribute("aria-pressed", "true")
  await expect(pane.locator('[data-line="1"]').first()).toContainText(
    "# The guide"
  )
  await expect(pane.getByRole("heading", { name: "The guide" })).toHaveCount(0)
  await source.click()
  await expect(pane.getByRole("heading", { name: "The guide" })).toBeVisible()

  // An image, from the file host, to zoom.
  pane = await openFromMenu(page, "dot.png", "dot.png")
  const image = pane.getByRole("img", { name: "dot.png" })
  await expect(image).toHaveAttribute("src", /^app:\/\/files\//)
  await expect
    .poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBe(2)
  const zoom = pane.getByLabel("Zoom", { exact: true })
  await expect(zoom).toHaveText("100%")
  await pane.getByRole("button", { name: "Zoom in" }).click()
  await expect(zoom).toHaveText("125%")
  await image.dblclick()
  await expect(zoom).toHaveText("100%")
  await page.screenshot({ path: "test-results/files-image.png" })

  // A path in a reply opens in Files, at its line.
  await composer.fill("See `src/long.ts:42`.")
  await composer.press("Enter")
  const chip = page.locator("[data-quotable] a[data-file][data-kind=code]")
  await expect(chip).toHaveText("src/long.ts:42")
  await chip.click()
  pane = page.getByRole("region", { name: "long.ts", exact: true })
  await expect(pane).toBeVisible()
  await litAt(pane, 42)
})

test("a file reads again as it changes on disk, and says when it is gone", async () => {
  window = await startWindow()
  const { page, dir } = window
  await firstThread(page)
  const project = join(dir, "root", "Work")
  const notes = join(project, "notes.txt")
  writeFileSync(notes, "first\n")
  const pane = await openFromMenu(page, "notes.txt", "notes.txt")
  await expect(pane.locator('[data-line="1"]').first()).toContainText("first")
  writeFileSync(notes, "first\nsecond\n")
  await expect(pane.locator('[data-line="2"]').first()).toContainText("second")
  // Binary now: its facts.
  writeFileSync(notes, Buffer.from([0, 1, 2, 3]))
  await expect(pane.getByText(/This file is binary/)).toBeVisible()
  rmSync(notes)
  await expect(pane.getByText("This file is gone")).toBeVisible()
  await expect(pane.getByText(notes, { exact: true })).toBeVisible()
})
