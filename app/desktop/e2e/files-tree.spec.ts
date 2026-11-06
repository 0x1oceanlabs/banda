import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { expect, test } from "@playwright/test"
import { firstThread, startWindow, type Window } from "./window"

let window: Window

test.afterEach(async () => {
  await window?.close()
})

/** Writes `text` at `path` under `folder`, its folders first. */
function put(folder: string, path: string, text = "") {
  mkdirSync(join(folder, path, ".."), { recursive: true })
  writeFileSync(join(folder, path), text)
}

test("Files shows a folder as a tree: it opens folders, greys what git ignores, shows hidden files, filters, opens a file beside, follows the disk, goes up and to a path typed, and pins", async () => {
  window = await startWindow()
  const { page, dir } = window
  await firstThread(page)
  const project = join(dir, "root", "Work")
  put(project, "src/main.ts", "export const one = 1\n")
  put(project, "src/lib/util.ts", "export const two = 2\n")
  put(project, "built/out.js", "x")
  put(project, ".gitignore", "built/\n")
  put(project, ".env", "SECRET=1\n")
  put(project, "README.md", "# Work\n")
  execFileSync("git", ["init", "-q"], { cwd: project })

  // The Banda menu's Files opens the focused Project's folder.
  await page.keyboard.press("Alt+Space")
  const menu = page.getByRole("dialog", { name: "Banda menu" })
  await menu.getByRole("combobox", { name: "Search" }).fill("Files")
  await menu
    .getByRole("option", { name: /^Files/ })
    .first()
    .click()
  await expect(menu).toBeHidden()
  const pane = page
    .locator("section")
    .filter({ has: page.getByRole("navigation", { name: "Places" }) })
  await expect(pane.getByRole("heading", { name: "Work" })).toBeVisible()
  const tree = pane.getByRole("tree")
  const row = (name: string) =>
    tree.getByRole("treeitem", { name, exact: true })

  // A folder opens as it is listed; what git ignores is greyed, not left
  // out; a dotfile shows only once hidden files do.
  await expect(row("src")).toBeVisible()
  await expect(row("built")).toHaveAttribute("data-item-git-status", "ignored")
  await expect(row(".env")).toHaveCount(0)
  await row("src").click()
  await expect(row("main.ts")).toBeVisible()
  await expect(row("lib")).toBeVisible()
  await page.keyboard.press("Control+Shift+Period")
  await expect(row(".env")).toBeVisible()
  await expect(
    pane.getByRole("button", { name: "Hidden files" })
  ).toHaveAttribute("aria-pressed", "true")
  await page.keyboard.press("Control+Shift+Period")
  await expect(row(".env")).toHaveCount(0)
  await page.screenshot({ path: "test-results/files-tree.png" })

  // Typing filters as one types, the matches under their folders;
  // Escape gives the tree back.
  await row("main.ts").click()
  await page.keyboard.type("util")
  const filter = pane.getByRole("textbox", { name: "Filter" })
  await expect(filter).toHaveValue("util")
  await expect(row("util.ts")).toBeVisible()
  await expect(row("README.md")).toHaveCount(0)
  await filter.press("Escape")
  await expect(filter).toBeHidden()
  await expect(row("README.md")).toBeVisible()

  // ↵ opens a file beside, in files.file.
  await row("main.ts").click()
  await page.keyboard.press("Enter")
  const file = page.getByRole("region", { name: "main.ts", exact: true })
  await expect(file).toBeVisible()
  await expect(file.locator('[data-line="1"]').first()).toContainText(
    "export const one"
  )

  // A file made on disk shows in the folder open.
  put(project, "src/fresh.ts")
  await expect(row("fresh.ts")).toBeVisible()

  // Ctrl+↑ goes to the folder above, the folder it came from picked.
  await row("README.md").click()
  await page.keyboard.press("Control+ArrowUp")
  await expect(pane.getByRole("heading", { name: "root" })).toBeVisible()
  await expect(row("Work")).toHaveAttribute("aria-selected", "true")

  // Ctrl+L types a path, from the folder shown; Tab completes a folder.
  await page.keyboard.press("Control+l")
  const path = pane.getByRole("combobox", { name: "Path" })
  await expect(path).toBeFocused()
  await path.press("End")
  await path.pressSequentially("Wo")
  await path.press("Tab")
  await expect(path).toHaveValue(/\/Work\/$/)
  await path.pressSequentially("sr")
  await path.press("Tab")
  await expect(path).toHaveValue(/\/Work\/src\/$/)
  await path.press("Enter")
  await expect(pane.getByRole("heading", { name: "src" })).toBeVisible()
  await expect(row("main.ts")).toBeVisible()

  // A folder's menu pins it among the places, in files.toml.
  await row("lib").click({ button: "right" })
  await page.getByRole("menuitem", { name: "Pin" }).click()
  const pinned = pane
    .getByRole("navigation", { name: "Places" })
    .getByRole("group", { name: "Pinned" })
  await expect(pinned.getByRole("button", { name: "lib" })).toBeVisible()
  expect(readFileSync(join(dir, "config/files.toml"), "utf8")).toContain(
    `pinned = [${JSON.stringify(join(project, "src/lib"))}]`
  )
  await page.screenshot({ path: "test-results/files-tree-pinned.png" })
})
