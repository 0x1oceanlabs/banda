import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { expect, type Locator, type Page, test } from "@playwright/test"
import { firstThread, startWindow, type Window } from "./window"

let window: Window

test.afterEach(async () => {
  await window?.close()
})

/** Writes `text` at `path` under `folder`, its folders first. */
function put(folder: string, path: string, text: string) {
  mkdirSync(join(folder, path, ".."), { recursive: true })
  writeFileSync(join(folder, path), text)
}

const UTIL = "export const one = 1\nexport const two = 2\n"

/** Files' tree, opened from the Thread with Alt+E, and a row of it. */
async function filesOf(page: Page) {
  await page.keyboard.press("Alt+e")
  const pane = page
    .locator("section")
    .filter({ has: page.getByRole("navigation", { name: "Places" }) })
  const tree = pane.getByRole("tree")
  await expect(tree).toBeVisible()
  return (name: string) => tree.getByRole("treeitem", { name, exact: true })
}

/** The file's Pane, opened from its row, once `first` shows in it. */
async function opened(page: Page, row: Locator, name: string, first: string) {
  await row.dblclick()
  const pane = page.getByRole("region", { name, exact: true })
  await expect(pane.getByText(first).first()).toBeVisible()
  return pane
}

/** Whether the focus is in the editor, which Pierre draws in a shadow
 * root of its own. */
const inEditor = (page: Page) =>
  page.evaluate(() => document.activeElement?.tagName === "DIFFS-CONTAINER")

test("a file is edited in place: saved as one types and at once with Ctrl+S, a dot until it is, a task's box writes its line, and what may not be written says why", async () => {
  window = await startWindow()
  const { page, dir } = window
  const { thread, composer } = await firstThread(page)
  const project = join(dir, "root", "Work")
  put(project, "src/util.ts", UTIL)
  put(project, "notes.md", "# Plan\n\n- [ ] one\n- [x] two\n")
  put(project, ".git/config", "[core]\n")
  const big = Array.from({ length: 20_500 }, (_, n) => `line ${n + 1}`)
  put(project, "big.txt", `${big.join("\n")}\n`)
  const disk = (path: string) => readFileSync(join(project, path), "utf8")

  await composer.fill("Hello")
  await composer.press("Enter")
  await expect(thread.getByText("You said: Hello")).toBeVisible()
  const row = await filesOf(page)
  await row("src").click()
  const util = await opened(page, row("util.ts"), "util.ts", "export const one")

  // E edits, once the view has the keys; the editor takes the focus.
  const edit = util.getByRole("button", { name: "Edit" })
  await expect(edit).toHaveAttribute("aria-pressed", "false")
  await expect(util.locator("[data-keys]")).toBeFocused()
  await page.keyboard.press("e")
  await expect(edit).toHaveAttribute("aria-pressed", "true")
  await expect.poll(() => inEditor(page)).toBe(true)

  // Typed, a dot says it is not saved yet; once typing rests it is, and
  // the header says so.
  await page.keyboard.press("End")
  await page.keyboard.type(" // edited")
  const unsaved = util.getByRole("img", { name: "Not saved yet" })
  await expect(unsaved).toBeVisible()
  await expect(util.locator("header").getByText("Saved")).toBeVisible()
  await expect(unsaved).toBeHidden()
  expect(disk("src/util.ts")).toBe(
    "export const one = 1 // edited\nexport const two = 2\n"
  )
  await page.screenshot({ path: "test-results/files-edit-saved.png" })

  // Ctrl+S saves at once, well before typing would rest.
  await page.keyboard.type("!")
  await page.keyboard.press("Control+s")
  await expect
    .poll(() => disk("src/util.ts"), { timeout: 400 })
    .toBe("export const one = 1 // edited!\nexport const two = 2\n")

  // The disk goes back to the very text the editor started from, as
  // `git checkout` does: the editor shows it, and what is typed next is
  // typed on it, not on the text that was there before.
  writeFileSync(join(project, "src/util.ts"), UTIL)
  await expect(util.getByText("// edited!")).toBeHidden()
  await page.keyboard.type("?")
  await expect.poll(() => disk("src/util.ts")).not.toBe(UTIL)
  expect(disk("src/util.ts")).not.toContain("edited")

  // Esc is done editing.
  await page.keyboard.press("Escape")
  await expect(edit).toHaveAttribute("aria-pressed", "false")

  // In markdown's rendered view, a task's box writes its line.
  const notes = await opened(page, row("notes.md"), "notes.md", "Plan")
  await notes.getByRole("checkbox").first().click()
  await expect
    .poll(() => disk("notes.md"))
    .toBe("# Plan\n\n- [x] one\n- [x] two\n")
  await expect(notes.getByRole("checkbox").first()).toBeChecked()

  // Too big a file, and one in .git, are read-only, and say why.
  const bigPane = await opened(page, row("big.txt"), "big.txt", "line 1")
  const bigEdit = bigPane.getByRole("button", { name: "Edit" })
  await expect(bigEdit).toBeDisabled()
  await expect(bigEdit).toHaveAttribute("title", /20,000 lines/)
  await row("notes.md").click()
  await page.keyboard.press("Control+Shift+Period")
  await row(".git").click()
  const config = await opened(page, row("config"), "config", "[core]")
  const gitEdit = config.getByRole("button", { name: "Edit" })
  await expect(gitEdit).toBeDisabled()
  await expect(gitEdit).toHaveAttribute("title", /\.git/)
  await config.locator("[data-keys]").focus()
  await page.keyboard.press("e")
  await expect(gitEdit).toHaveAttribute("aria-pressed", "false")
  expect(disk(".git/config")).toBe("[core]\n")
})

test("the Agent writes a file under unsaved text: the text is kept, the bar names the Agent, Compare shows the two, Take theirs takes the disk's and Keep mine writes over it", async () => {
  window = await startWindow()
  const { page, dir } = window
  const { thread, composer } = await firstThread(page)
  const project = join(dir, "root", "Work")
  put(project, "notes.md", "one\ntwo\n")
  put(project, "src/util.ts", UTIL)
  const disk = () => readFileSync(join(project, "src/util.ts"), "utf8")

  await composer.fill("Hello")
  await composer.press("Enter")
  await expect(thread.getByText("You said: Hello")).toBeVisible()
  const row = await filesOf(page)
  await row("src").click()
  const util = await opened(page, row("util.ts"), "util.ts", "export const one")
  await util.getByRole("button", { name: "Edit" }).click()
  await expect.poll(() => inEditor(page)).toBe(true)

  /** The Person types at the end of line 2 and, before typing rests, has
   * the Agent's turn write the file: the fake agent's walk adds a line. */
  const writeUnder = async (typed: string) => {
    await composer.fill("walk the files")
    await composer.press("Enter")
    await expect(thread.getByText("Read notes.md").last()).toBeVisible()
    await composer.fill("go on")
    await util.locator('[data-line="2"]').first().click()
    await expect.poll(() => inEditor(page)).toBe(true)
    await page.keyboard.press("End")
    await page.keyboard.type(typed)
    await composer.press("Enter")
  }

  /** The focus back in the file's Pane, from the Thread's composer: the
   * strip slides it into sight, and a click waits until it is still. */
  const toFile = () => util.locator("[data-keys]").focus()

  await writeUnder(" // mine")
  const bar = util.getByRole("alert", { name: "Changed on disk" })
  await expect(bar).toContainText("Changed on disk by the Agent")
  await expect(util.getByRole("img", { name: "Not saved yet" })).toBeVisible()
  // Nothing went over the Agent's write, and the Person's text stays.
  expect(disk()).toBe(`${UTIL}export const three = 3\n`)
  await expect(util.locator('[data-line="2"]').first()).toContainText(
    "export const two = 2 // mine"
  )
  await page.screenshot({ path: "test-results/files-edit-moved.png" })

  // Compare: the disk's text against the Person's.
  await toFile()
  await bar.getByRole("button", { name: "Compare" }).click()
  await expect(bar.getByRole("button", { name: "Compare" })).toHaveAttribute(
    "aria-pressed",
    "true"
  )
  await expect(util.getByText("export const three = 3")).toBeVisible()
  await expect(bar).toContainText("Red is on disk, green is yours.")
  await page.screenshot({ path: "test-results/files-edit-compare.png" })

  // Take theirs: the disk's text, and nothing written.
  await bar.getByRole("button", { name: "Take theirs" }).click()
  await expect(bar).toBeHidden()
  await expect(util.locator('[data-line="3"]').first()).toContainText(
    "export const three = 3"
  )
  await expect(util.getByRole("img", { name: "Not saved yet" })).toBeHidden()
  expect(disk()).toBe(`${UTIL}export const three = 3\n`)

  // Again; Keep mine writes the Person's text over the Agent's.
  await composer.fill("done")
  await composer.press("Enter")
  await expect(thread.getByText("I walked the files.")).toBeVisible()
  await writeUnder(" // mine")
  await expect(bar).toContainText("Changed on disk by the Agent")
  await toFile()
  await bar.getByRole("button", { name: "Keep mine" }).click()
  await expect(bar).toBeHidden()
  await expect
    .poll(disk)
    .toBe(
      "export const one = 1\nexport const two = 2 // mine\nexport const three = 3\n"
    )
  await expect(util.locator("header").getByText("Saved")).toBeVisible()
})
