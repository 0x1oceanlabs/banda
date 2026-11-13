/**
 * arc's Files run on arc's engine, and this device only draws them (ADR
 * 0106, step 3b), on arc.ts's arc, 40 ms away a round trip: the `files`
 * road. arc's tree lists arc's folder; a file opens from arc and is edited
 * and saved there; a rename and the Trash go through arc's engine, with
 * Undo; Quick open finds arc's files; a markdown draws, its picture as
 * words; a file of another machine held over arc's tree is refused in
 * words; a comment on some lines goes into an arc Thread's Message box; and
 * an edit while arc is away keeps its text and says why. A path in arc's
 * reply is found by arc and opens arc's file, and its links go through the
 * router (step 3c, the `paths` road). The same-path job
 * runs this spec with arc in a mount namespace of its own (ci.yml's
 * `same-path`). With BANDA_E2E_SHOTS set to a folder, it leaves pictures
 * of what it checks.
 */
import { existsSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { expect, type Locator, type Page, test } from "@playwright/test"
import { type Arc, newArc, put, shot, withArc } from "./arc"
import { pdfOf } from "./pdf"
import { projectId, type Window } from "./window"

let window: Window | undefined
let arc: Arc | undefined
let stopArc: (() => Promise<void>) | undefined

test.afterEach(async () => {
  await window?.close()
  await stopArc?.()
  arc?.close()
  window = arc = stopArc = undefined
})

/** The title of arc's Thread in its Project "Same". */
const TITLE = "Bench remote Files"

const NOTES =
  "# Notes\n\nFrom arc.\n\n![the diagram](pic.png)\n\n" +
  "[the site](https://example.com/page)\n\n[its server](http://localhost:3000/)\n"
const UTIL = "export const one = 1\nexport const two = 2\n"
/** A long file, so a path to line 12 has somewhere to scroll to. */
const LONG = Array.from(
  { length: 14 },
  (_, n) => `export const line${n + 1} = ${n + 1}\n`
).join("")

/** arc's dot in the sidebar's foot, which says how it stands: `live`, or
 * `away` (ADR 0098, decision 18). */
const dotOf = (page: Page) =>
  page
    .getByRole("complementary", { name: "Sidebar" })
    .locator('[data-machine-dot="arc"]')

/** arc's part of the sidebar: its label and what it holds. */
const arcOf = (page: Page) =>
  page
    .getByRole("complementary", { name: "Sidebar" })
    .getByRole("group", { name: "arc", exact: true })

/**
 * "Same" on arc with its files and a Thread done, open in the window from
 * arc's part of the sidebar; this machine has its own "Same" at the same
 * path where the two share one, whose files never change.
 */
async function onArc(files: Record<string, string | Uint8Array> = {}) {
  arc = newArc({ latency: 40 })
  stopArc = await arc.start()
  const there = join(arc.code.arc, "Same")
  put(arc.disk(there), {
    "who.txt": "arc\n",
    "only-arc.txt": "arc\n",
    "src/util.ts": UTIL,
    "notes.md": NOTES,
    ...files,
  })
  const here = join(arc.code.here, "Same")
  put(here, {
    "who.txt": "mac\n",
    "only-mac.txt": "mac\n",
    "src/util.ts": "// mac\n",
    "notes.md": "# Mac\n",
    "pic.png": Buffer.from(PNG_1X1, "base64"),
  })
  const project = JSON.parse(arc.banda("project", "add", there)).ok.id as string
  arc.send(project, TITLE)
  await expect
    .poll(() => arc!.states(project).find(([one]) => one === TITLE)?.[1])
    .toBe("done")
  window = await withArc(arc)
  const { page } = window
  await arcOf(page).getByText(TITLE).click()
  const thread = page.getByRole("region", { name: TITLE, exact: true })
  await expect(thread.getByText(`You said: ${TITLE}`)).toBeVisible()
  // This machine's engine runs by now.
  window.banda("project", "add", here)
  const composer = thread.getByRole("textbox", { name: "Message to Fake AI" })
  return { page, thread, composer, project, there, here }
}

/** Files' tree, opened from the Thread with Alt+E, and a row of it. */
async function filesOf(page: Page, composer: Locator) {
  await composer.focus()
  await page.keyboard.press("Alt+e")
  const pane = page
    .locator("section")
    .filter({ has: page.getByRole("navigation", { name: "Places" }) })
  const tree = pane.getByRole("tree")
  await expect(tree).toBeVisible()
  return {
    pane,
    tree,
    row: (name: string) => tree.getByRole("treeitem", { name, exact: true }),
  }
}

/** The file's Pane, opened from its row, once `first` shows in it. */
async function opened(page: Page, row: Locator, name: string, first: string) {
  await row.dblclick()
  const pane = page.getByRole("region", { name, exact: true })
  await expect(pane.getByText(first).first()).toBeVisible()
  return pane
}

/** A path's link in arc's reply, once arc has found its file. */
const pathOf = (thread: Locator, kind: "code" | "text" | "named") =>
  thread.locator(`[data-quotable] a[data-file][data-kind=${kind}]`)

/** Whether the focus is in the editor, which Pierre draws in a shadow
 * root of its own. */
const inEditor = (page: Page) =>
  page.evaluate(() => document.activeElement?.tagName === "DIFFS-CONTAINER")

test("files: arc's tree lists arc's folder, its places are arc's, a file opens from arc, and an edit saves to arc's disk", async () => {
  const { page, composer, there, here } = await onArc()
  const { pane, tree, row } = await filesOf(page, composer)
  await expect(row("only-arc.txt")).toBeVisible()
  await expect(
    tree.getByRole("treeitem", { name: "only-mac.txt" })
  ).toHaveCount(0)
  // arc's places, and none pinned on this device.
  const places = pane.getByRole("navigation", { name: "Places" })
  await expect(places.getByRole("group", { name: "Pinned" })).toHaveCount(0)
  await shot(page, "files-arc")

  // A row of arc's: what opens it is on this computer is gone, and
  // Show in Files stands in.
  await row("only-arc.txt").click({ button: "right" })
  const menu = page.getByRole("menu", { name: "Row" })
  await expect(
    menu.getByRole("menuitem", { name: /^Open(?! with| in)/ })
  ).toBeVisible()
  await expect(
    menu.getByRole("menuitem", { name: "Show in Files" })
  ).toBeVisible()
  await expect(
    menu.getByRole("menuitem", { name: "Open with the system" })
  ).toHaveCount(0)
  await expect(menu.getByText(/^Reveal in/)).toHaveCount(0)
  await expect(menu.getByText(/^Open in /)).toHaveCount(0)
  await shot(page, "files-arc-row-menu")
  await page.keyboard.press("Escape")

  // A file opens from arc; this machine's file at the path says mac.
  const who = await opened(page, row("who.txt"), "who.txt", "arc")
  await expect(who.locator('[data-line="1"]').first()).toHaveText("arc")
  await who.getByRole("button", { name: "Edit" }).click()
  await expect.poll(() => inEditor(page)).toBe(true)
  await page.keyboard.press("End")
  await page.keyboard.type(" edited")
  await expect(who.locator("header").getByText("Saved")).toBeVisible()
  expect(readFileSync(arc!.disk(join(there, "who.txt")), "utf8")).toBe(
    "arc edited\n"
  )
  expect(readFileSync(join(here, "who.txt"), "utf8")).toBe("mac\n")
})

test("files: arc's Agent writes the file under unsaved text, and the conflict bar names it; the text stays and nothing goes over the Agent's write", async () => {
  const { page, composer, thread, there } = await onArc()
  const { row } = await filesOf(page, composer)
  await row("src").click()
  const util = await opened(page, row("util.ts"), "util.ts", "export const one")
  await util.getByRole("button", { name: "Edit" }).click()
  await expect.poll(() => inEditor(page)).toBe(true)
  // The fake Agent's walk waits at a read and writes on the next message,
  // so its write lands before the text rests the 500 ms a save waits.
  await composer.fill("walk the files")
  await composer.press("Enter")
  await expect(thread.getByText("Read notes.md").last()).toBeVisible()
  await composer.fill("go on")
  await util.locator('[data-line="2"]').first().click()
  await expect.poll(() => inEditor(page)).toBe(true)
  await page.keyboard.press("End")
  await page.keyboard.type(" // mine")
  await composer.press("Enter")
  const bar = util.getByRole("alert", { name: "Changed on disk" })
  await expect(bar).toContainText("Changed on disk by the Agent")
  await expect(util.locator('[data-line="2"]').first()).toContainText(" mine")
  const disk = readFileSync(arc!.disk(join(there, "src/util.ts")), "utf8")
  expect(disk).toContain("export const three = 3")
  expect(disk).not.toContain("mine")
})

test("files: a real drag of a row of arc's onto a folder moves it, on arc", async () => {
  const { page, composer, there } = await onArc()
  const { row } = await filesOf(page, composer)
  await row("only-arc.txt").dragTo(row("src"))
  await expect
    .poll(() => existsSync(arc!.disk(join(there, "src/only-arc.txt"))))
    .toBe(true)
  expect(existsSync(arc!.disk(join(there, "only-arc.txt")))).toBe(false)
})

test("files: a rename and the Trash go through arc's engine, and Undo brings the file back from the Trash", async () => {
  const { page, composer, there, here } = await onArc()
  const { row } = await filesOf(page, composer)
  await row("only-arc.txt").click()
  await page.keyboard.press("F2")
  const name = page.getByRole("textbox", { name: "Name" })
  await expect(name).toBeFocused()
  await name.fill("renamed.txt")
  await name.press("Enter")
  await expect(row("renamed.txt")).toBeVisible()
  await expect(
    page.getByText("Renamed “only-arc.txt” to “renamed.txt”")
  ).toBeVisible()
  expect(existsSync(arc!.disk(join(there, "renamed.txt")))).toBe(true)
  expect(existsSync(join(here, "renamed.txt"))).toBe(false)

  // The Trash on arc: the row goes, Undo puts it back on arc.
  await row("renamed.txt").click()
  await page.keyboard.press("Control+Backspace")
  await expect(row("renamed.txt")).toHaveCount(0)
  expect(existsSync(arc!.disk(join(there, "renamed.txt")))).toBe(false)
  await page
    .locator("[data-sonner-toast]")
    .filter({ hasText: "Moved “renamed.txt” to the Trash" })
    .getByRole("button", { name: "Undo" })
    .click()
  await expect(row("renamed.txt")).toBeVisible()
  expect(existsSync(arc!.disk(join(there, "renamed.txt")))).toBe(true)
})

test("Alt+P: quick open finds arc's files and opens arc's file", async () => {
  const { page, composer } = await onArc()
  await composer.focus()
  await page.keyboard.press("Alt+p")
  const menu = page.getByRole("dialog", { name: "Banda menu" })
  const search = menu.getByRole("combobox", { name: "Search" })
  await search.fill("only")
  await expect(menu.getByRole("option").first()).toContainText("only-arc.txt")
  await expect(menu.getByRole("option", { name: /only-mac/ })).toHaveCount(0)
  await search.press("Enter")
  const file = page.getByRole("region", { name: "only-arc.txt", exact: true })
  await expect(file.locator('[data-line="1"]').first()).toHaveText("arc")
})

test("a markdown of arc's is drawn with arc's picture, its links open outside or say whose they are; arc's JSON and PDF draw from arc's bytes (ADR 0106, step 4c)", async () => {
  const { page, composer } = await onArc({
    "pic.png": Buffer.from(PNG_3X2, "base64"),
    "manual.pdf": pdfOf([["Chapter 1", "From arc."]]),
    "data.json": '{ "from": "arc" }\n',
  })
  const { app } = window!
  await app.evaluate(({ shell }) => {
    const opened: string[] = []
    ;(globalThis as { linkOpens?: string[] }).linkOpens = opened
    shell.openExternal = async (url) => {
      opened.push(url)
    }
  })
  const external = () =>
    app.evaluate(() => (globalThis as { linkOpens?: string[] }).linkOpens)
  const { row } = await filesOf(page, composer)
  const notes = await opened(page, row("notes.md"), "notes.md", "Notes")
  await expect(
    notes.getByRole("heading", { name: "Notes", exact: true })
  ).toBeVisible()
  // Its picture is arc's, not this machine's at the same path.
  const picture = notes.getByRole("img", { name: "the diagram" })
  await expect
    .poll(() =>
      picture.evaluate((image: HTMLImageElement) => image.naturalWidth)
    )
    .toBe(3)
  // A public page goes to this device's browser on a plain click, and
  // arc's own address says whose it is and opens nothing here.
  await notes.getByRole("link", { name: /the site/ }).click()
  await expect.poll(external).toEqual(["https://example.com/page"])
  await notes.getByRole("link", { name: /its server/ }).click()
  await expect(
    page
      .getByRole("region", { name: "Notifications" })
      .getByText("localhost:3000 is arc's")
  ).toBeVisible()
  expect(await external()).toEqual(["https://example.com/page"])
  // JSON's view and the PDF's read arc's bytes, in ranges for the PDF.
  await row("data.json").dblclick()
  const data = page.getByRole("region", { name: "data.json", exact: true })
  await expect(data.getByRole("tree", { name: "data.json" })).toBeVisible()
  await expect(data.getByText("does not parse")).toHaveCount(0)
  await row("manual.pdf").dblclick()
  const pdf = page.getByRole("region", { name: "manual.pdf", exact: true })
  await expect(
    pdf.locator('[data-pdf-page="1"] [data-pdf-text]')
  ).toContainText("From arc.")
  await shot(page, "files-arc-pdf")
})

test("Save a copy of arc's file puts arc's bytes where the Person picks on this machine (ADR 0106, step 4c)", async () => {
  const { page, composer } = await onArc()
  const { row } = await filesOf(page, composer)
  // The system's save dialog, as the Person answers it: a place of this
  // machine's, in the test's folder.
  const to = join(window!.dir, "saved-only-arc.txt")
  await window!.app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = (async () => ({
      canceled: false,
      filePath: path,
    })) as typeof dialog.showSaveDialog
  }, to)
  await row("only-arc.txt").click({ button: "right" })
  const menu = page.getByRole("menu", { name: "Row" })
  await menu
    .getByRole("menuitem", { name: /^Save a copy to this (Mac|machine)$/ })
    .click()
  await expect
    .poll(() => (existsSync(to) ? readFileSync(to, "utf8") : null))
    .toBe("arc\n")
  await expect(
    page
      .getByRole("region", { name: "Notifications" })
      .getByText("Saved a copy of only-arc.txt")
  ).toBeVisible()
})

test("a file of this machine dropped on arc's tree is refused in words, and nothing moves", async () => {
  const { page, composer, there, here } = await onArc()
  const { tree, row } = await filesOf(page, composer)
  await expect(row("only-arc.txt")).toBeVisible()
  // What a drag of this machine's row carries, its Project and whole
  // path: a drag between two Panes is the Person's hand.
  const project = projectId(window!, "Same")
  // A Project added from outside shows as its machine says so (ADR
  // 0127), and only then does the window know this machine holds it.
  const toast = page
    .getByRole("region", { name: "Notifications" })
    .getByText(
      /That file is on this (Mac|machine)\. Files don't move between machines yet\./
    )
  await expect(async () => {
    await tree.evaluate(
      (element, payload) => {
        const data = new DataTransfer()
        data.setData("application/x-banda-paths", payload)
        element.dispatchEvent(
          new DragEvent("drop", {
            dataTransfer: data,
            bubbles: true,
            composed: true,
            cancelable: true,
          })
        )
      },
      JSON.stringify([{ project, path: join(here, "only-mac.txt") }])
    )
    await expect(toast).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 30_000 })
  await shot(page, "files-drag-refused", { toasts: true })
  expect(existsSync(arc!.disk(join(there, "only-mac.txt")))).toBe(false)
  expect(existsSync(join(here, "only-mac.txt"))).toBe(true)
})

test("a comment on some lines of arc's file goes into arc's Thread's Message box, and reaches arc's Agent", async () => {
  const { page, composer, thread } = await onArc()
  const { row } = await filesOf(page, composer)
  await row("src").click()
  await expect(row("util.ts")).toBeVisible()
  const util = await opened(page, row("util.ts"), "util.ts", "export const one")
  await util.locator('[data-column-number="1"]').first().click()
  await util
    .locator('[data-column-number="2"]')
    .first()
    .click({ modifiers: ["Shift"] })
  await util.getByRole("button", { name: "Add a comment…" }).click()
  const field = util.getByRole("textbox", { name: "Comment on lines 1–2" })
  await expect(field).toBeFocused()
  await field.fill("Why two?")
  await util.getByRole("button", { name: "Comment", exact: true }).click()
  const chips = thread.getByRole("list", { name: "Comments" })
  await expect(chips.getByRole("listitem")).toHaveText(
    /util\.ts:1-2\s*Why two\?/
  )
  await composer.fill("Look at this")
  await composer.press("Enter")
  await expect(
    thread.getByText("Comment on src/util.ts:1-2:").last()
  ).toBeVisible()
})

test("an edit while arc is away keeps its text: Not saved: arc is away, and it saves once arc is back", async () => {
  test.setTimeout(240_000)
  const { page, composer, there } = await onArc()
  const { row } = await filesOf(page, composer)
  const who = await opened(page, row("who.txt"), "who.txt", "arc")
  await who.getByRole("button", { name: "Edit" }).click()
  await expect.poll(() => inEditor(page)).toBe(true)

  arc!.blackhole(true)
  await expect(dotOf(page)).toHaveAttribute("data-standing", "away", {
    timeout: 60_000,
  })
  await who.locator('[data-line="1"]').first().click()
  await expect.poll(() => inEditor(page)).toBe(true)
  await page.keyboard.press("End")
  await page.keyboard.type(" kept")
  const bar = who.getByRole("alert", { name: "Not saved" })
  await expect(bar).toHaveText(/Not saved: arc is away/, { timeout: 30_000 })
  await shot(page, "files-not-saved")
  await expect(who.locator('[data-line="1"]').first()).toContainText("kept")
  expect(readFileSync(arc!.disk(join(there, "who.txt")), "utf8")).toBe("arc\n")

  // Back, the next keystroke saves it, over its base hash.
  arc!.blackhole(false)
  await expect(dotOf(page)).toHaveAttribute("data-standing", "live", {
    timeout: 90_000,
  })
  await who.locator('[data-line="1"]').first().click()
  await expect.poll(() => inEditor(page)).toBe(true)
  await page.keyboard.press("End")
  await page.keyboard.type("!")
  await expect(who.getByRole("alert", { name: "Not saved" })).toHaveCount(0, {
    timeout: 30_000,
  })
  await expect
    .poll(() => readFileSync(arc!.disk(join(there, "who.txt")), "utf8"))
    .toBe("arc kept!\n")
})

test("paths: a path in arc's reply is found by arc, opens arc's file at its line, and the menu offers no app of this computer's", async () => {
  const { page, thread, composer, there, here } = await onArc({
    "src/long.ts": LONG,
  })
  const long = join(there, "src/long.ts")
  // What the system would open, or show in its folder.
  await window!.app.evaluate(({ shell }) => {
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
    window!.app.evaluate(() => (globalThis as { outside?: string[] }).outside)
  const clipboard = () =>
    window!.app.evaluate(({ clipboard }) => clipboard.readText())

  // A line in the reply: one only arc has, one only this machine has, one
  // neither has, one each has, and a link to a line.
  await composer.fill(
    "See `src/long.ts:12`, `only-mac.txt:1`, `gone.txt:1`, also src/util.ts in prose, and [the notes](notes.md#L2)."
  )
  await composer.press("Enter")
  const chip = pathOf(thread, "code")
  await expect(chip).toHaveText("src/long.ts:12")
  await expect(chip).toHaveAttribute("data-file", long)
  // The hint names no app: Ctrl does nothing more here.
  await expect(chip).toHaveAttribute(
    "title",
    `${long}:12\nClick to open in Banda`
  )
  await expect(chip.locator("[data-folder]")).toHaveText("src/")
  // Dragged out, its file:// URL would name this machine's file.
  await expect(chip).toHaveAttribute("draggable", "false")
  // A file only this machine has is no link, however the two share a path.
  const reply = thread.locator("[data-quotable]").last()
  await expect(reply.getByText("only-mac.txt")).toBeVisible()
  await expect(reply.getByText("gone.txt")).toBeVisible()
  await expect(reply.locator("a[data-file]")).toHaveCount(3)
  const prose = pathOf(thread, "text")
  await expect(prose).toHaveText("src/util.ts")
  await expect(prose).toHaveAttribute("data-file", join(there, "src/util.ts"))
  await expect(pathOf(thread, "named")).toHaveText("the notes(notes.md)")

  // A click: arc's file beside the Thread, at its line, named on arc.
  await chip.click()
  const file = page.getByRole("region", { name: "long.ts", exact: true })
  await expect(file.locator("[data-lit-line]")).toHaveAttribute(
    "data-lit-line",
    "12"
  )
  await expect(file.locator('[data-line="12"]').first()).toHaveText(
    "export const line12 = 12"
  )
  await expect(file.locator("[data-machine-icon]").first()).toBeVisible()
  // The picture comes at once, as the file has just opened at its line
  // (its band does not stay yet, #1487).
  await shot(page, "path-in-arc-reply", { toasts: true })

  // Ctrl+click: another machine's file has no app here, so it opens in
  // Banda too.
  await prose.click({ modifiers: ["Control"] })
  const util = page.getByRole("region", { name: "util.ts", exact: true })
  await expect(util.locator('[data-line="1"]').first()).toHaveText(
    "export const one = 1"
  )
  expect(await outside()).toEqual([])

  // Its menu: what reaches this computer is not offered.
  const menu = page.getByRole("menu", { name: "Thread" })
  await chip.click({ button: "right" })
  await expect(menu.getByRole("menuitem")).toHaveText([
    "Open in Banda",
    "Quick Look",
    "Copy full path",
    "Copy relative path",
    "Add to message",
  ])
  await shot(page, "path-menu-on-arc", { toasts: true })
  await menu.getByRole("menuitem", { name: "Quick Look" }).click()
  const peek = page.locator("[data-peek]")
  await expect(peek).toHaveAttribute("aria-label", "Quick Look: long.ts")
  await expect(peek.getByText("export const line1 = 1").first()).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(peek).toBeHidden()
  await chip.click({ button: "right" })
  await menu.getByRole("menuitem", { name: "Copy relative path" }).click()
  await expect.poll(clipboard).toBe("src/long.ts:12")
  await expect(menu).toBeHidden()
  await chip.click({ button: "right" })
  await menu.getByRole("menuitem", { name: "Add to message" }).click()
  await expect(composer).toContainText("long.ts")

  // A file gone from arc since says so, in arc's words.
  rmSync(arc!.disk(long))
  await chip.click()
  await expect(page.getByText(`No such file: ${long}`)).toBeVisible()

  // The window never read the path on this machine.
  expect(existsSync(join(here, "src/long.ts"))).toBe(false)
})

test("links: a reply's public link opens in this device's browser, and arc's localhost says it is arc's", async () => {
  const { page, thread, composer } = await onArc()
  await window!.app.evaluate(({ shell }) => {
    const opened: string[] = []
    ;(globalThis as { linkOpens?: string[] }).linkOpens = opened
    shell.openExternal = async (url) => {
      opened.push(url)
    }
  })
  const opens = () =>
    window!.app.evaluate(
      () => (globalThis as { linkOpens?: string[] }).linkOpens
    )
  await composer.fill(
    "See [the site](https://example.com/page) and [its server](http://localhost:3000/)."
  )
  await composer.press("Enter")
  const site = thread.getByRole("link", { name: "the site" })
  await expect(site).toHaveAttribute("title", /\nOpens in /)
  // The browser module does not run on arc, so the menu opens it here.
  const menu = page.getByRole("menu", { name: "Thread" })
  await site.click({ button: "right" })
  await expect(menu.getByRole("menuitem")).toHaveText([
    /^Open in this .+'s browser$/,
    "Copy address",
  ])
  await shot(page, "link-menu-on-arc", { toasts: true })
  await page.keyboard.press("Escape")
  await site.click()
  await expect.poll(opens).toEqual(["https://example.com/page"])

  const server = thread.getByRole("link", { name: "its server" })
  await expect(server).toHaveAttribute("title", "localhost:3000 is arc's")
  // The menu promises nothing it will refuse: the address, to copy.
  await server.click({ button: "right" })
  await expect(menu.getByRole("menuitem")).toHaveText(["Copy address"])
  await expect(menu.getByRole("separator")).toHaveCount(0)
  await shot(page, "localhost-menu-on-arc", { toasts: true })
  await page.keyboard.press("Escape")
  await server.click()
  const toast = page
    .getByRole("region", { name: "Notifications" })
    .getByRole("listitem")
    .filter({ hasText: "localhost:3000 is arc's" })
  await expect(toast).toBeVisible()
  await expect(toast).toContainText("It opens here once port forwarding comes.")
  await shot(page, "localhost-on-arc-refused", { toasts: true })
  expect(await opens()).toEqual(["https://example.com/page"])
})

/** Two grey PNGs, told apart by their sizes. */
const PNG_3X2 =
  "iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAADklEQVR4nGNogAEGOAsAWhQJAbISPYcAAAAASUVORK5CYII="
const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNoaGgAAAMEAYFL09IQAAAAAElFTkSuQmCC"
