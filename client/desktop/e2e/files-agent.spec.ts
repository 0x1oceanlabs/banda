import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { expect, type Locator, test } from "@playwright/test"
import { firstThread, git, startWindow, type Window } from "./window"

let window: Window

test.afterEach(async () => {
  await window?.close()
})

/** Writes `text` at `path` under `folder`, its folders first. */
function put(folder: string, path: string, text: string) {
  mkdirSync(join(folder, path, ".."), { recursive: true })
  writeFileSync(join(folder, path), text)
}

/** The animation a row wears: `banda-pulse` while an Agent works on its
 * file. */
function pulseOf(row: Locator): Promise<string> {
  return row.evaluate((element) => getComputedStyle(element).animationName)
}

/** The turn's quiet dot on a row: a file's, or a folder's alone or beside
 * git's. */
const TURN_DOT =
  'svg[data-icon-name="banda-tree-turn"], svg[data-icon-name="banda-tree-both"]'

test("the file an Agent works on pulses on the tree, Follow takes the tree and the file there, the turn's files keep a dot, and a comment on lines goes to the Thread", async () => {
  window = await startWindow()
  const { page, dir } = window
  const { thread, composer } = await firstThread(page)
  const project = join(dir, "root", "Work")
  put(project, "notes.md", "one\ntwo\nthree\n")
  put(project, "src/util.ts", "export const one = 1\nexport const two = 2\n")
  put(project, "README.md", "# Work\n")
  git(project, "init", "-q", "-b", "main")
  git(project, "add", "-A")
  git(project, "commit", "-qm", "First")

  // The Thread first, as Files opens from it and is with it.
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
  await expect(row("util.ts")).toBeVisible()
  // A file opened beside it: the one Follow moves.
  await row("README.md").dblclick()
  const readme = page.getByRole("region", { name: "README.md", exact: true })
  await expect(readme).toBeVisible()

  // Follow is off at first, and kept with the Pane once on.
  const follow = pane.getByRole("button", { name: "Follow the Agent" })
  await expect(follow).toHaveAttribute("aria-pressed", "false")
  await follow.click()
  await expect(follow).toHaveAttribute("aria-pressed", "true")
  await expect(pane.getByRole("status", { name: "Follow" })).toHaveText(
    "Following the Agent"
  )

  // The turn reads notes.md at its line 2: the row pulses, and Follow
  // picks it and takes the file there.
  await composer.click()
  await composer.fill("walk the files")
  await composer.press("Enter")
  await expect(thread.getByText("Read notes.md")).toBeVisible()
  await expect.poll(() => pulseOf(row("notes.md"))).toBe("banda-pulse")
  await expect(row("notes.md")).toHaveAttribute("aria-selected", "true")
  const notes = page.getByRole("region", { name: "notes.md", exact: true })
  await expect(notes).toBeVisible()
  await expect(readme).toHaveCount(0)
  await page.screenshot({ path: "test-results/files-agent-read.png" })

  // It edits src/util.ts at its line 2: the pulse goes there, and Follow
  // with it, the line lit.
  await composer.fill("go on")
  await composer.press("Enter")
  await expect(
    thread.getByRole("button", { name: /^Edited src\/util\.ts/ })
  ).toBeVisible()
  await expect.poll(() => pulseOf(row("util.ts"))).toBe("banda-pulse")
  await expect.poll(() => pulseOf(row("notes.md"))).toBe("none")
  await expect(row("util.ts")).toHaveAttribute("aria-selected", "true")
  const util = page.getByRole("region", { name: "util.ts", exact: true })
  await expect(util.locator("[data-lit-line]")).toHaveAttribute(
    "data-lit-line",
    "2"
  )
  await expect(notes).toHaveCount(0)
  await page.screenshot({ path: "test-results/files-agent-follow.png" })

  // The turn ends: nothing pulses, Follow stays on, and what the turn
  // changed has its dot, and so has its folder.
  await composer.fill("done")
  await composer.press("Enter")
  await expect(thread.getByText("I walked the files.")).toBeVisible()
  await expect.poll(() => pulseOf(row("util.ts"))).toBe("none")
  await expect(follow).toHaveAttribute("aria-pressed", "true")
  await expect(row("util.ts").locator(TURN_DOT)).toHaveCount(1)
  await expect(row("src").locator(TURN_DOT)).toHaveCount(1)
  await expect(row("notes.md").locator(TURN_DOT)).toHaveCount(0)
  await expect(row("README.md").locator(TURN_DOT)).toHaveCount(0)
  await page.screenshot({ path: "test-results/files-agent-dots.png" })

  // Lines picked in the file take a comment, under them; it goes into the
  // Thread's message as a chip, which can be taken out before it goes.
  const comment = async (words: string) => {
    await util.locator('[data-column-number="2"]').first().click()
    await util
      .locator('[data-column-number="3"]')
      .first()
      .click({ modifiers: ["Shift"] })
    await util.getByRole("button", { name: "Add a comment…" }).click()
    const field = util.getByRole("textbox", { name: "Comment on lines 2–3" })
    await expect(field).toBeFocused()
    await field.fill(words)
    await page.screenshot({ path: "test-results/files-agent-comment.png" })
    await util.getByRole("button", { name: "Comment", exact: true }).click()
  }
  const chips = thread.getByRole("list", { name: "Comments" })
  await comment("Not this one")
  await expect(chips.getByRole("listitem")).toHaveText(
    /util\.ts:2-3\s*Not this one/
  )
  await chips
    .getByRole("button", { name: "Remove the comment on util.ts:2-3" })
    .click()
  await expect(chips).toBeHidden()
  await comment("Why two lines?")
  await expect(chips.getByRole("listitem")).toHaveText(
    /util\.ts:2-3\s*Why two lines\?/
  )
  await page.screenshot({ path: "test-results/files-agent-chip.png" })

  // Sent, the chip is text the Agent reads: where, the lines as they read,
  // and the words. The fake agent says it back.
  await composer.fill("Look here.")
  await composer.press("Enter")
  await expect(chips).toBeHidden()
  const reply = thread.getByText("Comment on src/util.ts:2-3:").last()
  await expect(reply).toBeVisible()
  await expect(thread).toContainText("You said: Look here.")
  await expect(thread.getByText("export const three = 3").last()).toBeVisible()
  await expect(thread.getByText("Why two lines?").last()).toBeVisible()
})
