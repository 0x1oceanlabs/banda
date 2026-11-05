import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { expect, test } from "@playwright/test"
import { firstThread, startWindow, type Window } from "./window"

let window: Window

test.afterEach(async () => {
  await window?.close()
})

test("a reply's paths link to their files, which a click opens and the menu acts on", async () => {
  window = await startWindow()
  const { app, page, dir } = window
  const space = join(dir, "root", "Work")
  const notes = join(space, "docs", "notes.md")
  const code = join(space, "src", "app.js")
  // What the system would open, or show in its folder.
  await app.evaluate(({ shell }) => {
    const done: string[] = []
    ;(globalThis as { outside?: string[] }).outside = done
    shell.openPath = async (path) => {
      done.push(`open ${path}`)
      return ""
    }
    shell.showItemInFolder = (path) => {
      done.push(`show ${path}`)
    }
  })
  const outside = () =>
    app.evaluate(() => (globalThis as { outside?: string[] }).outside)
  const clipboard = () => app.evaluate(({ clipboard }) => clipboard.readText())
  const webviews = () =>
    app.evaluate(({ webContents }) =>
      webContents
        .getAllWebContents()
        .filter((one) => one.getType() === "webview")
        .map((one) => one.getURL())
    )

  const { thread, composer } = await firstThread(page)
  // In the Space it made.
  mkdirSync(join(space, "docs"))
  mkdirSync(join(space, "src"))
  writeFileSync(notes, "one\ntwo\nthree\n")
  writeFileSync(code, "export {}\n")
  writeFileSync(join(space, "docs", "My notes.md"), "spaced\n")
  await composer.fill(
    `See \`docs/notes.md:3\` and \`docs/gone.md\`, also src/app.js in prose, [the notes](docs/notes.md#L2), [spaced](<docs/My notes.md>) and [by URL](${pathToFileURL(code).href}).`
  )
  await composer.press("Enter")
  const reply = thread.locator("[data-quotable]")
  const chip = reply.locator("a[data-file][data-kind=code]")
  await expect(chip).toHaveText("docs/notes.md:3")
  await expect(chip).toHaveAttribute("data-file", notes)
  await expect(chip).toHaveAttribute(
    "title",
    `${notes}:3\nClick to open in Banda · Ctrl+click to open in its app`
  )
  await expect(chip.locator("[data-folder]")).toHaveText("docs/")
  // No file there: code as it was.
  await expect(reply.getByText("docs/gone.md")).toBeVisible()
  await expect(reply.locator("a[data-file]")).toHaveCount(5)
  await expect(reply.locator("a[data-file][data-kind=text]")).toHaveText(
    "src/app.js"
  )
  await expect(reply.locator("a[data-file][data-kind=named]")).toHaveText([
    "the notes(notes.md)",
    "spaced(My notes.md)",
    "by URL(app.js)",
  ])
  await page.screenshot({ path: "test-results/thread-paths.png" })

  // Ctrl+click: in its app; a click: in Banda's browser.
  await chip.click({ modifiers: ["Control"] })
  await expect.poll(outside).toEqual([`open ${notes}`])
  await reply.locator("a[data-file][data-kind=text]").click()
  await expect.poll(webviews).toEqual([pathToFileURL(code).href])

  // Its menu: open, show, copy either path, name it in the message.
  const menu = page.getByRole("menu", { name: "Thread" })
  await chip.click({ button: "right" })
  await expect(menu.getByRole("menuitem")).toHaveText([
    "Open in Banda",
    /^Open in its app/,
    "Show in folder",
    "Copy full path",
    "Copy relative path",
    "Add to message",
  ])
  await menu.getByRole("menuitem", { name: "Copy relative path" }).click()
  await expect.poll(clipboard).toBe("docs/notes.md:3")
  await expect(menu).toBeHidden()
  await chip.click({ button: "right" })
  await menu.getByRole("menuitem", { name: "Show in folder" }).click()
  await expect.poll(outside).toEqual([`open ${notes}`, `show ${notes}`])
  await expect(menu).toBeHidden()
  await chip.click({ button: "right" })
  await menu.getByRole("menuitem", { name: "Add to message" }).click()
  await expect(composer).toContainText("notes.md")

  // A file gone since says so.
  rmSync(notes)
  await chip.click()
  await expect(page.getByText(`No such file: ${notes}`)).toBeVisible()
})
