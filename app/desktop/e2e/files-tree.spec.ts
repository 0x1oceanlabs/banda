import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { expect, type Locator, test } from "@playwright/test"
import {
  editorsOn,
  firstThread,
  openedIn,
  startWindow,
  type Window,
} from "./window"

let window: Window

test.afterEach(async () => {
  await window?.close()
})

/** Drops on `box` what a drag brings: files by their names, as main's
 * drag brings them back, or whole paths in Banda's own type, as the
 * page's drag carries them. */
async function dropOn(
  box: Locator,
  { files = [], paths }: { files?: string[]; paths?: string[] }
) {
  await box.evaluate(
    (element, { files, paths }) => {
      const data = new DataTransfer()
      for (const name of files) data.items.add(new File(["x"], name))
      if (paths) {
        data.setData("application/x-banda-paths", JSON.stringify(paths))
        data.setData("text/plain", paths.join("\n"))
      }
      for (const type of ["dragenter", "dragover", "drop"])
        element.dispatchEvent(
          new DragEvent(type, {
            bubbles: true,
            cancelable: true,
            dataTransfer: data,
          })
        )
    },
    { files, paths }
  )
}

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

test("a row goes into a Thread's message by its menu or a drag, opens in an editor, and shows in its folder; so does a file's header", async () => {
  window = await startWindow()
  const { app, page, dir } = window
  const { thread, composer } = await firstThread(page)
  const project = join(dir, "root", "Work")
  put(project, "src/main.ts", "export const one = 1\nexport const two = 2\n")
  put(project, "src/util.ts", "export {}\n")
  put(project, "README.md", "# Work\n")
  const main = join(project, "src/main.ts")
  const readme = join(project, "README.md")
  // The editors this machine has; what the system shows, opens and drags.
  await editorsOn(app, [
    { id: "zed", name: "Zed" },
    { id: "vscode", name: "VS Code" },
  ])
  await app.evaluate(({ ipcMain, shell }) => {
    const done: string[] = []
    ;(globalThis as { outside?: string[] }).outside = done
    shell.openPath = async (path) => {
      done.push(`open ${path}`)
      return ""
    }
    shell.showItemInFolder = (path) => {
      done.push(`show ${path}`)
    }
    ipcMain.removeAllListeners("files.drag")
    ipcMain.on("files.drag", (_event, paths: string[]) => {
      done.push(`drag ${paths.join(" ")}`)
    })
  })
  const outside = () =>
    app.evaluate(() => (globalThis as { outside?: string[] }).outside)
  const chips = composer.locator("[data-chip=file]")

  // The Thread first, as Files opens beside it.
  await composer.fill("Hello")
  await composer.press("Enter")
  await expect(thread.getByText("You said: Hello")).toBeVisible()
  await page.keyboard.press("Alt+e")
  const pane = page
    .locator("section")
    .filter({ has: page.getByRole("navigation", { name: "Places" }) })
  const tree = pane.getByRole("tree")
  const row = (name: string) =>
    tree.getByRole("treeitem", { name, exact: true })
  await row("src").click()
  await expect(row("main.ts")).toBeVisible()

  // A row's menu: the editor files.toml names, or the first; the others;
  // the system's app; the system's file manager; the Thread.
  const menu = page.getByRole("menu", { name: "Row" })
  await row("README.md").click({ button: "right" })
  await expect(menu.getByRole("menuitem")).toHaveText([
    /^Open/,
    /^Quick Look/,
    "Open in Zed",
    "Open in",
    "Open with the system",
    /^Reveal in /,
    "Add to chat",
    "Copy path",
    /^New file/,
    /^New folder/,
    /^Rename/,
    /^Duplicate/,
    /^Copy/,
    /^Cut/,
    /^Move to Trash/,
  ])
  await page.screenshot({ path: "test-results/files-row-menu.png" })
  await menu.getByRole("menuitem", { name: "Open in Zed" }).click()
  await expect.poll(() => openedIn(app)).toEqual([["zed", readme, null, null]])
  await row("README.md").click({ button: "right" })
  await menu.getByRole("menuitem", { name: "Open in", exact: true }).hover()
  await page.getByRole("menuitem", { name: "VS Code" }).click()
  await expect
    .poll(() => openedIn(app))
    .toEqual([
      ["zed", readme, null, null],
      ["vscode", readme, null, null],
    ])
  await row("README.md").click({ button: "right" })
  await menu.getByRole("menuitem", { name: /^Reveal in / }).click()
  await expect.poll(outside).toEqual([`show ${readme}`])

  // Add to chat names it in the Thread's message, from the Project's
  // folder, as `@` does; and the Thread gets the focus.
  await row("README.md").click({ button: "right" })
  await menu.getByRole("menuitem", { name: "Add to chat" }).click()
  await expect(chips).toHaveAttribute("data-value", "README.md")
  await expect(page.locator("section[data-focused=true]")).toContainText(
    "You said: Hello"
  )

  // A row dragged out is main's drag, of the file itself; dropped back on
  // the composer, it is named there, not copied in.
  await row("main.ts").dragTo(composer)
  await expect.poll(outside).toContain(`drag ${main}`)
  await dropOn(composer, { files: ["main.ts"] })
  await expect(chips).toHaveCount(2)
  await expect(chips.nth(1)).toHaveAttribute("data-value", "src/main.ts")
  // A drag the page runs, as outside Banda's window, carries Banda's own
  // type, which the composer names too.
  await dropOn(composer, { paths: [join(project, "src/util.ts")] })
  await expect(chips).toHaveCount(3)
  await expect(chips.nth(2)).toHaveAttribute("data-value", "src/util.ts")
  await expect(composer).not.toContainText(project)

  // A file's header: in the editor at the line it opened at, and in its
  // folder.
  await composer.press("Control+a")
  await composer.press("Backspace")
  await composer.fill("See `src/main.ts:2`")
  await composer.press("Enter")
  await thread
    .locator("[data-quotable] a[data-file][data-kind=code]")
    .last()
    .click()
  const file = page.getByRole("region", { name: "main.ts", exact: true })
  await expect(file).toBeVisible()
  const open = file.getByRole("button", { name: "Open in Zed" })
  await expect(open).toHaveAttribute("title", "Open in Zed at line 2")
  await open.click()
  await expect
    .poll(async () => (await openedIn(app))?.at(-1))
    .toEqual(["zed", main, 2, null])
  await file.getByRole("button", { name: /^Reveal in / }).click()
  await expect.poll(async () => (await outside())?.at(-1)).toBe(`show ${main}`)
  await page.screenshot({ path: "test-results/files-header.png" })
})

test("Add to chat with no Thread in the Project says so", async () => {
  window = await startWindow()
  const { page, dir } = window
  const { composer } = await firstThread(page)
  put(join(dir, "root", "Work"), "README.md", "# Work\n")
  // The window has the keys once the new Thread's box has the focus.
  await expect(composer).toBeFocused()
  // No Thread: the new one is closed, and Files is all there is.
  await page.keyboard.press("Alt+e")
  const pane = page
    .locator("section")
    .filter({ has: page.getByRole("navigation", { name: "Places" }) })
  const row = pane.getByRole("treeitem", { name: "README.md", exact: true })
  await expect(row).toBeVisible()
  await page.getByRole("button", { name: "Close New Thread" }).click()
  await row.click({ button: "right" })
  await page.getByRole("menuitem", { name: "Add to chat" }).click()
  await expect(
    page.getByText("No Thread in this Project to add it to.")
  ).toBeVisible()
})
