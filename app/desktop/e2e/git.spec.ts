import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"
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
  await expect(changed).toContainText("1 file changed")
  await changed.getByRole("button", { name: /notes\.md/ }).click()
  const diff = page.getByRole("region", { name: "Diff" })
  await expect(diff.getByRole("button", { name: "Scope" })).toHaveText(
    "edit on disk"
  )
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
