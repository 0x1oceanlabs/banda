import type { Status } from "@banda/contract/git"
import { expect, test } from "vitest"
import { askOf, asksFirst, quickOf } from "./quick"

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
  added: 0,
  removed: 0,
}
const CHANGED = {
  ...STATUS,
  files: [{ path: "a.ts", change: "modified", staged: false }],
} as unknown as Status
const NOW = { writes: true }
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
  // A new Thread has no Harness to write the message yet.
  expect(quickOf(CHANGED, { writes: false }).action).toBeNull()
  expect(button({ repo: false }).action).toBeNull()
})

test("a push on the default branch asks first, a commit never", () => {
  const main = { ...STATUS, branch: "main" }
  expect(asksFirst(main, "commit_push")).toBe(true)
  expect(asksFirst(main, "push")).toBe(true)
  expect(asksFirst(main, "commit")).toBe(false)
  expect(asksFirst(STATUS, "push")).toBe(false)
  expect(askOf("commit_push", "main").go).toBe("Commit & push to main")
  expect(askOf("push", "main").title).toBe("Push to main?")
})
