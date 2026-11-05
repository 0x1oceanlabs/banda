import { execFileSync } from "node:child_process"
import { chmodSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { expect, test } from "@playwright/test"
import { firstThread, setInFront, startWindow, type Window } from "./window"

let window: Window

test.afterEach(async () => {
  await window?.close()
})

/** Runs git in `folder`, as one who has no config of their own, and says
 * what it printed. */
function git(folder: string, ...args: string[]): string {
  return execFileSync("git", args, {
    encoding: "utf8",
    cwd: folder,
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "Roma",
      GIT_AUTHOR_EMAIL: "roma@banda.so",
      GIT_COMMITTER_NAME: "Roma",
      GIT_COMMITTER_EMAIL: "roma@banda.so",
    },
  })
}

test("the Diff shows a Space's changes by scope, as T3 Code's, and reads again as the window comes back", async () => {
  window = await startWindow()
  const { page, dir } = window
  await expect((await firstThread(page)).composer).toBeVisible()

  // The Space's folder: a branch off main with a commit, then work not
  // yet committed, one file of it staged and one new.
  const folder = join(dir, "root", "Work")
  git(folder, "init", "-q", "-b", "main")
  writeFileSync(
    join(folder, "app.ts"),
    "export const a = 1\nexport const b = 2\n"
  )
  git(folder, "add", "-A")
  git(folder, "commit", "-qm", "First")
  git(folder, "switch", "-qc", "feature")
  writeFileSync(
    join(folder, "app.ts"),
    "export const a = 1\nexport const b = 3\n"
  )
  git(folder, "commit", "-qam", "Make b three")
  writeFileSync(join(folder, "staged.ts"), "export const s = true\n")
  git(folder, "add", "staged.ts")
  writeFileSync(join(folder, "new.test.ts"), "test()\n")

  await page.keyboard.press("Alt+KeyN")
  const launcher = page.getByRole("region", { name: "New Pane" })
  await expect(launcher).toHaveAttribute("data-focused", "true")
  // The Diff is offered once the launcher knows the engine runs git.
  await expect(launcher.getByRole("button", { name: /Diff/ })).toBeVisible()
  await page.keyboard.press("KeyD")
  const diff = page.getByRole("region", { name: "Diff" })
  await expect(diff).toBeVisible()

  // Changes: the branch against main, uncommitted work too.
  const scope = diff.getByRole("button", { name: "Scope" })
  await expect(scope).toHaveText("Changes")
  await expect(diff.getByRole("button", { name: "Base" })).toHaveText("vs main")
  // Its header sums them: how many files, lines added and removed.
  await expect(diff.locator("header")).toContainText("3 files·+3−1")
  // A Pane this narrow has no tree, till the Person shows it.
  const tree = diff.getByRole("button", { name: "Show file tree" })
  await expect(tree).toHaveAttribute("aria-pressed", "false")
  await expect(diff.getByRole("button", { name: "Refresh" })).toBeVisible()
  await tree.click()
  const files = diff.getByRole("tree")
  // A file's header in the view, by its path.
  const header = (path: string) => diff.getByText(path, { exact: true })
  for (const path of ["app.ts", "staged.ts", "new.test.ts"])
    await expect(files.getByRole("treeitem", { name: path })).toBeVisible()
  // Files open folded, as T3 Code's; all of them open at once.
  await diff.getByRole("button", { name: "Expand all files" }).click()
  await expect(diff.getByText("export const b = 3")).toBeVisible()
  await page.screenshot({ path: "test-results/git-diff-changes.png" })
  await diff.getByRole("button", { name: "Split" }).click()
  await expect(diff.getByRole("button", { name: "Stacked" })).toBeVisible()
  await page.screenshot({ path: "test-results/git-diff-split.png" })

  // Staged: what a commit would take.
  await scope.click()
  await page.getByRole("menuitemradio", { name: /Staged/ }).click()
  await expect(scope).toHaveText("Staged")
  await expect(header("staged.ts")).toBeVisible()
  await expect(diff.getByText("app.ts")).toHaveCount(0)

  // A commit of the branch, from the submenu.
  await scope.click()
  await page.getByRole("menuitem", { name: "Commits" }).hover()
  await page.getByRole("menuitem", { name: /Make b three/ }).click()
  await expect(scope).toHaveText("Make b three")
  await expect(header("app.ts")).toBeVisible()
  await expect(diff.getByText("staged.ts")).toHaveCount(0)
  await page.screenshot({ path: "test-results/git-diff-commit.png" })

  // Uncommitted, tests hidden; then a file written outside shows as the
  // window comes back.
  await scope.click()
  await page.getByRole("menuitemradio", { name: /Uncommitted/ }).click()
  await expect(scope).toHaveText("Uncommitted")
  await diff.getByRole("button", { name: "Diff options" }).click()
  await page
    .getByRole("menuitemcheckbox", { name: "Hide tests and mocks" })
    .click()
  await page.keyboard.press("Escape")
  await expect(diff.getByText("new.test.ts")).toHaveCount(0)
  writeFileSync(join(folder, "later.ts"), "export const later = 1\n")
  await setInFront(page, false)
  await setInFront(page, true)
  await expect(header("later.ts")).toBeVisible()

  // A commit from a terminal shows too, as the folder's status changes.
  git(folder, "add", "-A")
  git(folder, "commit", "-qm", "Later")
  await expect(header("later.ts")).toHaveCount(0, { timeout: 10_000 })
})

test("a turn's Diff is all the turn changed, its shell's work too, from git's checkpoints", async () => {
  window = await startWindow()
  const { page, dir } = window
  const { thread, composer } = await firstThread(page)
  const folder = join(dir, "root", "Work")
  git(folder, "init", "-q", "-b", "main")
  writeFileSync(join(folder, "notes.md"), "one\ntwo\nthree\n")
  git(folder, "add", "-A")
  git(folder, "commit", "-qm", "First")

  // Its tool edits notes.md; its shell makes made.txt, which no tool
  // call tells of.
  await composer.fill("edit on disk")
  await composer.press("Enter")
  await expect(
    thread.getByText("I edited notes.md and ran a script.")
  ).toBeVisible()
  const changed = thread.getByRole("region", { name: "Changed files" })
  await expect(changed).toContainText("Edited 1 file")
  await changed.getByRole("button", { name: /notes\.md/ }).click()
  const diff = page.getByRole("region", { name: "Diff" })
  await expect(diff.getByRole("button", { name: "Scope" })).toHaveText(
    "edit on disk"
  )
  await diff.getByRole("button", { name: "Show file tree" }).click()
  const files = diff.getByRole("tree")
  for (const path of ["notes.md", "made.txt"])
    await expect(files.getByRole("treeitem", { name: path })).toBeVisible()
  // It opens at the file it was opened on.
  await expect(diff.getByText("2", { exact: true })).toBeVisible()
  await files.getByRole("treeitem", { name: "made.txt" }).click()
  await expect(diff.getByText("by the shell")).toBeVisible()
  await page.screenshot({ path: "test-results/git-diff-turn.png" })

  // What the Person writes after the turn is no part of it.
  writeFileSync(join(folder, "later.md"), "later\n")
  await setInFront(page, false)
  await setInFront(page, true)
  await expect(files.getByRole("treeitem", { name: "made.txt" })).toBeVisible()
  await expect(files.getByRole("treeitem", { name: "later.md" })).toHaveCount(0)
})

test("a turn's Diff shows what it changed outside the Space's folder, from its tool calls", async () => {
  window = await startWindow()
  const { page, dir } = window
  const { thread, composer } = await firstThread(page)
  const folder = join(dir, "root", "Work")
  git(folder, "init", "-q", "-b", "main")
  writeFileSync(join(folder, "readme.md"), "work\n")
  git(folder, "add", "-A")
  git(folder, "commit", "-qm", "First")

  // Its tool edits /work/notes.md, outside the folder, as an Agent edits
  // in a worktree beside it: the turn's checkpoints change nothing.
  await composer.fill("edit the notes")
  await composer.press("Enter")
  await expect(thread.getByText("I edited notes.md.")).toBeVisible()
  const changed = thread.getByRole("region", { name: "Changed files" })
  await changed.getByRole("button", { name: "Review" }).click()
  const diff = page.getByRole("region", { name: "Diff" })
  await expect(diff.getByRole("button", { name: "Scope" })).toHaveText(
    "edit the notes"
  )
  await expect(diff.getByText("1 file")).toBeVisible()
  await expect(diff.getByText("/work/notes.md")).toBeVisible()
  // Its files open folded, as T3 Code's.
  await diff.getByRole("button", { name: "Expand", exact: true }).click()
  await expect(diff.getByText("two", { exact: true })).toBeVisible()
  await expect(diff.getByText("four", { exact: true })).toBeVisible()
  await page.screenshot({ path: "test-results/git-diff-turn-outside.png" })
})

test("the Diff stages, unstages and reverts a hunk, a file and all, as the Codex app's", async () => {
  window = await startWindow()
  const { page, dir } = window
  await expect((await firstThread(page)).composer).toBeVisible()

  // A file changed at both ends, another changed, and one untracked.
  const folder = join(dir, "root", "Work")
  const ten = Array.from({ length: 10 }, (_, n) => `line ${n + 1}`)
  git(folder, "init", "-q", "-b", "main")
  writeFileSync(join(folder, "ten.txt"), ten.join("\n") + "\n")
  writeFileSync(join(folder, "b.txt"), "bee\n")
  git(folder, "add", "-A")
  git(folder, "commit", "-qm", "First")
  const changed = [...ten]
  changed[0] = "line ONE"
  changed[9] = "line TEN"
  writeFileSync(join(folder, "ten.txt"), changed.join("\n") + "\n")
  writeFileSync(join(folder, "b.txt"), "BEE\n")
  writeFileSync(join(folder, "new.txt"), "new\n")
  const status = () => git(folder, "status", "--porcelain").trimEnd()

  await page.keyboard.press("Alt+KeyN")
  const launcher = page.getByRole("region", { name: "New Pane" })
  await expect(launcher).toHaveAttribute("data-focused", "true")
  await expect(launcher.getByRole("button", { name: /Diff/ })).toBeVisible()
  await page.keyboard.press("KeyD")
  const diff = page.getByRole("region", { name: "Diff" })
  const scope = diff.getByRole("button", { name: "Scope" })
  await scope.click()
  await page.getByRole("menuitemradio", { name: /Unstaged/ }).click()
  await expect(scope).toHaveText("Unstaged")
  await expect(diff.locator("header")).toContainText("3 files")
  await diff.getByRole("button", { name: "Expand all files" }).click()

  // A hunk shows what it can do as the pointer is on it: its first is
  // staged, the other stays.
  await diff.getByText("line ONE").hover()
  const stageHunk = diff.getByRole("button", { name: "Stage this hunk" })
  // Only the hunk under the pointer shows it.
  await expect(stageHunk).toHaveCount(1)
  await page.screenshot({ path: "test-results/git-diff-hunk.png" })
  await stageHunk.click()
  await expect.poll(status).toContain("MM ten.txt")
  await expect(diff.getByText("line ONE")).toHaveCount(0)
  await expect(diff.getByText("line TEN")).toBeVisible()

  // A file's Revert asks first; the untracked one goes.
  await diff.getByRole("button", { name: "Revert new.txt" }).click()
  const ask = page.getByRole("dialog", { name: "Revert new.txt?" })
  await expect(ask).toContainText("can't be undone")
  await page.screenshot({ path: "test-results/git-diff-revert.png" })
  await ask.getByRole("button", { name: "Revert" }).click()
  await expect.poll(status).not.toContain("new.txt")

  // Stage all; then Staged unstages a file.
  await diff.getByRole("button", { name: "Stage all" }).click()
  await expect(diff.getByText("Everything changed is staged.")).toBeVisible()
  await scope.click()
  await page.getByRole("menuitemradio", { name: /Staged/ }).click()
  await expect(scope).toHaveText("Staged")
  await diff.getByRole("button", { name: "Unstage b.txt" }).click()
  await expect.poll(status).toBe(" M b.txt\nM  ten.txt")
})

test("a Thread's details card shows the branch and its changes, as T3 Code's, and opens the Diff on them", async () => {
  window = await startWindow()
  const { page, dir } = window
  const thread = await firstThread(page)
  await expect(thread.composer).toBeVisible()
  const pane = page.getByRole("region", { name: "New Thread" })
  const toggle = pane.getByRole("button", { name: "Thread details" })
  const card = page.getByRole("dialog", { name: "Thread details" })

  // A folder that is no repository has one row: Initialize Git.
  await toggle.click()
  const init = card.getByRole("button", { name: "Initialize Git" })
  await expect(init).toBeVisible()
  await page.screenshot({ path: "test-results/git-details-init.png" })
  await page.keyboard.press("Escape")

  const folder = join(dir, "root", "Work")
  git(folder, "init", "-q", "-b", "main")
  writeFileSync(join(folder, "app.ts"), "export const a = 1\n")
  git(folder, "add", "-A")
  git(folder, "commit", "-qm", "First")
  writeFileSync(
    join(folder, "app.ts"),
    "export const a = 2\nexport const b = 3\n"
  )
  writeFileSync(join(folder, "new.ts"), "export const c = 4\n")

  // Ctrl+Shift+B opens it too; it follows the folder as it changes.
  // Changes is what a commit would take, the new file and its line too.
  await thread.composer.click()
  await page.keyboard.press("Control+Shift+KeyB")
  await expect(card.getByText("main", { exact: true })).toBeVisible()
  const changes = card.getByRole("button", { name: /Changes/ })
  await expect(changes).toContainText("Changes · 2 files")
  await expect(changes).toContainText("+3−1")
  await page.screenshot({ path: "test-results/git-details-changes.png" })

  // A new Thread's changes are none of its making: Commit… asks first,
  // and the Harness it starts on writes the message.
  await card.getByRole("button", { name: "Commit…" }).click()
  const commit = page.getByRole("dialog", { name: "Commit to main" })
  await expect(
    commit.getByRole("textbox", {
      name: "Message (optional) — Fake AI writes it",
    })
  ).toBeVisible()
  for (const path of ["app.ts", "new.ts"])
    await expect(
      commit.getByRole("checkbox", { name: `Commit ${path}` })
    ).toBeChecked()
  await expect(
    commit.getByRole("button", { name: "Commit 2 files" })
  ).toBeEnabled()
  await page.screenshot({ path: "test-results/git-commit-new-thread.png" })
  await commit.getByRole("button", { name: "Cancel" }).click()
  await expect(commit).toBeHidden()
  await expect(card).toBeVisible()

  // A Thread wide enough to hold it beside the messages has it at its
  // top right, open until the Person hides it.
  await page.keyboard.press("Escape")
  await page.setViewportSize({ width: 1900, height: 900 })
  const aside = pane.getByRole("complementary", { name: "Thread details" })
  await expect(aside.getByText("main", { exact: true })).toBeVisible()
  await expect(toggle).toHaveAttribute("aria-pressed", "true")
  await page.screenshot({ path: "test-results/git-details-wide.png" })
  await thread.composer.click()
  await page.keyboard.press("Control+Shift+KeyB")
  await expect(aside).toBeHidden()
  await toggle.click()
  await expect(aside).toBeVisible()

  await aside.getByRole("button", { name: /Changes/ }).click()
  const diff = page.getByRole("region", { name: "Diff" })
  await expect(diff.getByRole("button", { name: "Scope" })).toHaveText(
    "Uncommitted"
  )
  await expect(diff.locator("header")).toContainText("2 files·+3−1")

  // Nothing uncommitted, no row.
  git(folder, "add", "-A")
  git(folder, "commit", "-qm", "Second")
  await expect(aside.getByRole("button", { name: /Changes/ })).toHaveCount(0)
})

test("the git button commits every change with the message the Thread's Harness wrote, and pushes, asking first on main", async () => {
  window = await startWindow()
  const { page, dir } = window
  const { thread, composer } = await firstThread(page)
  const folder = join(dir, "root", "Work")
  const remote = join(dir, "remote.git")
  git(dir, "init", "-q", "--bare", "--initial-branch=main", remote)
  git(folder, "init", "-q", "-b", "main")
  writeFileSync(join(folder, "app.ts"), "export const a = 1\n")
  git(folder, "add", "-A")
  git(folder, "commit", "-qm", "First")
  // The engine commits as the folder's git says, as for the Person.
  git(folder, "config", "user.name", "Roma")
  git(folder, "config", "user.email", "roma@banda.so")
  git(folder, "remote", "add", "origin", remote)
  git(folder, "push", "-q", "-u", "origin", "main")
  writeFileSync(join(folder, "app.ts"), "export const a = 2\n")

  // A started Thread's Harness writes the message.
  await composer.fill("hello")
  await composer.press("Enter")
  await expect(thread.getByText("You said: hello")).toBeVisible()
  await page.keyboard.press("Control+Shift+KeyB")
  const card = page.getByRole("dialog", { name: "Thread details" })
  const button = card.getByRole("button", { name: "Commit & push" })
  await expect(button).toBeVisible()
  await page.screenshot({ path: "test-results/git-button-ready.png" })

  // On main it asks first; a feature branch is named for the change.
  // Its buttons fit a narrow window.
  await button.click()
  const ask = page.getByRole("dialog", { name: "You're on main" })
  await expect(ask).toContainText(
    "Push straight to main, or put this change on a new branch first?"
  )
  await page.setViewportSize({ width: 420, height: 800 })
  const edge = (await ask.boundingBox())!
  for (const name of ["Cancel", "Push to main", "New branch & push"]) {
    const box = (await ask.getByRole("button", { name }).boundingBox())!
    expect(box.x + box.width, name).toBeLessThanOrEqual(edge.x + edge.width)
  }
  await page.screenshot({ path: "test-results/git-button-main-narrow.png" })
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.screenshot({ path: "test-results/git-button-main.png" })
  await ask.getByRole("button", { name: "New branch & push" }).click()
  await expect(card).toContainText("to origin/feature/change-app")
  await expect(card).toContainText("Change the app")
  await page.screenshot({ path: "test-results/git-button-done.png" })
  expect(git(remote, "log", "--format=%s", "feature/change-app")).toBe(
    "Change the app\nFirst\n"
  )
  // The card follows: the new branch, up to date, nothing to do.
  await expect(
    card.getByText("feature/change-app", { exact: true })
  ).toBeVisible()
  await expect(card.getByRole("button", { name: "Commit" })).toBeDisabled()
  // The Thread never showed the message's run.
  await expect(thread.getByText("You write concise")).toBeHidden()
  // It shows what the card did, which its Agent reads with its next
  // message.
  const notice = thread.getByText(
    /^Made the branch feature\/change-app, and committed 1 file on it: “Change the app” \(\w+\), and pushed it to origin\/feature\/change-app\.$/
  )
  await expect(notice).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(card).toBeHidden()
  await page.screenshot({ path: "test-results/git-notice.png" })
  await composer.fill("what now")
  await composer.press("Enter")
  await expect(
    thread.getByText(/You said: Since your last turn, your Person did this/)
  ).toBeVisible()
})

test("a commit that ends with the card out of sight says so in a toast", async () => {
  window = await startWindow()
  const { page, dir } = window
  const thread = await firstThread(page)
  await expect(thread.composer).toBeVisible()
  const folder = join(dir, "root", "Work")
  git(folder, "init", "-q", "-b", "main")
  git(folder, "config", "user.name", "Roma")
  git(folder, "config", "user.email", "roma@banda.so")
  writeFileSync(join(folder, "a.ts"), "export const a = 1\n")
  git(folder, "add", "-A")
  git(folder, "commit", "-qm", "First")
  writeFileSync(join(folder, "a.ts"), "export const a = 2\n")
  // A hook that takes a while, so the card is closed before it ends.
  const hook = join(folder, ".git", "hooks", "pre-commit")
  writeFileSync(hook, "#!/bin/sh\nsleep 2\n")
  chmodSync(hook, 0o755)

  await thread.composer.click()
  await page.keyboard.press("Control+Shift+KeyB")
  const card = page.getByRole("dialog", { name: "Thread details" })
  await card.getByRole("button", { name: "Commit…" }).click()
  const dialog = page.getByRole("dialog", { name: "Commit to main" })
  await dialog
    .getByRole("textbox", { name: "Message (optional) — Fake AI writes it" })
    .fill("Change a")
  await dialog.getByRole("button", { name: "Commit 1 file" }).click()
  await expect(card).toContainText("Running pre-commit…")
  await page.keyboard.press("Escape")
  await expect(card).toBeHidden()

  const toast = page
    .getByRole("region", { name: "Notifications" })
    .getByRole("listitem")
    .filter({ hasText: "Change a" })
  await expect(toast).toContainText(/Committed \w+/)
  await page.screenshot({ path: "test-results/git-toast.png" })
  expect(git(folder, "log", "-1", "--format=%s")).toBe("Change a\n")
})

test("Stop while the Thread's Harness writes the message stops it, and nothing is committed", async () => {
  window = await startWindow()
  const { page, dir } = window
  const { thread, composer } = await firstThread(page)
  const folder = join(dir, "root", "Work")
  git(folder, "init", "-q", "-b", "main")
  writeFileSync(join(folder, "app.ts"), "export const a = 1\n")
  git(folder, "add", "-A")
  git(folder, "commit", "-qm", "First")
  // The fake agent waits, till it is stopped, for a prompt that says so.
  writeFileSync(join(folder, "app.ts"), "export const wait = 2\n")

  await composer.fill("hello")
  await composer.press("Enter")
  await expect(thread.getByText("You said: hello")).toBeVisible()
  await page.keyboard.press("Control+Shift+KeyB")
  const card = page.getByRole("dialog", { name: "Thread details" })
  await card.getByRole("button", { name: "Commit", exact: true }).click()
  const writing = card.getByRole("status").filter({ hasText: "writing" })
  await expect(writing).toContainText("Fake AI is writing the message…")
  await expect(writing).toContainText("1s")
  await page.screenshot({ path: "test-results/git-button-writing.png" })

  await writing.getByRole("button", { name: "Stop" }).click()
  await expect(writing).toBeHidden()
  await expect(
    card.getByRole("button", { name: "Commit", exact: true })
  ).toBeEnabled()
  await expect(card.getByRole("alert")).toHaveCount(0)
  expect(git(folder, "log", "--format=%s")).toBe("First\n")
  expect(git(folder, "status", "--porcelain")).toBe(" M app.ts\n")
})

test("the branch picker makes and switches branches, and ▾ commits chosen files with the Person's message and pushes", async () => {
  window = await startWindow()
  const { page, dir } = window
  const { thread, composer } = await firstThread(page)
  const folder = join(dir, "root", "Work")
  const remote = join(dir, "remote.git")
  git(dir, "init", "-q", "--bare", "--initial-branch=main", remote)
  git(folder, "init", "-q", "-b", "main")
  git(folder, "config", "user.name", "Roma")
  git(folder, "config", "user.email", "roma@banda.so")
  writeFileSync(join(folder, "a.ts"), "export const a = 1\n")
  writeFileSync(join(folder, "b.ts"), "export const b = 1\n")
  git(folder, "add", "-A")
  git(folder, "commit", "-qm", "First")
  git(folder, "remote", "add", "origin", remote)
  git(folder, "push", "-q", "-u", "origin", "main")
  git(folder, "push", "-q", "origin", "main:release")
  git(folder, "fetch", "-q", "origin")
  git(folder, "branch", "other")
  writeFileSync(join(folder, "a.ts"), "export const a = 2\n")
  writeFileSync(join(folder, "b.ts"), "export const b = 2\n")

  await composer.fill("hello")
  await composer.press("Enter")
  await expect(thread.getByText("You said: hello")).toBeVisible()
  await page.keyboard.press("Control+Shift+KeyB")
  const card = page.getByRole("dialog", { name: "Thread details" })

  // The picker lists the branches here and the remote's in one list, a
  // remote's left out when one here has its name, as T3 Code's.
  await card.getByRole("button", { name: /^main/ }).click()
  const search = page.getByRole("textbox", { name: "Search branches" })
  await expect(search).toBeFocused()
  const options = page.getByRole("listbox")
  await expect(
    options.getByRole("option", { name: /main.*current/ })
  ).toBeVisible()
  await expect(options.getByRole("option", { name: "other" })).toBeVisible()
  await expect(
    options.getByRole("option", { name: /^origin\/release.*remote/ })
  ).toBeVisible()
  await expect(
    options.getByRole("option", { name: /^origin\/main/ })
  ).toHaveCount(0)
  await page.screenshot({
    path: "test-results/git-branches.png",
    animations: "disabled",
  })
  await options
    .getByRole("option", { name: "other" })
    .click({ button: "right" })
  await expect(
    page.getByRole("menuitem", { name: "Copy branch name" })
  ).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(search).toBeFocused()
  // The keys move the choice, the current branch first.
  await search.press("ArrowDown")
  await expect(options.getByRole("option", { name: "other" })).toHaveAttribute(
    "aria-selected",
    "true"
  )
  // Enter takes the first branch the words find, not a new one of them.
  await search.fill("oth")
  await expect(options.getByRole("option", { name: "other" })).toHaveAttribute(
    "aria-selected",
    "true"
  )
  await expect(
    options.getByRole("option", { name: "Create branch “oth”" })
  ).toBeVisible()
  await search.press("Enter")
  await expect(card.getByRole("button", { name: /^other/ })).toBeVisible()
  expect(git(folder, "branch", "--show-current")).toBe("other\n")
  await expect(
    thread.getByText("Switched to the branch other; the changes went along.")
  ).toBeVisible()
  // Words no branch has make one of the name they make, the choice Enter
  // takes when nothing is listed, and switch to it, the changes along.
  await card.getByRole("button", { name: /^other/ }).click()
  await search.fill("feature/Menu")
  await expect(
    options.getByRole("option", { name: "Create branch “feature/menu”" })
  ).toHaveAttribute("aria-selected", "true")
  await search.press("Enter")
  await expect(
    card.getByRole("button", { name: /^feature\/menu/ })
  ).toBeVisible()
  expect(git(folder, "branch", "--show-current")).toBe("feature/menu\n")

  // ▾ → Commit…: b.ts left out, the Person's message.
  await card.getByRole("button", { name: "More git actions" }).click()
  await page.getByRole("menuitem", { name: "Commit…" }).click()
  const dialog = page.getByRole("dialog", { name: "Commit to feature/menu" })
  await expect(
    dialog.getByRole("button", { name: "Commit 2 files" })
  ).toBeEnabled()
  await dialog.getByRole("checkbox", { name: "Commit b.ts" }).click()
  await expect(
    dialog.getByRole("checkbox", { name: "Commit b.ts" })
  ).not.toBeChecked()
  const message = dialog.getByRole("textbox", {
    name: "Message (optional) — Fake AI writes it",
  })
  await message.fill("Change a")
  // A file left out is an empty box; one focused by the keys has a ring
  // apart from it, in the light and the dark.
  await page.keyboard.press("Shift+Tab")
  await expect(
    dialog.getByRole("checkbox", { name: "Commit b.ts" })
  ).toBeFocused()
  const shot = { animations: "disabled" } as const
  await page.screenshot({ ...shot, path: "test-results/git-commit-dialog.png" })
  await dialog.screenshot({
    ...shot,
    path: "test-results/git-commit-dialog-light.png",
  })
  writeFileSync(join(dir, "config/look.toml"), 'mode = "dark"\n')
  await expect(page.locator("html")).toHaveClass(/dark/)
  await dialog.screenshot({
    ...shot,
    path: "test-results/git-commit-dialog-dark.png",
  })
  writeFileSync(join(dir, "config/look.toml"), "")
  await expect(page.locator("html")).not.toHaveClass(/dark/)
  // None taken, nothing to commit.
  await dialog.getByRole("checkbox", { name: "Commit a.ts" }).click()
  await expect(
    dialog.getByRole("button", { name: "Commit 0 files" })
  ).toBeDisabled()
  await dialog.getByRole("checkbox", { name: "Commit a.ts" }).click()
  await dialog.getByRole("button", { name: "Commit 1 file" }).click()
  await expect(card).toContainText("Change a")
  expect(git(folder, "log", "-1", "--format=%s", "--name-only")).toBe(
    "Change a\n\na.ts\n"
  )
  expect(git(folder, "status", "--porcelain")).toBe(" M b.ts\n")

  // Push runs at once from ▾: a branch never pushed goes to the remote.
  await card.getByRole("button", { name: "More git actions" }).click()
  await page.getByRole("menuitem", { name: "Push" }).click()
  await expect(card).toContainText("to origin/feature/menu")
  expect(git(remote, "log", "--format=%s", "feature/menu")).toBe(
    "Change a\nFirst\n"
  )
})

test("Alt+D shows the Diff beside the Thread and hides it, and Alt+Shift+G opens the branch picker, as T3 Code's Mod+D and Mod+Shift+G", async () => {
  window = await startWindow()
  const { page, dir } = window
  const thread = await firstThread(page)
  await expect(thread.composer).toBeVisible()
  const folder = join(dir, "root", "Work")
  git(folder, "init", "-q", "-b", "main")
  writeFileSync(join(folder, "app.ts"), "export const a = 1\n")
  git(folder, "add", "-A")
  git(folder, "commit", "-qm", "First")
  writeFileSync(join(folder, "app.ts"), "export const a = 2\n")

  // The narrow Thread's card is closed: the key opens it, and the picker
  // in it, the search ready for the words.
  await thread.composer.click()
  await page.keyboard.press("Alt+Shift+KeyG")
  const search = page.getByRole("textbox", { name: "Search branches" })
  await expect(search).toBeFocused()
  await expect(
    page.getByRole("listbox").getByRole("option", { name: /^main/ })
  ).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(search).toBeHidden()

  // Alt+D: the Space's Diff on its changes, beside the Thread; on the
  // Diff, Alt+D hides it.
  await page.keyboard.press("Escape")
  await thread.composer.click()
  await page.keyboard.press("Alt+KeyD")
  const diff = page.getByRole("region", { name: "Diff" })
  const scope = diff.getByRole("button", { name: "Scope" })
  await expect(scope).toHaveText("Changes")
  await expect(diff.getByText("app.ts").first()).toBeVisible()
  // On another scope it is still the Space's one Diff: the key goes to it.
  await scope.click()
  await page.getByRole("menuitemradio", { name: /Unstaged/ }).click()
  await expect(scope).toHaveText("Unstaged")
  await thread.composer.click()
  await page.keyboard.press("Alt+KeyD")
  await expect(diff).toHaveCount(1)
  await expect(diff).toHaveAttribute("data-focused", "true")
  await expect(scope).toHaveText("Unstaged")
  await page.keyboard.press("Alt+KeyD")
  await expect(diff).toBeHidden()

  // A wide Thread's card hidden by the Person shows again for the key.
  await page.setViewportSize({ width: 1900, height: 900 })
  const pane = page.getByRole("region", { name: "New Thread" })
  const aside = pane.getByRole("complementary", { name: "Thread details" })
  await expect(aside).toBeVisible()
  await thread.composer.click()
  await page.keyboard.press("Control+Shift+KeyB")
  await expect(aside).toBeHidden()
  await page.keyboard.press("Alt+Shift+KeyG")
  await expect(aside).toBeVisible()
  await expect(search).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(search).toBeHidden()
  // Hidden and shown again, the card opens no picker of itself.
  await thread.composer.click()
  await page.keyboard.press("Control+Shift+KeyB")
  await page.keyboard.press("Control+Shift+KeyB")
  await expect(aside).toBeVisible()
  await expect(search).toBeHidden()

  // Both are in the Banda menu, as any action.
  await page.keyboard.press("Alt+Space")
  await page.keyboard.type("switch branch")
  await expect(
    page.getByRole("option", { name: /Switch branch/ })
  ).toBeVisible()
})

test("a branch diverged from its upstream neither syncs nor pulls, and says why, as T3 Code's", async () => {
  window = await startWindow()
  const { page, dir } = window
  const { composer } = await firstThread(page)
  await expect(composer).toBeVisible()
  const folder = join(dir, "root", "Work")
  const remote = join(dir, "remote.git")
  const theirs = join(dir, "theirs")
  git(dir, "init", "-q", "--bare", "--initial-branch=main", remote)
  git(folder, "init", "-q", "-b", "main")
  writeFileSync(join(folder, "a.ts"), "export const a = 1\n")
  git(folder, "add", "-A")
  git(folder, "commit", "-qm", "First")
  git(folder, "remote", "add", "origin", remote)
  git(folder, "push", "-q", "-u", "origin", "main")
  // Another's commit on the remote, and one of ours: ahead and behind.
  git(dir, "clone", "-q", remote, theirs)
  writeFileSync(join(theirs, "b.ts"), "export const b = 1\n")
  git(theirs, "add", "-A")
  git(theirs, "commit", "-qm", "Theirs")
  git(theirs, "push", "-q")
  writeFileSync(join(folder, "c.ts"), "export const c = 1\n")
  git(folder, "add", "-A")
  git(folder, "commit", "-qm", "Ours")
  git(folder, "fetch", "-q")

  await composer.click()
  await page.keyboard.press("Control+Shift+KeyB")
  const card = page.getByRole("dialog", { name: "Thread details" })
  await expect(card.getByText("↑1 ↓1")).toBeVisible()
  const diverged = "Branch has diverged from upstream. Rebase or merge first."
  const sync = card.getByRole("button", { name: "Sync branch" })
  await expect(sync).toBeDisabled()
  await expect(card.getByTitle(diverged)).toBeVisible()
  await card.getByRole("button", { name: "More git actions" }).click()
  const pull = page.getByRole("menuitem", { name: "Pull" })
  await expect(pull).toHaveAttribute("aria-disabled", "true")
  await expect(page.getByRole("menu").getByTitle(diverged)).toBeVisible()
})
