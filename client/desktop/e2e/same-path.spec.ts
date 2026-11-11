/**
 * The same path on two machines (ADR 0106, law 3: an act runs where its
 * values live). arc and this machine each have a Project "Same" in
 * `code/Same`; where the system lets arc have a mount namespace of its
 * own (arc.ts), both name it by one path, as ~/code/banda is on Roma's
 * two machines. There arc's who.txt says "arc" and this machine's says
 * "mac", so every road from arc's Thread must end at "arc": a window that
 * reads this machine's file for arc's reads "mac", and one that asks this
 * machine's engine for arc's finds nothing. Without the namespace, as on
 * devbox, arc's Project is only in arc's folders and only the second is
 * caught; ci.yml's `same-path` job runs this spec where both are.
 *
 * The roads that work today are tests: arc's Agent reads and writes its
 * own disk, and @ in its Message box finds arc's files. Those a later step
 * of the plan opens are `test.fixme`, each naming the step that turns it
 * on. arc is 40 ms away a round trip, as a machine across a network is,
 * and its link can go into a black hole: an act sent there waits for no
 * answer until ssh gives up, and is never left hanging. What a gesture
 * asks arc is counted on its link, one call a gesture.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { connect } from "node:net"
import { join } from "node:path"
import { expect, type Locator, type Page, test } from "@playwright/test"
import { type Arc, newArc, put, SHOTS, shot, withArc } from "./arc"
import { agentSays, git, read, type Window } from "./window"

let window: Window | undefined
let arc: Arc | undefined
let stopArc: (() => Promise<void>) | undefined

test.afterEach(async () => {
  await window?.close()
  await stopArc?.()
  arc?.close()
  window = arc = stopArc = undefined
})

/** The title of arc's Thread in "Same". */
const TITLE = "Bench same path"

/** arc's part of the sidebar: its label and what it holds. */
const arcOf = (page: Page) =>
  page
    .getByRole("complementary", { name: "Sidebar" })
    .getByRole("group", { name: "arc", exact: true })

/**
 * "Same" on both machines, each with its own who.txt and a file only it
 * has, and arc's with a Thread done, open in the window from arc's part
 * of the sidebar. arc's engine runs apart from the window's ssh, so a
 * link that goes leaves it working. Each Project's folder, as its machine
 * names it.
 */
async function opened({
  latency = 40,
  files = {},
}: { latency?: number; files?: Record<string, string> } = {}) {
  arc = newArc({ latency })
  stopArc = await arc.start()
  const there = join(arc.code.arc, "Same")
  const here = join(arc.code.here, "Same")
  put(arc.disk(there), {
    "who.txt": "arc\n",
    "only-arc.txt": "arc\n",
    "notes.md": "arc\n",
    ...files,
  })
  put(here, {
    "who.txt": "mac\n",
    "only-mac.txt": "mac\n",
    "notes.md": "mac\n",
  })
  const project = JSON.parse(arc.banda("project", "add", there)).ok.id as string
  arc.send(project, TITLE)
  await expect.poll(() => arc!.states(project)).toEqual([[TITLE, "done"]])
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

test("arc's Agent reads who.txt from arc's disk: arc, though this machine's at the same path says mac", async () => {
  const { thread, composer, there, here } = await opened()
  // Where the namespace holds, one path names both machines' Projects.
  expect(there === here).toBe(arc!.samePath)
  await composer.fill("cat who.txt")
  await composer.press("Enter")
  await expect(thread.getByText("who.txt holds arc.")).toBeVisible()
  await expect(thread.getByText("who.txt holds mac.")).toHaveCount(0)
})

test("@ in arc's Message box finds arc's files, not this machine's at the same path, and its chip names arc's file to arc's Agent", async () => {
  const { page, thread, composer } = await opened()
  await composer.fill("cat @only")
  const files = page.getByRole("listbox", { name: "Files" })
  await expect(files.getByRole("option")).toHaveCount(1)
  await expect(files.getByRole("option")).toContainText("only-arc.txt")
  await composer.press("Enter")
  await expect(composer.locator("[data-chip=file]")).toHaveText("only-arc.txt")
  await composer.press("Enter")
  await expect(thread.getByText("only-arc.txt holds arc.")).toBeVisible()
})

test("arc's Agent writes on arc's disk: this machine's files at the same path stay as they were", async () => {
  const { thread, composer, there, here } = await opened()
  await composer.fill("on disk")
  await composer.press("Enter")
  await expect(
    thread.getByText("I edited notes.md and ran a script.")
  ).toBeVisible()
  expect(readFileSync(arc!.disk(join(there, "notes.md")), "utf8")).toBe(
    "one\n2\nthree\n"
  )
  expect(existsSync(arc!.disk(join(there, "made.txt")))).toBe(true)
  expect(readFileSync(join(here, "notes.md"), "utf8")).toBe("mac\n")
  expect(existsSync(join(here, "made.txt"))).toBe(false)
})

/** How long `port` on loopback takes to say its first byte to an HTTP
 * request, in ms. */
function firstByte(port: number): Promise<number> {
  return new Promise((done, failed) => {
    const socket = connect(port, "127.0.0.1", () => {
      const sent = performance.now()
      socket.once("data", () => {
        done(performance.now() - sent)
        socket.destroy()
      })
      socket.write("GET / HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n")
    })
    socket.on("error", failed)
  })
}

test("arc is as far as its latency: each round trip through its link waits that long, and its Thread hears it that much later", async () => {
  const { thread, composer } = await opened()
  // 40 ms each round trip through the forward; arc's engine itself
  // answers on loopback.
  expect(await firstByte(arc!.ports().from)).toBeGreaterThanOrEqual(40)
  // Farther now, once the forward applies it: what arc's Agent replies
  // is heard a round trip after the message went, at least.
  arc!.latency(800)
  await expect.poll(() => arc!.applies()?.latency).toBe(800)
  await composer.fill("cat who.txt")
  const sent = Date.now()
  await composer.press("Enter")
  await expect(thread.getByText("who.txt holds arc.")).toBeVisible()
  expect(Date.now() - sent).toBeGreaterThanOrEqual(800)
})

test("a gesture in arc's Message box asks arc one call: @'s search one files.find, and Send its message, with nothing asked before it", async () => {
  // One round trip a gesture (ADR 0106, the budget), counted by what
  // the window asks through arc's link. The seen marks a key in the
  // Thread makes (agents.read) are acts of their own.
  const { page, thread, composer } = await opened()
  const calls = (since: number) =>
    arc!
      .asked()
      .slice(since)
      .flatMap(({ method }) =>
        method && method !== "agents.read" ? [method] : []
      )
  let since = arc!.asked().length
  await composer.fill("cat @only")
  await expect(
    page.getByRole("listbox", { name: "Files" }).getByRole("option")
  ).toContainText("only-arc.txt")
  expect(calls(since)).toEqual(["files.find"])
  await composer.press("Escape")
  await composer.fill("cat who.txt")
  since = arc!.asked().length
  await composer.press("Enter")
  await expect(thread.getByText("who.txt holds arc.")).toBeVisible()
  expect(calls(since)).toEqual(["agents.send"])
})

test("arc in a black hole: Stop sent into it waits for no answer, then says what became of it once arc is away; the next is refused at once, and nothing lands there later", async () => {
  // ssh gives up on a silent link in about 20 s (hosts.ts's QUICK), and
  // comes back after its waits.
  test.setTimeout(180_000)
  const { page, thread, composer, project } = await opened()
  const toasts = page
    .getByRole("region", { name: "Notifications" })
    .getByRole("listitem")
  const stop = thread.getByRole("button", { name: "Stop", exact: true })
  const runs = () => expect(arc!.states(project)).toEqual([[TITLE, "running"]])
  await composer.fill("wait for it")
  await composer.press("Enter")
  await expect(thread.getByText("Waiting.")).toBeVisible()

  // Nothing comes back from a black hole, not even a reset: the window
  // learns arc is gone only as ssh gives up, or as nothing answers a
  // ping. Stop was sent, or held back to ask first: either way it ends
  // in words, and never reached arc.
  arc!.blackhole(true)
  await expect.poll(() => arc!.applies()?.hole).toBe(true)
  const since = arc!.asked().length
  await stop.click()
  // For a while the window cannot tell: no word of Stop, and arc not
  // away, as a reset would have it at once.
  await page.waitForTimeout(1_500)
  await expect(toasts.filter({ hasText: "Stop" })).toHaveCount(0)
  await expect(arcOf(page).getByText(/^away/)).toHaveCount(0)
  const told = toasts.filter({
    hasText:
      /arc (went away; Stop may have gone through|is away: Stop was not sent)\./,
  })
  await expect(told).toBeVisible({ timeout: 60_000 })
  // Which words are true is whether Stop went onto arc's link.
  const sent = arc!
    .asked()
    .slice(since)
    .some(({ method }) => method === "agents.stop")
  await expect(told).toContainText(
    sent ? "went away; Stop may have gone through" : "Stop was not sent"
  )
  await expect(arcOf(page).getByText(/^away/)).toBeVisible()
  runs()
  // Pressed while arc is away, it is refused at once.
  const refused = toasts.filter({ hasText: "arc is away: Stop was not sent." })
  const before = await refused.count()
  await stop.click()
  await expect(refused).toHaveCount(before + 1, { timeout: 2_000 })
  await expect(stop).toBeEnabled()

  // Out of the hole, and heard again: what went into it, and what was
  // refused, never lands there by itself.
  arc!.blackhole(false)
  await expect(arcOf(page).getByText(/^away/)).toHaveCount(0, {
    timeout: 90_000,
  })
  for (const until = Date.now() + 5_000; Date.now() < until;) {
    runs()
    await page.waitForTimeout(250)
  }
  await stop.click()
  await expect.poll(() => arc!.states(project)).toEqual([[TITLE, "stopped"]])
})

// The roads later steps open (ADR 0106, the plan). Each ends at arc's
// file, and turns on with the step it names (#1270): until then the window
// says "Not on arc yet", or offers nothing, as hosts.spec.ts checks.

/** A terminal on arc's "Same", from New Pane in arc's Thread; its screen,
 * running. */
async function terminalOn(page: Page, composer: Locator) {
  await composer.focus()
  await page.keyboard.press("Alt+KeyN")
  await page
    .getByRole("region", { name: "New Pane" })
    .getByRole("button", { name: "Terminal" })
    .click()
  const screen = page.getByRole("region", { name: "Terminal screen" })
  await expect(screen).toHaveAttribute("data-state", "running")
  return screen
}

test("step 1b: arc's terminal runs on arc, where `cat who.txt` prints arc", async () => {
  const { page, composer, there, here } = await opened()
  await terminalOn(page, composer)
  await page.keyboard.type("cat who.txt > seen.txt")
  await page.keyboard.press("Enter")
  await expect
    .poll(() => read(arc!.disk(join(there, "seen.txt"))))
    .toBe("arc\n")
  expect(existsSync(join(here, "seen.txt"))).toBe(false)
})

test("Run on a line in arc's reply runs it in arc's terminal", async () => {
  const { page, thread, composer, there, here } = await opened()
  await composer.fill("Some code:\n\n```sh\ncat who.txt > ran.txt\n```")
  await composer.press("Enter")
  await thread
    .locator("[data-quotable] [data-streamdown=code-block]")
    .getByRole("button", { name: "Run", exact: true })
    .click()
  await expect(
    page.getByRole("region", { name: "Terminal screen" })
  ).toHaveAttribute("data-state", "running")
  await expect.poll(() => read(arc!.disk(join(there, "ran.txt")))).toBe("arc\n")
  expect(existsSync(join(here, "ran.txt"))).toBe(false)
})

test("arc's Diff shows arc's change to who.txt, not this machine's at the same path", async () => {
  const { page, composer, there, here } = await opened()
  for (const [folder, now] of [
    [arc!.disk(there), "arc changed\n"],
    [here, "mac changed\n"],
  ] as const) {
    git(folder, "init", "-q", "-b", "main")
    git(folder, "add", "-A")
    git(folder, "commit", "-qm", "First")
    put(folder, { "who.txt": now })
  }
  await composer.click()
  await page.keyboard.press("Alt+KeyD")
  const diff = page.getByRole("region", { name: "Diff" })
  await diff.getByRole("button", { name: "Expand all files" }).click()
  await expect(diff.getByText("arc changed")).toBeVisible()
  await expect(diff.getByText("mac changed")).toHaveCount(0)
})

test("Quick Look on arc's file from the Banda menu shows arc's who.txt", async () => {
  const { page, composer } = await opened()
  await composer.focus()
  await page.keyboard.press("Alt+Space")
  const menu = page.getByRole("dialog", { name: "Banda menu" })
  const search = menu.getByRole("combobox", { name: "Search" })
  await search.fill("who.txt")
  await expect(menu.getByRole("option").first()).toContainText("who.txt")
  await search.press("Tab")
  await menu
    .getByRole("listbox", { name: "Actions" })
    .getByRole("option", { name: "Quick Look" })
    .click()
  const peek = page.locator("[data-peek]")
  await expect(peek).toHaveAttribute("aria-label", "Quick Look: who.txt")
  await expect(peek.getByText("arc", { exact: true })).toBeVisible()
  await expect(peek.getByText("mac", { exact: true })).toHaveCount(0)
})

/** A key that shows arc's `file` in Quick Look, as a line of keys.toml
 * says, the file and its Project named: on arc, no gesture reaches the
 * action yet, Files' tree and reply paths coming with 3b and 3c. */
const QUICK_LOOK = "Control+Alt+KeyH"

async function bindQuickLook(file: string, project: string) {
  writeFileSync(
    join(window!.dir, "config/keys.toml"),
    `[binds]\n"Ctrl+Alt+H" = { action = "file.peek", args = { file = ${JSON.stringify(file)}, project = ${JSON.stringify(project)} } }\n`
  )
}

test("quick-look: a file of arc's shows in Quick Look naming arc; a file gone from arc, or arc away, is refused at once", async () => {
  test.setTimeout(SHOTS ? 300_000 : 180_000)
  const { page, composer, project, there } = await opened({
    files: { "kept/who.txt": "arc\n" },
  })
  const who = `${there}/kept/who.txt`
  await bindQuickLook(who, project)
  await composer.focus()
  const peek = page.locator("[data-peek]")
  // The key takes as keys.toml is read, a moment after it is written.
  await expect(async () => {
    await page.keyboard.press(QUICK_LOOK)
    await expect(peek).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 30_000 })
  await expect(peek).toHaveAttribute("aria-label", "Quick Look: who.txt")
  // Its header names arc, as an arc Pane's does.
  const header = peek.locator("header").first()
  await expect(header.getByText("arc", { exact: true })).toBeVisible()
  await expect(header.locator('[data-machine-icon="server"]')).toBeVisible()
  // Its folder is short, from arc's Project, and its body is arc's.
  await expect(header.getByText("kept", { exact: true })).toBeVisible()
  await expect(header).not.toContainText(there)
  await expect(peek.locator('[data-line="1"]').first()).toHaveText("arc")
  await shot(page, "quick-look-arc")
  await page.keyboard.press("Escape")
  await expect(peek).toHaveCount(0)

  // Gone on arc: arc's engine says so, whatever this machine has at that
  // path.
  rmSync(arc!.disk(who))
  const since = arc!.asked().length
  await page.keyboard.press(QUICK_LOOK)
  const notes = page.getByRole("region", { name: "Notifications" })
  await expect(notes.getByText(`No such file: ${who}`)).toBeVisible()
  await expect(peek).toHaveCount(0)
  // The check is one round trip to arc, whatever else arc is asked.
  expect(
    arc!
      .asked()
      .slice(since)
      .flatMap(({ method }) => (method?.startsWith("files.") ? [method] : []))
  ).toEqual(["files.stat"])

  // Away: refused at once in its pill's words, never shown later.
  arc!.blackhole(true)
  await expect(arcOf(page).getByText(/^away/)).toBeVisible({ timeout: 60_000 })
  await page.keyboard.press(QUICK_LOOK)
  await expect(notes.getByText("arc is away")).toBeVisible()
  await expect(peek).toHaveCount(0)
})

test("signs: arc's Project shows its own picture, read from arc's engine, in arc's part of the sidebar", async () => {
  const { page } = await opened({
    files: {
      "same.svg":
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="#2563eb"/></svg>',
    },
  })
  const picture = arcOf(page).locator('[data-sign="picture"] img')
  await expect(picture).toBeVisible()
  await expect(picture).toHaveAttribute("src", /^data:image\/svg/)
  await shot(page, "arc-sign")
})

/** arc's Files on "Same", from the Banda menu in arc's Thread; the Pane. */
async function filesOn(page: Page, composer: Locator) {
  await composer.focus()
  await page.keyboard.press("Alt+Space")
  const menu = page.getByRole("dialog", { name: "Banda menu" })
  await menu.getByRole("combobox", { name: "Search" }).fill("Files")
  await menu
    .getByRole("option", { name: /^Files/ })
    .first()
    .click()
  return page
    .locator("section")
    .filter({ has: page.getByRole("navigation", { name: "Places" }) })
}

test("arc's Files lists arc's files and opens who.txt as arc's", async () => {
  const { page, composer } = await opened()
  const pane = await filesOn(page, composer)
  const tree = pane.getByRole("tree")
  await expect(
    tree.getByRole("treeitem", { name: "only-arc.txt" })
  ).toBeVisible()
  await expect(
    tree.getByRole("treeitem", { name: "only-mac.txt" })
  ).toHaveCount(0)
  await tree.getByRole("treeitem", { name: "who.txt", exact: true }).click()
  await page.keyboard.press("Enter")
  const file = page.getByRole("region", { name: "who.txt", exact: true })
  await expect(file.locator('[data-line="1"]').first()).toHaveText("arc")
})

test("a row of arc's Files dragged into arc's Message box names arc's file to arc's Agent", async () => {
  const { page, thread, composer } = await opened()
  const pane = await filesOn(page, composer)
  await composer.fill("cat ")
  await pane
    .getByRole("tree")
    .getByRole("treeitem", { name: "only-arc.txt" })
    .dragTo(composer)
  await expect(composer.locator("[data-chip=file]")).toHaveText("only-arc.txt")
  await composer.press("Enter")
  await expect(thread.getByText("only-arc.txt holds arc.")).toBeVisible()
})

test.fixme("step 5b: a folder pinned in arc's Files opens arc's folder again", async () => {
  const { page, composer, there } = await opened()
  put(arc!.disk(there), { "kept/only-arc-kept.txt": "arc\n" })
  put(join(arc!.code.here, "Same"), { "kept/only-mac-kept.txt": "mac\n" })
  const pane = await filesOn(page, composer)
  const tree = pane.getByRole("tree")
  await tree.getByRole("treeitem", { name: "kept" }).click({ button: "right" })
  await page.getByRole("menuitem", { name: "Pin" }).click()
  await pane
    .getByRole("navigation", { name: "Places" })
    .getByRole("group", { name: "Pinned" })
    .getByRole("button", { name: "kept" })
    .click()
  await expect(
    tree.getByRole("treeitem", { name: "only-arc-kept.txt" })
  ).toBeVisible()
  await expect(
    tree.getByRole("treeitem", { name: "only-mac-kept.txt" })
  ).toHaveCount(0)
})

test("step 3c: a path in arc's reply opens arc's file", async () => {
  const { page, thread, composer } = await opened()
  await composer.fill("See `who.txt:1`.")
  await composer.press("Enter")
  const chip = thread.locator("[data-quotable] a[data-file]")
  await expect(chip).toHaveText("who.txt:1")
  await chip.click({ button: "right" })
  await page
    .getByRole("menu", { name: "Thread" })
    .getByRole("menuitem", { name: "Quick Look" })
    .click()
  const peek = page.locator("[data-peek]")
  await expect(peek.getByText("arc", { exact: true })).toBeVisible()
})

test("step 3c: a path arc's terminal prints opens arc's file", async () => {
  const { page, composer, there } = await opened()
  const screen = await terminalOn(page, composer)
  // The path on the first row, then the prompt.
  await page.keyboard.type("clear; printf './who.txt\\n'; : > printed")
  await page.keyboard.press("Enter")
  await expect.poll(() => read(arc!.disk(join(there, "printed")))).toBe("")
  // Under the pointer it is a link, once the shell has said where it is.
  const canvas = screen.locator("canvas").first()
  await canvas.hover({ position: { x: 24, y: 8 } })
  await expect(canvas).toHaveAttribute(
    "title",
    `${join(there, "who.txt")}\nClick to open in Banda`
  )
  await canvas.click({ button: "right", position: { x: 24, y: 8 } })
  await page
    .getByRole("menu", { name: "Terminal" })
    .getByRole("menuitem", { name: "Open in Banda" })
    .click()
  const file = page.getByRole("region", { name: "who.txt", exact: true })
  await expect(file.locator('[data-line="1"]').first()).toHaveText("arc")
})

test.fixme("step 4c: a picture in arc's reply is arc's", async () => {
  const { thread, composer, there, here } = await opened()
  // Each machine's who.png is its own size: arc's 3×2, this one's 1×1.
  writeFileSync(
    arc!.disk(join(there, "who.png")),
    Buffer.from(PNG_3X2, "base64")
  )
  writeFileSync(join(here, "who.png"), Buffer.from(PNG_1X1, "base64"))
  await composer.fill("![who](who.png)")
  await composer.press("Enter")
  const picture = thread.locator('[data-quotable] img[alt="who"]')
  await expect
    .poll(() =>
      picture.evaluate((image: HTMLImageElement) => image.naturalWidth)
    )
    .toBe(3)
})

test.fixme("step 4c: Quick Look previews arc's picture, not this machine's at the same path", async () => {
  const { page, composer, there, here } = await opened()
  writeFileSync(
    arc!.disk(join(there, "who.png")),
    Buffer.from(PNG_3X2, "base64")
  )
  writeFileSync(join(here, "who.png"), Buffer.from(PNG_1X1, "base64"))
  await composer.focus()
  await page.keyboard.press("Alt+Space")
  const menu = page.getByRole("dialog", { name: "Banda menu" })
  const search = menu.getByRole("combobox", { name: "Search" })
  await search.fill("who.png")
  await expect(menu.getByRole("option").first()).toContainText("who.png")
  await search.press("Tab")
  await menu
    .getByRole("listbox", { name: "Actions" })
    .getByRole("option", { name: "Quick Look" })
    .click()
  const picture = page.locator("[data-peek]").getByRole("img", {
    name: "who.png",
  })
  await expect
    .poll(() =>
      picture.evaluate((image: HTMLImageElement) => image.naturalWidth)
    )
    .toBe(3)
})

test("step 4d: a Visual arc's Agent shows is drawn in its Thread and in a Pane of its own, its page from arc's engine", async () => {
  const { page, thread, composer } = await opened()
  await composer.fill("wait")
  await composer.press("Enter")
  await expect(thread.getByText("Waiting.")).toBeVisible()
  // This machine's engine keeps no such Visual: the page is arc's.
  await agentSays({ dir: arc!.dir }, "show_visual", {
    html: '<p id="who">arc</p>',
    title: "Whose",
    height: 80,
  })
  const shown = thread.locator('iframe[title="Whose"]')
  await expect(shown.contentFrame().locator("#who")).toHaveText("arc")
  // Dressed as this machine's are: it wears the look.
  await expect(shown.contentFrame().locator("#banda-base")).toBeAttached()

  // As a Pane of its own, beside the Thread.
  await shown.hover()
  await thread.getByRole("button", { name: "Open as Pane" }).click()
  const frames = page.locator('iframe[title="Whose"]')
  await expect(frames).toHaveCount(2)
  await expect(frames.nth(1).contentFrame().locator("#who")).toHaveText("arc")
})

/** Two grey PNGs, told apart by their sizes. */
const PNG_3X2 =
  "iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAADklEQVR4nGNogAEGOAsAWhQJAbISPYcAAAAASUVORK5CYII="
const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNoaGgAAAMEAYFL09IQAAAAAElFTkSuQmCC"
