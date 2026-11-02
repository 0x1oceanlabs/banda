import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { expect, test } from "@playwright/test"
import { firstThread, setInFront, startWindow, type Window } from "./window"

let window: Window

test.afterEach(async () => {
  await window?.close()
})

/** Runs git in `folder`, as one who has no config of their own. */
function git(folder: string, ...args: string[]) {
  execFileSync("git", args, {
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
  await expect(page.getByRole("region", { name: "New Pane" })).toHaveAttribute(
    "data-focused",
    "true"
  )
  await page.keyboard.press("KeyD")
  const diff = page.getByRole("region", { name: "Diff" })
  await expect(diff).toBeVisible()

  // Changes: the branch against main, uncommitted work too.
  const scope = diff.getByRole("button", { name: "Scope" })
  await expect(scope).toHaveText("Changes")
  await expect(diff.getByRole("button", { name: "Base" })).toHaveText("vs main")
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
