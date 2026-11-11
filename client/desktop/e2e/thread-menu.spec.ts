import { expect, test } from "@playwright/test"
import {
  call,
  firstThread,
  send,
  sidebarOf,
  startWindow,
  threadNamed,
  type Window,
} from "./window"

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

test("a card's menu in the sidebar: its rows by where it stands, each with its key; Copy as Markdown, Fork and Stop do what they say (ADR 0098, S10a)", async () => {
  test.setTimeout(180_000)
  window = await startWindow()
  const { app, page } = window
  const clipboard = () => app.evaluate(({ clipboard }) => clipboard.readText())
  await firstThread(page)
  await send(window, "remember apples")
  await send(window, "wait for the build")
  const sidebar = sidebarOf(page)
  const card = (title: string) =>
    sidebar.getByRole("option", { name: new RegExp(`^${title}`) })
  const menu = page.getByRole("menu", { name: "Thread menu" })

  // A done card: Open; its acts with the sidebar's keys; its names; and
  // what it gives out. No other Project, no Move to Project.
  await card("remember apples").click({ button: "right" })
  await expect(menu.getByRole("menuitem")).toHaveText([
    /^Open\s*(Enter|Return)$/,
    /^Open beside\s*Shift\+(Enter|Return)$/,
    /^Archive\s*S$/,
    /^Later…\s*Z$/,
    /^Mark as (un)?read\s*U$/,
    /^Rename…\s*F2$/,
    "Fork",
    "Copy as Markdown",
    "Show folder",
  ])
  await expect(menu.getByRole("separator")).toHaveCount(3)
  await page.screenshot({ path: "test-results/thread-menu-card.png" })

  // Copy as Markdown: its title, then each message under who said it.
  await menu.getByRole("menuitem", { name: "Copy as Markdown" }).click()
  await expect(menu).toBeHidden()
  await expect
    .poll(clipboard)
    .toMatch(
      /^# remember apples\n\n## You\n\nremember apples\n\n## .+\n\nI will remember apples\.\n$/
    )

  // Fork: a Thread from its last reply, opened in a Pane. (The fake
  // Harness names a reply to fork from as it remembers.)
  type Threads = { threads: { id: string; title: string }[] }
  const threads = () => (call(window, "agents.threads") as Threads).threads
  const before = threads().map(({ id }) => id)
  await card("remember apples").click({ button: "right" })
  await menu.getByRole("menuitem", { name: "Fork" }).click()
  await expect.poll(() => threads().length).toBe(before.length + 1)
  const fork = threads().find(({ id }) => !before.includes(id))!
  await expect(
    page.getByRole("region", { name: fork.title, exact: true })
  ).toBeVisible()

  // A working card: Later…, Later — when done and Stop; it neither
  // archives nor forks. Stop ends its turn.
  await card("wait for the build").click({ button: "right" })
  await expect(menu.getByRole("menuitem")).toHaveText([
    /^Open/,
    /^Open beside/,
    /^Later…\s*Z$/,
    "Later — when done",
    "Stop",
    /^Rename…/,
    "Copy as Markdown",
    "Show folder",
  ])
  await menu.getByRole("menuitem", { name: "Stop" }).click()
  await expect
    .poll(() => threadNamed(window, "wait for the build")?.latest?.state)
    .not.toBe("running")
})
