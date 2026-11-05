import type { Changed, Status } from "@banda/contract/git"
import { expect, test } from "vitest"
import { askOf, asksFirst, menuOf, onDefault, quickOf } from "./quick"

const STATUS: Status = {
  at: 0,
  repo: true,
  branch: "feature",
  head: "a1b2c3d",
  upstream: "origin/feature",
  ahead: 0,
  behind: 0,
  remote: "origin",
  default_branch: "main",
  files: [],
  changed: 0,
  added: 0,
  removed: 0,
}
/** A file changed in the work tree, not staged yet. */
const changed = (path: string): Changed => ({
  path,
  status: "modified",
  staged: false,
  added: 1,
  removed: 0,
})
const CHANGED: Status = { ...STATUS, files: [changed("a.ts")] }
const NOW = { started: true }
const button = (status: Partial<Status>, now = NOW) =>
  quickOf({ ...STATUS, ...status }, now)

test("the git button follows the status, as T3 Code's quick action", () => {
  expect(quickOf(CHANGED, NOW)).toMatchObject({
    label: "Commit & push",
    action: "commit_push",
  })
  // Behind, or nowhere to push: commit alone.
  expect(quickOf({ ...CHANGED, behind: 2 }, NOW).action).toBe("commit")
  const alone = { ...CHANGED, upstream: undefined, remote: undefined }
  expect(quickOf(alone, NOW).action).toBe("commit")
  expect(button({ ahead: 2 })).toMatchObject({ label: "Push", action: "push" })
  expect(button({ behind: 3 })).toMatchObject({ label: "Pull", action: "pull" })
  expect(button({ ahead: 1, behind: 1 })).toMatchObject({
    label: "Sync branch",
    action: null,
  })
  expect(button({})).toMatchObject({
    label: "Commit",
    action: null,
    hint: "Branch is up to date. No action needed.",
  })
})

test("a branch never pushed pushes, and what cannot run says why", () => {
  expect(button({ upstream: undefined, ahead: undefined })).toMatchObject({
    action: "push",
  })
  expect(button({ upstream: undefined, remote: undefined }).hint).toBe(
    'Add an "origin" remote before pushing.'
  )
  expect(button({ branch: undefined }).action).toBeNull()
  expect(button({ repo: false }).action).toBeNull()
})

test("a new Thread's changes open the Commit dialog, as nothing it said made them", () => {
  const fresh = { started: false }
  expect(quickOf(CHANGED, fresh)).toEqual({
    label: "Commit…",
    action: "commit",
    asks: true,
    icon: "commit",
  })
  // Behind or with nowhere to push, it asks all the same.
  expect(quickOf({ ...CHANGED, behind: 2 }, fresh).asks).toBe(true)
  // With nothing to commit, it is the button a started Thread has.
  expect(button({ ahead: 2 }, fresh)).toMatchObject({
    label: "Push",
    action: "push",
  })
  expect(button({}, fresh).action).toBeNull()
  expect(quickOf(CHANGED, NOW).asks).toBeUndefined()
})

test("a push on the default branch asks first, a commit never", () => {
  const main = { ...STATUS, branch: "main" }
  expect(asksFirst(main, "commit_push")).toBe(true)
  expect(asksFirst(main, "push")).toBe(true)
  expect(asksFirst(main, "commit")).toBe(false)
  expect(asksFirst(STATUS, "push")).toBe(false)
  expect(askOf("commit_push", "main")).toEqual({
    title: "You're on main",
    body: "Push straight to main, or put this change on a new branch first?",
    go: "Push to main",
    branch: "New branch & push",
  })
  // Commits made already have no change to name a branch for.
  const push = askOf("push", "trunk")
  expect(push).toMatchObject({ title: "You're on trunk", go: "Push to trunk" })
  expect(push.branch).toBeUndefined()
})

test("the ▾ menu says which of Commit, Push and Pull can run, and why not", () => {
  const menu = menuOf(CHANGED)
  expect(menu.commit.can).toBe(true)
  expect(menu.push.hint).toBe("No local commits to push.")
  expect(menu.pull.can).toBe(false)
  expect(menu.follows).toBe("origin/feature")
  expect(menuOf({ ...STATUS, ahead: 2 }).push.can).toBe(true)
  expect(menuOf({ ...STATUS, behind: 1 }).pull.can).toBe(true)
  expect(menuOf({ ...STATUS, behind: 1 }).push.can).toBe(false)
  expect(menuOf(STATUS).commit.hint).toMatch(/clean/)
  // A branch never pushed pushes its commits.
  expect(menuOf({ ...STATUS, upstream: undefined }).push.can).toBe(true)
})

test("a branch diverged from its upstream pulls neither from ▾", () => {
  const diverged = menuOf({ ...STATUS, ahead: 1, behind: 1 })
  expect(diverged.pull).toEqual({
    can: false,
    hint: "Branch has diverged from upstream. Rebase or merge first.",
  })
  expect(diverged.push.can).toBe(false)
})

test("a branch just made, no commit of its own, has nothing to push", () => {
  const fresh = { upstream: undefined, ahead: undefined, behind: undefined }
  expect(button({ ...fresh, ahead_of_default: 0 })).toMatchObject({
    label: "Push",
    action: null,
    hint: "No local commits to push.",
  })
  expect(menuOf({ ...STATUS, ...fresh, ahead_of_default: 0 }).push.can).toBe(
    false
  )
  expect(button({ ...fresh, ahead_of_default: 2 }).action).toBe("push")
})

test("only a branch named as the default is on it", () => {
  expect(onDefault({ ...STATUS, branch: "main" })).toBe(true)
  expect(onDefault(STATUS)).toBe(false)
  // Detached, and no default known: not on it.
  expect(
    onDefault({ ...STATUS, branch: undefined, default_branch: undefined })
  ).toBe(false)
})
