/**
 * Run and Sign in on arc (ADR 0106, decision 4; the `run` and `sign-in`
 * roads), on arc.ts's arc, 40 ms away a round trip: a reply's Run opens
 * arc's terminal beside the Thread and runs its line; while arc is away it
 * is refused at once, no Pane opens and nothing runs once arc is back. A
 * sign-in that needs a terminal runs in arc's; one that needs a browser
 * says to sign in on arc for now (#1240). The same-path job runs this spec
 * with arc in a mount namespace of its own. With BANDA_E2E_SHOTS set to a
 * folder, it leaves pictures of what it checks.
 */
import { existsSync } from "node:fs"
import { join } from "node:path"
import { expect, type Locator, type Page, test } from "@playwright/test"
import { type Arc, newArc, put, SHOTS, shot, withArc } from "./arc"
import { read, type Window } from "./window"

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
const TITLE = "Bench the hosts"

const sidebarOf = (page: Page) =>
  page.getByRole("complementary", { name: "Sidebar" })

/** arc's part of the sidebar: its label and what it holds. */
const arcOf = (page: Page) =>
  sidebarOf(page).getByRole("group", { name: "arc", exact: true })

/** The window and arc's Thread open from arc's part of the sidebar; with
 * `account`, its first turn failed as its Person must sign in on arc. */
async function onArc({ account = false } = {}) {
  arc = newArc({ latency: 40, account })
  stopArc = await arc.start()
  const folder = join(arc.code.arc, "banda")
  put(arc.disk(folder), { "who.txt": "arc\n" })
  const project = JSON.parse(arc.banda("project", "add", folder)).ok
    .id as string
  arc.send(project, TITLE)
  await expect
    .poll(() => arc!.states(project).find(([one]) => one === TITLE)?.[1])
    .toBe(account ? "failed" : "done")
  window = await withArc(arc)
  const { page } = window
  await arcOf(page).getByText(TITLE).click()
  const thread = page.getByRole("region", { name: TITLE, exact: true })
  const composer = thread.getByRole("textbox", { name: "Message to Fake AI" })
  await expect(composer).toBeVisible()
  return { page, thread, composer, folder }
}

/** A reply on arc with one line of a shell: its Run. */
async function replied(thread: Locator, composer: Locator, line: string) {
  // The reply starts with “You said: ”, so a fence cannot.
  await composer.fill(`Some code:\n\n\`\`\`sh\n${line}\n\`\`\``)
  await composer.press("Enter")
  const block = thread.locator("[data-quotable] [data-streamdown=code-block]")
  const run = block.getByRole("button", { name: "Run", exact: true })
  await expect(run).toBeVisible()
  return run
}

/** The pill on arc's Thread. */
const pillOf = (thread: Locator) =>
  thread.locator("[data-machine-pill] [role=status]")

/** Cuts arc off, and waits until the window says so. */
async function cut(thread: Locator) {
  arc!.blackhole(true)
  await expect.poll(() => arc!.applies()?.hole).toBe(true)
  await expect(pillOf(thread)).toHaveText("arc is away", { timeout: 60_000 })
}

/** Brings arc back, and waits until the window says so. */
async function back(thread: Locator) {
  arc!.blackhole(false)
  await expect(pillOf(thread)).toHaveCount(0, { timeout: 90_000 })
}

test("Run in arc's reply opens arc's terminal beside the Thread and runs its line there", async () => {
  const { page, thread, composer, folder } = await onArc()
  const run = await replied(thread, composer, "hostname > ran.txt")
  await run.click()
  const screen = page.getByRole("region", { name: "Terminal screen" })
  await expect(screen).toHaveAttribute("data-state", "running")
  const tile = page.locator("section[data-tile]").filter({ has: screen })
  await expect(tile.locator("header").first()).toContainText("arc")
  await expect
    .poll(() => read(arc!.disk(join(folder, "ran.txt"))))
    .toBe("arc\n")
  // Arc's disk has it, and this machine's folder of that path does not.
  expect(existsSync(join(arc!.code.here, "banda", "ran.txt"))).toBe(false)
  await shot(page, "run-on-arc")
})

test("Run while arc is away says it was not sent and opens no Pane, and nothing runs once arc is back", async () => {
  test.setTimeout(SHOTS ? 300_000 : 180_000)
  const { page, thread, composer, folder } = await onArc()
  const run = await replied(thread, composer, "hostname > late.txt")
  await cut(thread)
  await run.click()
  await expect(page.getByText("arc is away: Run was not sent.")).toBeVisible()
  const screen = page.getByRole("region", { name: "Terminal screen" })
  await expect(screen).toHaveCount(0)
  await shot(page, "run-while-away", { toasts: true })

  await back(thread)
  await page.waitForTimeout(1_500)
  await expect(screen).toHaveCount(0)
  expect(existsSync(arc!.disk(join(folder, "late.txt")))).toBe(false)
})

test("a sign-in that runs in a terminal runs in arc's, where a code signs in and the turn goes again, and a way that needs a browser says to sign in on arc", async () => {
  test.setTimeout(SHOTS ? 300_000 : 180_000)
  const { page, thread } = await onArc({ account: true })
  await expect(thread.getByText("needs you to sign in.")).toBeVisible()
  const signIn = thread.getByRole("button", {
    name: "Sign in with Fake account",
  })
  await expect(signIn).toBeVisible()
  await expect(
    thread.getByRole("button", { name: "Sign in with Fake browser" })
  ).toHaveCount(0)
  await expect(
    thread.getByText(
      "Fake AI signs in on a web page in a browser on arc's own computer. Sign in on arc for now."
    )
  ).toBeVisible()

  await signIn.click()
  const terminal = page.getByRole("region", { name: "Sign in: Fake account" })
  const screen = terminal.getByRole("region", { name: "Terminal screen" })
  await expect(screen).toHaveAttribute("data-state", "running")
  await expect(terminal.locator("header").first()).toContainText("arc")
  await shot(page, "sign-in-on-arc")
  await screen.click()
  await page.keyboard.type("fake-code")
  await page.keyboard.press("Enter")
  await expect.poll(() => arc!.signedIn()).toBe(true)
  await expect(thread.getByText(`You said: ${TITLE}`)).toBeVisible()
  await expect(terminal).toBeHidden()
})

test("Sign in while arc is away says it was not sent, and opens no terminal", async () => {
  test.setTimeout(SHOTS ? 300_000 : 180_000)
  const { page, thread } = await onArc({ account: true })
  const signIn = thread.getByRole("button", {
    name: "Sign in with Fake account",
  })
  await expect(signIn).toBeVisible()
  await cut(thread)
  await signIn.click()
  await expect(
    thread.getByText("arc is away: Sign in with Fake account was not sent.")
  ).toBeVisible()
  await expect(
    page.getByRole("region", { name: "Sign in: Fake account" })
  ).toHaveCount(0)
})
