/**
 * A Thread moves to a Project on another machine, and the Window carries
 * it (ADR 0116), on arc.ts's arc, 40 ms away a round trip. The Person
 * works on this machine, in a repository with a commit never pushed and
 * changes not committed; "Move to Project" on the Thread's card lists
 * arc's Project under arc, and it opens "Move Thread", which says what
 * goes and what stays, and takes a message for the Agent there. The Thread then
 * is arc's: its card, its Pane, its Agent, which goes on with the
 * message; and arc's folder is as this machine's was, on the same branch
 * and commit with the same changes not committed. A folder on arc with
 * changes of its own refuses the move before anything is carried. A
 * Project of this machine takes the Thread at once, from the same
 * dialog. With BANDA_E2E_SHOTS set to a folder, it leaves pictures of
 * what it checks.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { expect, type Page, test } from "@playwright/test"
import { type Arc, newArc, put, SHOTS, shot, withArc } from "./arc"
import { git, sidebarOf, toastsOf, type Window } from "./window"

let window: Window | undefined
let arc: Arc | undefined
let stopArc: (() => Promise<void>) | undefined

test.afterEach(async () => {
  await window?.close()
  await stopArc?.()
  arc?.close()
  window = arc = stopArc = undefined
})

/** The Thread the Person moves, started on this machine. */
const TITLE = "Release feed for the engine"

/** arc's part of the sidebar: its label and what it holds. */
const arcOf = (page: Page) =>
  sidebarOf(page).getByRole("group", { name: "arc", exact: true })

/** A Project's Threads, each its title and how its latest turn stands,
 * as the engine `banda` reaches lists them. */
function threadsOf(banda: (...args: string[]) => string, project: string) {
  const { ok } = JSON.parse(
    banda("call", "agents.threads", "--project", project)
  ) as { ok: { threads: { title: string; latest?: { state: string } }[] } }
  return ok.threads.map(({ title, latest }) => [title, latest?.state])
}

/**
 * The same repository on both machines, as far as `main`: "banda" here,
 * where the work went on, on `feat/feed` with a commit never pushed, a
 * file changed and a new one; and "banda" on arc, clean. This machine
 * has "notes" too, a folder with no git. A Thread done in this machine's
 * "banda", open in the window, which reaches arc.
 */
async function onBoth() {
  arc = newArc({ latency: 40 })
  stopArc = await arc.start()
  const here = join(arc.code.here, "banda")
  const there = join(arc.code.arc, "banda")
  put(here, { "feed.txt": "one\n", "README.md": "banda\n" })
  git(here, "init", "-q", "-b", "main")
  git(here, "config", "user.name", "Roma")
  git(here, "config", "user.email", "roma@banda.so")
  git(here, "add", "-A")
  git(here, "commit", "-qm", "First")
  git(arc.code.here, "clone", "-q", here, arc.disk(there))
  // The work that went on here since.
  git(here, "switch", "-qc", "feat/feed")
  put(here, { "feed.txt": "one\ntwo\n" })
  git(here, "commit", "-qam", "Never pushed")
  put(here, { "feed.txt": "one\ntwo\nthree\n", "notes.txt": "new\n" })
  const theirs = JSON.parse(arc.banda("project", "add", there)).ok.id as string
  window = await withArc(arc)
  const { page } = window
  const ours = JSON.parse(window.banda("project", "add", here)).ok.id as string
  const notes = join(arc.code.here, "notes")
  put(notes, { "today.md": "notes\n" })
  const beside = JSON.parse(window.banda("project", "add", notes)).ok
    .id as string
  window.banda(
    "call",
    "agents.send",
    "--project",
    ours,
    "--params",
    JSON.stringify({ harness: "fake", text: TITLE, settings: null })
  )
  await expect
    .poll(() => threadsOf(window!.banda, ours))
    .toEqual([[TITLE, "done"]])
  const card = sidebarOf(page).getByText(TITLE)
  await card.click()
  const thread = page.getByRole("region", { name: TITLE, exact: true })
  await expect(thread.getByText(`You said: ${TITLE}`)).toBeVisible()
  return {
    page,
    card,
    thread,
    here,
    there: arc.disk(there),
    ours,
    theirs,
    beside,
  }
}

/** The card's "Move to Project", open: this machine's other Projects,
 * then arc's under arc. */
async function movesOf(page: Page) {
  await sidebarOf(page)
    .getByRole("option", { name: new RegExp(`^${TITLE}`) })
    .click({ button: "right" })
  const menu = page.getByRole("menu", { name: "Thread menu" })
  await menu.getByRole("menuitem", { name: "Move to Project" }).click()
  const moves = page.getByRole("menu").last()
  // Each with its sign before its name.
  await expect(moves.getByRole("menuitem")).toHaveText([/notes$/, /banda$/])
  // arc's Project is under arc's name.
  await expect(moves.getByRole("group")).toContainText("arc")
  return moves
}

/** "Move Thread", opened for arc's Project from the Thread's card. */
async function moveToArc(page: Page) {
  const moves = await movesOf(page)
  // The pointer stays in the submenu, which closes as it leaves.
  const box = (await moves.boundingBox())!
  await shot(page, "move-0-card-menu", {
    at: { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  })
  await moves.getByRole("menuitem", { name: /banda$/ }).click()
  const dialog = page.getByRole("dialog", { name: "Move Thread" })
  await expect(dialog).toBeVisible()
  // It opens with arc's Project picked.
  await expect(
    dialog.getByRole("option", { name: "banda, arc" })
  ).toHaveAttribute("aria-selected", "true")
  return dialog
}

test("a Thread moves to arc's Project with its folder's work, its Agent goes on there with the message, and arc's folder is as this one was", async () => {
  test.setTimeout(SHOTS ? 300_000 : 180_000)
  const { page, here, there, ours, theirs } = await onBoth()
  const was = git(here, "status", "--porcelain")
  const head = git(here, "rev-parse", "HEAD")

  const dialog = await moveToArc(page)
  // It lists this machine's other Project first, then arc's under arc,
  // and not the one the Thread is in.
  const places = dialog.getByRole("option")
  await expect(places).toHaveCount(2)
  await expect(places.nth(0)).toHaveAccessibleName(/^notes, /)
  await expect(places.nth(1)).toHaveAccessibleName("banda, arc")
  await expect(dialog.getByRole("listbox")).toContainText("arc")
  const move = dialog.getByRole("button", { name: /^Move/ })
  // What goes, as both folders say it: the branch and its work.
  await expect(dialog).toContainText(
    "The whole conversation, with its images and Visuals."
  )
  await expect(dialog).toContainText("feat/feed")
  await expect(dialog).toContainText("with 2 files not committed.")
  await expect(dialog).toContainText(/Ignored files stay on \S+\./)
  await expect(move).toHaveText("Move")
  await shot(page, "move-1-dialog")

  // A message for the Agent there: the work goes on, on arc.
  const message = dialog.getByRole("textbox")
  await expect(message).toHaveAttribute(
    "placeholder",
    "Write to Fake AI on arc, to go on there…"
  )
  await message.fill("go on there")
  await expect(move).toHaveText("Move and send")
  await shot(page, "move-2-message")
  await move.click()
  await expect(dialog).toBeHidden()
  await expect(toastsOf(page)).toContainText("Moved to banda on arc")
  await shot(page, "move-3-moved", { toasts: true })

  // It is arc's now: there whole, and here no more.
  await expect.poll(() => threadsOf(window!.banda, ours)).toEqual([])
  await expect
    .poll(() => threadsOf(arc!.banda, theirs).map(([title]) => title))
    .toEqual([TITLE])
  await expect(arcOf(page).getByText(TITLE)).toBeVisible()
  // Its Pane shows it on arc, with the line of its move, and its Agent
  // went on with the message, handed the Thread's history.
  const thread = page.getByRole("region", { name: TITLE, exact: true })
  // What it said here came along, and its Agent on arc reads it too.
  await expect(
    thread.getByText(`You said: ${TITLE}`, { exact: true }).first()
  ).toBeVisible()
  await expect(thread).toContainText(/Moved here from “banda” on \S+\./)
  await expect(thread).toContainText("came with it")
  await expect(thread).toContainText("go on there")
  await expect
    .poll(() => threadsOf(arc!.banda, theirs))
    .toEqual([[TITLE, "done"]])

  // arc's folder is as this one was: the branch, the commit never
  // pushed, and the changes not committed; this one is not touched.
  expect(git(there, "symbolic-ref", "--short", "HEAD").trim()).toBe("feat/feed")
  expect(git(there, "rev-parse", "HEAD")).toBe(head)
  expect(git(there, "status", "--porcelain")).toBe(was)
  for (const name of ["feed.txt", "notes.txt"])
    expect(readFileSync(join(there, name), "utf8"), name).toBe(
      readFileSync(join(here, name), "utf8")
    )
  expect(git(here, "status", "--porcelain")).toBe(was)
  await shot(page, "move-4-on-arc")
})

test("a folder on arc with changes of its own refuses the move, and the Thread stays", async () => {
  test.setTimeout(SHOTS ? 300_000 : 180_000)
  const { page, there, ours, theirs } = await onBoth()
  put(there, { "feed.txt": "arc's own\n" })

  const dialog = await moveToArc(page)
  await expect(dialog).toContainText(
    "banda on arc has changes that are not committed: commit or stash them there, then move the Thread."
  )
  await expect(dialog.getByRole("button", { name: /^Move/ })).toBeDisabled()
  await shot(page, "move-5-refused")
  await dialog.getByRole("button", { name: "Cancel" }).click()
  await expect(dialog).toBeHidden()
  expect(threadsOf(window!.banda, ours)).toEqual([[TITLE, "done"]])
  expect(threadsOf(arc!.banda, theirs)).toEqual([])
  expect(readFileSync(join(there, "feed.txt"), "utf8")).toBe("arc's own\n")
})

test("Move to Project… in the Pane's Thread menu opens Move Thread, and a Project of this machine takes the Thread with the keys alone", async () => {
  test.setTimeout(SHOTS ? 300_000 : 180_000)
  const { page, thread: pane, here, ours, beside } = await onBoth()
  const was = git(here, "status", "--porcelain")

  // A click on the title of the focused Pane opens the Thread menu.
  await pane
    .locator("header")
    .getByRole("button", { name: TITLE, exact: true })
    .click()
  await page.getByRole("menuitem", { name: /Move to Project…/ }).click()
  const dialog = page.getByRole("dialog", { name: "Move Thread" })
  await expect(dialog).toBeVisible()
  // The first Project has the focus: Enter picks it, and Enter again
  // moves the Thread there.
  const notes = dialog.getByRole("option", { name: /^notes, / })
  await expect(notes).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(notes).toHaveAttribute("aria-selected", "true")
  await expect(dialog).toContainText(
    "Fake AI works in notes from now on. What it changed here stays in this folder."
  )
  // No message box: its Agent is the same, on the same machine.
  await expect(dialog.getByRole("textbox")).toHaveCount(0)
  await shot(page, "move-6-beside")
  await page.keyboard.press("Enter")
  await expect(dialog).toBeHidden()
  await expect(toastsOf(page)).toContainText("Moved to notes")

  await expect.poll(() => threadsOf(window!.banda, ours)).toEqual([])
  expect(threadsOf(window!.banda, beside)).toEqual([[TITLE, "done"]])
  // Its Pane shows it in notes, and the folder it left is as it was.
  const thread = page.getByRole("region", { name: TITLE, exact: true })
  await expect(thread).toContainText("Moved here from “banda”.")
  expect(git(here, "status", "--porcelain")).toBe(was)
})
