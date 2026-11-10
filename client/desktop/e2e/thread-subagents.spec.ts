/**
 * A Harness's sub-agents in their Thread (ADR 0103, decisions 12–17): a
 * row where each started, a group of the ones one message started, and a
 * row opened in place. Banda shows them and stops none (Roma's call 11).
 * Dark on Dev until Banda declares sub-agents: these windows turn the
 * engine's switch on (decision 7). The fake agent's `sub-agents …` words
 * play them (tools/fake-agent/src/subagents.rs).
 */
import { expect, type Locator, test } from "@playwright/test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import {
  agentAnswers,
  FREE,
  firstThread,
  plateOf,
  startWindow,
  type Window,
} from "./window"

let window: Window

test.afterEach(async () => {
  await window?.close()
})

/** Light, and with the glass off, as the mocks' pictures are taken; still,
 * so a window resized for them is drawn at once. */
const LOOK = 'mode = "light"\n[desk]\nglass = false\n[motion]\noff = true\n'

/** A window whose engine declares sub-agents, at a laptop's size. */
const declaring = () =>
  startWindow({ look: LOOK, env: { BANDA_SUBAGENTS: "1" } })

/** The window at `width` by `height`, drawn at that size. */
async function sized({ app, page }: Window, width: number, height = 900) {
  await app.evaluate(
    ({ BrowserWindow }, [width, height]) =>
      BrowserWindow.getAllWindows()[0]!.setContentSize(width, height),
    [width, height]
  )
  await page.setViewportSize({ width, height })
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => setTimeout(done)))
  )
}

/** Pictures of the window at 1440 and 728 wide, as the mocks are drawn
 * (AGENTS.md); then it is 1440 wide. */
async function shots(window: Window, name: string) {
  for (const width of [1440, 728]) {
    await sized(window, width)
    await window.page.screenshot({
      path: `test-results/thread-subagents-${name}-${width}.png`,
    })
  }
  await sized(window, 1440)
}

/** Where a part of the Thread is, to show nothing moved. */
const placeOf = async (part: Locator) => {
  const box = await part.boundingBox()
  return box && { x: box.x, y: box.y, width: box.width, height: box.height }
}

test("sub-agents show as rows where they started, grouped, and settle into one line", async () => {
  window = await declaring()
  const { thread, composer } = await firstThread(window.page)
  await composer.fill("sub-agents three asks")
  await composer.press("Enter")
  // One line counts the three, only what asks in colour; their rows are
  // under it, each named by its label: the role, or the title for
  // Claude's default role.
  const group = thread.getByRole("button", { name: /^3 sub-agents/ })
  await expect(group).toHaveText(/3 sub-agents · 2 working · 1 asks/)
  await expect(group.getByText("1 asks")).toHaveClass(/text-attention/)
  const explore = thread.getByRole("button", { name: "Explore" })
  const general = thread.getByRole("button", { name: "Read a.txt one line" })
  const reviewer = thread.getByRole("button", { name: "Reviewer" })
  await expect(explore).toContainText("Map where [row] keys are read")
  await expect(general).toContainText("general")
  // The one that asks says what, and the Thread draws no line that waits
  // for it: the Question docks on the composer.
  await expect(reviewer).toContainText("Asks: pnpm vitest")
  await expect(reviewer.getByRole("img", { name: "Asks" })).toBeVisible()
  await expect(thread.getByText(/^Waiting for you/)).toBeHidden()
  // A closed row counts nothing, and no row offers Stop.
  await expect(thread.locator("[data-slot=subagent]")).toHaveCount(3)
  await expect(thread.locator("[data-slot=subagents]")).not.toContainText(
    /\b(read|ran|edited) (a|\d+) (files?|commands?)/i
  )
  await expect(
    thread
      .locator("[data-slot=subagents]")
      .getByRole("button", { name: /Stop/ })
  ).toHaveCount(0)
  await shots(window, "live")
  // A row opened while they work stays open, folded with its group.
  await explore.click()
  await expect(explore).toHaveAttribute("aria-expanded", "true")

  const question = thread.getByRole("group", { name: "pnpm vitest" })
  await question.getByRole("button", { name: /^Yes/ }).click()
  // All three ended: the group is one dimmed line, folded.
  const ran = thread.getByRole("button", { name: /^Ran 3 sub-agents/ })
  await expect(ran).toHaveText(/Ran 3 sub-agents · \d+s/)
  await expect(ran).toHaveAttribute("aria-expanded", "false")
  await expect(explore).toBeHidden()
  await expect(thread.getByText(/^The sub-agents said:/)).toBeVisible()
  await shots(window, "settled")
  // Ctrl+F opens it to what it finds in a row, and folds it again as it
  // closes.
  await composer.press("ControlOrMeta+f")
  const find = thread.getByRole("textbox", { name: "Find in thread" })
  await find.fill("src/rows.ts")
  await expect(ran).toHaveAttribute("aria-expanded", "true")
  await expect(explore).toBeVisible()
  await find.press("Escape")
  await expect(ran).toHaveAttribute("aria-expanded", "false")
  // A click opens it to its rows, each saying how it ended, the one
  // opened before still open.
  await ran.click()
  await expect(explore).toContainText("src/rows.ts reads them.")
  await expect(explore.getByRole("img", { name: "Done" })).toBeVisible()
  await expect(explore).toHaveAttribute("aria-expanded", "true")
})

test("a row opens in place and nothing above it moves", async () => {
  window = await declaring()
  const { page } = window
  const { thread, composer } = await firstThread(page)
  for (const word of ["one", "two", "three"]) {
    await composer.fill(word)
    await composer.press("Enter")
    await expect(thread.getByText(`You said: ${word}`)).toBeVisible()
  }
  await composer.fill("sub-agents nested")
  await composer.press("Enter")
  await expect(thread.getByText(/^The sub-agents said:/)).toBeVisible()
  // A sub-agent's own sub-agents are counted on its row, one level shown.
  const row = thread.getByRole("button", { name: "Read a.txt one line" })
  await expect(row).toContainText("(+1)")
  await expect(thread.locator("[data-slot=subagent]")).toHaveCount(1)
  // A low window, so the Thread runs past its end and follows it there:
  // opening the row must not pull what is above it up.
  await sized(window, 1440, 480)
  const view = thread.locator("[data-slot=message-scroller-viewport]")
  await expect
    .poll(() => view.evaluate((view) => view.scrollHeight > view.clientHeight))
    .toBe(true)
  await expect(thread.getByText(/^The sub-agents said:/)).toBeInViewport()
  await expect(row).toBeInViewport()
  const message = thread.locator("[data-slot=bubble-content]", {
    hasText: "sub-agents nested",
  })
  const before = [await placeOf(message), await placeOf(row)]
  await row.click()
  // Who asked it what, its work as one line, its report as quoted prose.
  await expect(row).toHaveAttribute("aria-expanded", "true")
  await expect(thread.getByText("Fake AI asked")).toBeAttached()
  await expect(
    thread.getByRole("button", { name: /^Read a file/ })
  ).toBeAttached()
  const report = thread.locator("[data-slot=subagent-report]")
  // Its work is read as it opens: the row grows to hold it all, below.
  await expect(report).toContainText("alpha")
  expect([await placeOf(message), await placeOf(row)]).toEqual(before)
  await sized(window, 1440)
  await report.scrollIntoViewIfNeeded()
  await expect(report).toBeInViewport()
  // An open row offers nothing to do in step 1: no Stop, no Open beside.
  const opened = thread.locator("[data-slot=subagent]")
  await expect(opened.getByRole("button", { name: /Stop/ })).toHaveCount(0)
  await expect(opened.getByRole("button", { name: /Open beside/ })).toHaveCount(
    0
  )
  await shots(window, "opened")
})

test("a Pane opened while a sub-agent works goes into its Thread's Group", async () => {
  window = await startWindow({
    files: FREE,
    look: LOOK,
    env: { BANDA_SUBAGENTS: "1" },
  })
  const { page, dir } = window
  const { thread, composer } = await firstThread(page)
  writeFileSync(join(dir, "root", "Work", "notes.md"), "one\n")
  await composer.fill("sub-agents slow")
  await composer.press("Enter")
  const row = thread.getByRole("button", { name: "Read a.txt one line" })
  await expect(row.getByRole("img", { name: "Working" })).toBeVisible()
  // A sub-agent calls Banda's tools through its Harness's `banda mcp`,
  // with its Thread's pass: what it opens is its Thread's.
  const { pane } = await agentAnswers(window, "open_pane", {
    kind: "files.file",
    args: { path: "notes.md" },
  })
  const opened = page.locator(`[data-tile="${pane}"]`)
  const group = await plateOf(thread).getAttribute("data-group-plate")
  expect(group).toBeTruthy()
  await expect(plateOf(opened)).toHaveAttribute("data-group-plate", group!)
})

test("a sub-agent that fails stays in its row and the Thread keeps working", async () => {
  window = await declaring()
  const { thread, composer } = await firstThread(window.page)
  await composer.fill("sub-agents fails")
  await composer.press("Enter")
  const row = thread.getByRole("button", { name: "Read a.txt one line" })
  await expect(row.getByRole("img", { name: "Failed" })).toBeVisible()
  await expect(row.getByText("Failed", { exact: true })).toBeVisible()
  await expect(row).toContainText("could not read a.txt.")
  // Its parent goes on, and says so.
  await expect(
    thread.getByText("The sub-agents said: general-purpose failed.")
  ).toBeVisible()
  await shots(window, "failed")
})

test("a window without BANDA_SUBAGENTS draws today's think row", async () => {
  window = await startWindow({ look: LOOK })
  const { thread, composer } = await firstThread(window.page)
  await composer.fill("sub-agents")
  await composer.press("Enter")
  await expect(thread.getByText(/^The sub-agents said:/)).toBeVisible()
  // The Harness speaks as it does to a client that shows no sub-agents:
  // a call titled with the task, among the parent's work.
  await expect(thread.locator("[data-slot=subagent]")).toHaveCount(0)
  await thread.getByRole("button", { name: /^Worked for/ }).click()
  await expect(thread.getByText("Read a.txt one line")).toBeVisible()
  await expect(thread.locator("[data-slot=satellite]")).toHaveCount(0)
  await shots(window, "today")
})
