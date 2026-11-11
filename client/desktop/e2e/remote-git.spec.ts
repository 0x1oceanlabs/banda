/**
 * arc's Git and Diff run on arc's engine, and this device only draws them
 * (ADR 0106, step 2a), on arc.ts's arc, 40 ms away a round trip: the
 * `git` road. arc's Diff reads arc's files and stages and reverts them on
 * arc. arc's Thread's git card commits with the message arc's Harness
 * writes and pushes to a bare remote in arc's folders, with arc's keys.
 * While arc is away a Commit is refused at once; a push cut off on its
 * way says it may have gone through, and Check reads arc's git again. The
 * same-path job runs this spec with arc in a mount namespace of its own
 * (ci.yml's `same-path`). With BANDA_E2E_SHOTS set to a folder, it leaves
 * pictures of what it checks.
 */
import { chmodSync } from "node:fs"
import { join } from "node:path"
import { expect, type Page, test } from "@playwright/test"
import { type Arc, newArc, put, SHOTS, shot, withArc } from "./arc"
import { git, type Window } from "./window"

let window: Window | undefined
let arc: Arc | undefined
let stopArc: (() => Promise<void>) | undefined

test.afterEach(async () => {
  await window?.close()
  await stopArc?.()
  arc?.close()
  window = arc = stopArc = undefined
})

/** The title of arc's Thread in its Project "banda". */
const TITLE = "Bench remote Git"

/** arc's part of the sidebar: its label and what it holds. */
const arcOf = (page: Page) =>
  page
    .getByRole("complementary", { name: "Sidebar" })
    .getByRole("group", { name: "arc", exact: true })

/** Ten lines: a file whose both ends change is two hunks to act on. */
const ten = Array.from({ length: 10 }, (_, n) => `line ${n + 1}`)

/**
 * arc's Project "banda", on a branch `work` that tracks a bare remote in
 * arc's folders, the first commit pushed, with a Thread done and open:
 * git as arc has it, by the disk path this machine's tests reach it.
 * This machine has a `banda` of its own at the same path where the two
 * share one, whose git never changes.
 */
async function onArc() {
  arc = newArc({ latency: 40 })
  stopArc = await arc.start()
  const there = join(arc.code.arc, "banda")
  const folder = arc.disk(there)
  const remote = arc.disk(join(arc.code.arc, "remote.git"))
  put(folder, { "ten.txt": ten.join("\n") + "\n" })
  if (arc.samePath)
    put(join(arc.code.here, "banda"), { "ten.txt": "mac\n".repeat(10) })
  git(arc.code.arc, "init", "-q", "--bare", "--initial-branch=main", remote)
  git(folder, "init", "-q", "-b", "main")
  git(folder, "config", "user.name", "Roma")
  git(folder, "config", "user.email", "roma@banda.so")
  git(folder, "add", "-A")
  git(folder, "commit", "-qm", "First")
  git(folder, "remote", "add", "origin", remote)
  git(folder, "push", "-q", "origin", "main")
  // A branch of its own, so a push does not ask first as on the default.
  git(folder, "switch", "-qc", "work")
  git(folder, "push", "-q", "-u", "origin", "work")
  // arc's engine pushes by arc's own name of the remote.
  git(folder, "remote", "set-url", "origin", join(arc.code.arc, "remote.git"))
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
  const composer = thread.getByRole("textbox", { name: "Message to Fake AI" })
  return { page, thread, composer, project, folder, remote }
}

/** The card, as the Thread draws it beside the messages or in a popover. */
async function card(page: Page) {
  await page.keyboard.press("Control+Shift+KeyB")
  const details = page
    .getByRole("complementary", { name: "Thread details" })
    .or(page.getByRole("dialog", { name: "Thread details" }))
  await expect(details).toBeVisible()
  return details
}

test("arc's Diff opens on arc with Alt+D and names arc: stage and revert run in arc's repository", async () => {
  const { page, composer, folder } = await onArc()
  const changed = [...ten]
  changed[0] = "line ONE"
  changed[9] = "line TEN"
  put(folder, { "ten.txt": changed.join("\n") + "\n", "new.txt": "new\n" })
  const status = () => git(folder, "status", "--porcelain").trimEnd()

  await composer.focus()
  await page.keyboard.press("Alt+KeyD")
  const diff = page.getByRole("region", { name: "Diff" })
  await expect(diff).toBeVisible()
  await expect(diff.locator('[data-machine-icon="server"]')).toBeVisible()
  await expect(diff.locator("header").first()).toContainText("arc")
  const scope = diff.getByRole("button", { name: "Scope" })
  await scope.click()
  await page.getByRole("menuitemradio", { name: /Unstaged/ }).click()
  await expect(diff.locator("header")).toContainText("2 files")
  await diff.getByRole("button", { name: "Expand all files" }).click()
  await expect(diff.getByText("line ONE")).toBeVisible()

  // A hunk staged on arc: the first of two.
  await diff.getByText("line ONE").hover()
  await diff.getByRole("button", { name: "Stage this hunk" }).click()
  await expect.poll(status).toContain("MM ten.txt")
  await expect(diff.getByText("line ONE")).toHaveCount(0)
  await shot(page, "diff-arc")

  // A file reverted on arc, this one untracked, so it goes.
  await diff.getByRole("button", { name: "Revert new.txt" }).click()
  await page
    .getByRole("dialog", { name: "Revert new.txt?" })
    .getByRole("button", { name: "Revert" })
    .click()
  await expect.poll(status).not.toContain("new.txt")
  // The hunk stayed staged, and the other unstaged.
  await expect.poll(status).toBe("MM ten.txt")
})

test("arc's card's Changes row opens arc's Diff on what is not committed", async () => {
  const { page, composer, folder } = await onArc()
  put(folder, { "ten.txt": "changed on arc\n" })
  await composer.focus()
  const details = await card(page)
  await details.getByRole("button", { name: /^Changes/ }).click()
  const diff = page.getByRole("region", { name: "Diff" })
  await expect(diff.getByRole("button", { name: "Scope" })).toHaveText(
    "Uncommitted"
  )
  await expect(diff.locator('[data-machine-icon="server"]')).toBeVisible()
  await diff.getByRole("button", { name: "Expand all files" }).click()
  await expect(diff.getByText("changed on arc")).toBeVisible()
})

test("arc's git card commits with the message arc's Harness wrote and pushes to a bare remote on arc", async () => {
  const { page, composer, folder, remote } = await onArc()
  put(folder, { "ten.txt": "a change\n" })
  await composer.focus()
  const details = await card(page)
  const commit = details.getByRole("button", { name: "Commit & push" })
  await expect(commit).toBeVisible()
  await expect(details).toContainText("work")
  await expect(details).toContainText("Changes")
  await shot(page, "git-card-arc")

  await commit.click()
  await expect(details).toContainText("to origin/work")
  // What arc's fake Harness writes for any change.
  const message = "Change the app"
  expect(git(remote, "log", "--format=%s", "work")).toBe(`${message}\nFirst\n`)
  expect(git(folder, "log", "--format=%s", "origin/work")).toBe(
    `${message}\nFirst\n`
  )
})

test("while arc is away arc's card refuses a Commit at once, and nothing is committed when arc is back", async () => {
  // ssh gives up on a silent link in about 20 s, and comes back after its
  // waits.
  test.setTimeout(SHOTS ? 300_000 : 240_000)
  const { page, composer, thread, folder } = await onArc()
  put(folder, { "ten.txt": "held\n" })
  const before = git(folder, "rev-parse", "HEAD")
  await composer.focus()
  const details = await card(page)
  const commit = details.getByRole("button", { name: "Commit & push" })
  await expect(commit).toBeVisible()

  arc!.blackhole(true)
  await expect(thread.getByText("arc is away").first()).toBeVisible({
    timeout: 60_000,
  })
  await commit.click()
  await expect(details.getByRole("alert")).toHaveText(
    /arc is away: Commit & push was not sent\./,
    { timeout: 5_000 }
  )
  await shot(page, "commit-refused-arc")

  arc!.blackhole(false)
  await expect(thread.getByText("arc is away")).toHaveCount(0, {
    timeout: 90_000,
  })
  // Long enough for what waited to land, had any.
  await page.waitForTimeout(2_000)
  expect(git(folder, "rev-parse", "HEAD")).toBe(before)
  expect(git(folder, "status", "--porcelain").trimEnd()).toBe(" M ten.txt")
})

test("a push cut off on its way says it may have gone through, and Check reads arc's git again", async () => {
  test.setTimeout(SHOTS ? 360_000 : 300_000)
  const { page, composer, thread, folder, remote } = await onArc()
  put(folder, { "ten.txt": "pushed\n" })
  git(folder, "commit", "-qam", "Ahead of its upstream")
  // arc's git holds the push until this test says, so it is on its way
  // as the link goes.
  const go = join(arc!.code.arc, "banda", ".git", "go")
  put(folder, {
    ".git/hooks/pre-push": `#!/bin/sh\nuntil [ -e '${go}' ]; do sleep 0.1; done\n`,
  })
  chmodSync(join(folder, ".git/hooks/pre-push"), 0o755)

  await composer.focus()
  const details = await card(page)
  const push = details.getByRole("button", { name: "Push" }).first()
  await expect(push).toBeVisible()
  await push.click()
  await expect(
    details.getByRole("status").filter({ hasText: "Running pre-push…" })
  ).toBeVisible()

  // The link goes as the push runs; arc's git goes on by itself.
  arc!.blackhole(true)
  await expect(thread.getByText("arc is away").first()).toBeVisible({
    timeout: 60_000,
  })
  const alert = details.getByRole("alert")
  await expect(alert).toContainText(
    "arc went away; Push may have gone through.",
    { timeout: 60_000 }
  )
  const check = details.getByRole("button", { name: "Check" })
  await expect(check).toBeVisible()
  await shot(page, "push-may-have", { toasts: false })

  // Check while arc is away: refused at once, and it stays.
  await check.click()
  await expect(alert).toContainText("arc is away: Check was not sent.")
  await expect(check).toBeVisible()

  // The push finishes on arc as the link comes back.
  put(folder, { ".git/go": "" })
  arc!.blackhole(false)
  await expect(thread.getByText("arc is away")).toHaveCount(0, {
    timeout: 90_000,
  })
  await expect
    .poll(() => git(remote, "log", "--format=%s", "work"), { timeout: 30_000 })
    .toBe("Ahead of its upstream\nFirst\n")
  await expect(alert).toBeVisible()
  await check.click()
  await expect(details).toContainText("Push went through")
})
