import { expect, test } from "@playwright/test"
import { firstThread, startWindow, type Window } from "./window"

let window: Window

test.afterEach(async () => {
  await window?.close()
})

test("a right click in a Thread offers what is under it: a reply, a selection, a link", async () => {
  window = await startWindow()
  const { app, page } = window
  const clipboard = () => app.evaluate(({ clipboard }) => clipboard.readText())
  const { thread, composer } = await firstThread(page)
  await composer.fill("A **bold** word and [a page](https://example.com/a).")
  await composer.press("Enter")
  const reply = thread.locator("[data-quotable]")
  await expect(reply).toContainText("bold word")
  const menu = page.getByRole("menu", { name: "Thread" })

  // A reply: its Markdown, its text, and the Fork its button has.
  await reply.getByText("bold word").click({ button: "right" })
  await expect(menu.getByRole("menuitem")).toHaveText([
    "Copy reply",
    "Copy as plain text",
    "Quote reply",
    "Fork from this response",
    "Select reply",
  ])
  await page.screenshot({ path: "test-results/thread-menu.png" })
  await menu.getByRole("menuitem", { name: "Copy reply" }).click()
  await expect.poll(clipboard).toContain("**bold**")

  // What is selected: copy, quote, find.
  await reply.getByText("bold word").click({ button: "right" })
  await menu.getByRole("menuitem", { name: "Select reply" }).click()
  // It selects once its menu has gone.
  await expect(menu).toBeHidden()
  await reply.getByText("bold word").click({ button: "right" })
  await expect(menu.getByRole("menuitem")).toHaveText([
    /^Copy/,
    "Quote in reply",
    /^Find “.+…” in Thread$/,
    "Search the web",
  ])
  await menu.getByRole("menuitem", { name: /^Copy/ }).click()
  // As Markdown (ADR 0063, decision 4).
  await expect.poll(clipboard).toContain("A **bold** word")
  await reply.getByText("bold word").click({ button: "right" })
  await menu.getByRole("menuitem", { name: "Quote in reply" }).click()
  await expect(composer).toContainText("bold word")
  await expect(composer).toBeFocused()

  // A link: where it goes, copied.
  await reply.getByRole("link", { name: /a page/ }).click({ button: "right" })
  await menu.getByRole("menuitem", { name: "Copy address" }).click()
  await expect.poll(clipboard).toBe("https://example.com/a")

  // The Person's message: its text, and Edit from here.
  await thread
    .locator("[data-slot=message][data-align=end]")
    .click({ button: "right" })
  await expect(menu.getByRole("menuitem")).toHaveText([
    "Copy message",
    "Edit from here",
  ])
  await page.keyboard.press("Escape")

  // Nothing to offer: no menu.
  await thread.locator("[data-slot=message-scroller-viewport]").click({
    button: "right",
    position: { x: 4, y: 4 },
  })
  await expect(menu).toBeHidden()
})

test("the composer's right click cuts, copies and pastes, as plain text too", async () => {
  window = await startWindow()
  const { app, page } = window
  const clipboard = () => app.evaluate(({ clipboard }) => clipboard.readText())
  const { composer } = await firstThread(page)
  const menu = page.getByRole("menu", { name: "Message" })
  // An item's name ends with its key, as "Paste Ctrl+V".
  const item = (name: string) =>
    menu.getByRole("menuitem", { name: new RegExp(`^${name}\\s*(Ctrl|⌘)`) })
  // On the text, as a right click elsewhere in it moves the caret there.
  const pick = async (name: string) => {
    await composer
      .locator("p")
      .first()
      .click({ button: "right", position: { x: 8, y: 8 } })
    await item(name).click()
    // The item acts once its menu has gone.
    await expect(menu).toBeHidden()
  }

  await composer.click({ button: "right" })
  await expect(item("Cut")).toBeDisabled()
  await expect(item("Undo")).toBeDisabled()
  await page.keyboard.press("Escape")
  await expect(composer).toBeFocused()

  await composer.pressSequentially("hello")
  await pick("Undo")
  await expect(composer).toHaveText("")
  await composer.click()
  await pick("Redo")
  await expect(composer).toHaveText("hello")
  await pick("Select all")
  await pick("Cut")
  await expect.poll(clipboard).toBe("hello")
  await expect(composer).toHaveText("")
  await pick("Paste")
  await expect(composer).toHaveText("hello")
  await pick("Select all")

  // Words, and HTML with them in bold: a plain paste takes the words.
  await page.evaluate(() =>
    navigator.clipboard.write([
      new ClipboardItem({
        "text/plain": new Blob(["plain words"], { type: "text/plain" }),
        "text/html": new Blob(["<b>plain</b> words"], { type: "text/html" }),
      }),
    ])
  )
  await pick("Paste as plain text")
  await expect(composer).toHaveText("plain words")
  await expect(composer.locator("strong")).toHaveCount(0)
})
