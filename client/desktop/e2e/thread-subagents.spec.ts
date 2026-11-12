/**
 * A Harness's sub-agents in their Thread (ADR 0103, decisions 12–17): a
 * row where each started, a group of the ones one message started, and a
 * row opened in place. Banda shows them and stops none (Roma's call 11).
 * The fake agent's `sub-agents …` words play them
 * (tools/fake-agent/src/subagents.rs).
 */
import { expect, type Locator, test } from "@playwright/test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import {
  agentAnswers,
  desktopOf,
  FREE,
  firstThread,
  plateOf,
  setInFront,
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
  window = await startWindow({ look: LOOK })
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
  // The live line counts the one that asks as at work, and does not wait
  // on the Person for it (ADR 0103, decision 28).
  await expect(thread.getByText("· 3 sub-agents at work")).toBeVisible()
  await expect(
    thread.locator("[data-slot=trace-line]", { hasText: "Waiting for you" })
  ).toHaveCount(0)
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

test("a sub-agent's question docks, names who asks, and its answer reaches it; its row turns to a triangle and back", async () => {
  window = await startWindow({ look: LOOK })
  const { thread, composer } = await firstThread(window.page)
  await composer.fill("sub-agents three asks")
  await composer.press("Enter")
  const question = thread.getByRole("group", { name: "pnpm vitest" })
  // Who asks, in place of the dot and "Needs you", and what it would run,
  // once, in mono.
  const who = question.getByText(/^Reviewer asks · (now|\d+s)$/)
  await expect(who).toBeVisible()
  await expect(who.locator("..")).toHaveClass(/text-attention/)
  await expect(question.getByText("Needs you")).toBeHidden()
  await expect(question.locator("pre")).toHaveText("pnpm vitest")
  await expect(question.locator("p")).toHaveCount(0)
  // Its row, a triangle, says so too.
  const reviewer = thread.getByRole("button", { name: "Reviewer" })
  await expect(reviewer.getByRole("img", { name: "Asks" })).toBeVisible()
  await shots(window, "asks")
  // The answer goes to it: it runs on and the three end.
  await question.getByRole("button", { name: /^Yes/ }).click()
  await expect(question).toBeHidden()
  await expect(thread.getByText(/^The sub-agents said:/)).toBeVisible()
  const ran = thread.getByRole("button", { name: /^Ran 3 sub-agents/ })
  await ran.click()
  await expect(reviewer.getByRole("img", { name: "Asks" })).toBeHidden()
  await expect(reviewer.getByRole("img", { name: "Done" })).toBeVisible()
  await shots(window, "answered")
})

test("the notice of a sub-agent's question says who asks", async () => {
  window = await startWindow()
  const { app, page } = window
  const { composer } = await firstThread(page)
  await composer.fill("sub-agents three asks")
  // The window is behind as it comes: seen, it would be told in no notice.
  await setInFront(page, false)
  await composer.press("Enter")
  await expect.poll(async () => (await desktopOf(app)).shown.length).toBe(1)
  expect((await desktopOf(app)).shown[0]).toMatchObject({
    title: "Reviewer asks · sub-agents three asks",
    body: "pnpm vitest",
    answer: "Answer",
    lasts: true,
  })
})

test("a row opens in place and nothing above it moves", async () => {
  window = await startWindow({ look: LOOK })
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
  // An open row offers Open beside, and no Stop: Banda shows sub-agents
  // and manages none (ADR 0103, call 11).
  const opened = thread.locator("[data-slot=subagent]")
  await expect(opened.getByRole("button", { name: /Stop/ })).toHaveCount(0)
  await expect(
    opened.getByRole("button", { name: "Open beside" })
  ).toBeVisible()
  await shots(window, "opened")
})

test("a Pane opened while a sub-agent works goes into its Thread's Group", async () => {
  window = await startWindow({ files: FREE, look: LOOK })
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
  window = await startWindow({ look: LOOK })
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

test("the live line names the sub-agents at work", async () => {
  window = await startWindow({ look: LOOK })
  const { thread, composer } = await firstThread(window.page)
  await composer.fill("sub-agents slow three")
  await composer.press("Enter")
  await expect(thread.getByText(/^Working for/)).toBeVisible()
  await expect(thread.getByText("· 3 sub-agents at work")).toBeVisible()
  await shots(window, "live-line")
})

test("the live line says which sub-agent it waits on when one is at work", async () => {
  window = await startWindow({ look: LOOK })
  const { thread, composer } = await firstThread(window.page)
  await composer.fill("sub-agents slow")
  await composer.press("Enter")
  await expect(thread.getByText(/^Working for/)).toBeVisible()
  await expect(
    thread.getByText("· Waiting on Read a.txt one line")
  ).toBeVisible()
  await shots(window, "live-line-one")
})

test("sub-agents that outlive their turn keep the live line, and the composer stays free", async () => {
  window = await startWindow({ look: LOOK })
  const { thread, composer } = await firstThread(window.page)
  await composer.fill("sub-agents outlive slow")
  await composer.press("Enter")
  await expect(thread.getByText(/^The sub-agents said:/)).toBeVisible()
  await expect(thread.getByText(/^Working for/)).toBeHidden()
  // The line goes on at the Thread's end: a working satellite in the
  // spinner's place, and no clock.
  const line = thread.locator("[data-slot=trace-line]", {
    hasText: "1 sub-agent at work",
  })
  await expect(line).toContainText("· Fake AI goes on when it ends")
  await expect(line.locator('[data-sat="working"]')).toBeAttached()
  await expect(
    thread.locator("[data-slot=message-scroller-item]").last()
  ).toContainText("1 sub-agent at work")
  await expect(line).not.toHaveText(/\d+s/)
  await shots(window, "outlive")
  // A narrow Thread cuts the muted tail first, and keeps who is at work.
  await sized(window, 480)
  const title = line.locator("[data-slot=trace-title]")
  await expect
    .poll(() => title.evaluate((one) => one.scrollWidth <= one.clientWidth))
    .toBe(true)
  await window.page.screenshot({
    path: "test-results/thread-subagents-outlive-narrow.png",
  })
  await sized(window, 1440)
  // No turn runs: the composer is an idle Thread's, with no Stop, and a
  // message starts a new turn while the sub-agent works on.
  await expect(composer).toHaveAttribute(
    "aria-placeholder",
    /^Write to Fake AI\. /
  )
  await expect(
    thread.getByRole("button", { name: "Stop", exact: true })
  ).toHaveCount(0)
  await composer.fill("hello")
  await composer.press("Enter")
  await expect(thread.getByText("You said: hello")).toBeVisible()
  await expect(line).toBeVisible()
})

/** The Pane beside a Thread that shows its sub-agents, and its parts. */
function besidePane(page: Window["page"]) {
  const pane = page.locator("[data-slot=subagent-pane]")
  return {
    pane,
    tile: page.locator("[data-tile]", { has: pane }),
    title: pane.getByRole("heading", { level: 2 }),
    crumbs: pane.getByRole("navigation", { name: "Where it is" }),
    status: pane.locator("[data-slot=subagent-status]"),
    brief: pane.locator("[data-slot=subagent-brief]"),
  }
}

/** Opens sub-agent `name` of `scope` beside, by its row's Open beside,
 * which the pointer shows in its time's place, and the keys reach; or, as
 * `words` says, by the same button's Open, over its Thread. By the keys
 * here: the window under test matches no (hover: hover), which Tailwind's
 * hover asks for. */
async function openBeside(scope: Locator, name: string, words = "Open beside") {
  const label = scope.page().getByRole("button", { name, exact: true })
  const row = scope.getByRole("button", { name, exact: true })
  await row.hover()
  await scope
    .locator("[data-slot=subagent]")
    .filter({ has: label })
    .getByRole("button", { name: words, exact: true })
    .press("Enter")
  return row
}

test("Open beside shows a sub-agent in its Thread's Group, live to its end", async () => {
  window = await startWindow({
    look: LOOK,
    env: { FAKE_AGENT_OUTLIVES_BY: "8000" },
  })
  const { page } = window
  const { thread, composer } = await firstThread(page)
  await composer.fill("sub-agents outlive")
  await composer.press("Enter")
  const row = thread.getByRole("button", { name: "Read a.txt one line" })
  await expect(row.getByRole("img", { name: "Working" })).toBeVisible()
  // Its row opened offers it; it opens in the Thread's Group.
  await row.click()
  await thread
    .locator("[data-slot=subagent]")
    .getByRole("button", { name: "Open beside" })
    .click()
  const beside = besidePane(page)
  await expect(beside.pane).toBeVisible()
  const group = await plateOf(thread).getAttribute("data-group-plate")
  expect(group).toBeTruthy()
  await expect(plateOf(beside.tile)).toHaveAttribute("data-group-plate", group!)
  // Its header names it and its Thread; its brief is the Harness's.
  await expect(beside.title).toHaveText("Read a.txt one line")
  await expect(beside.pane).toContainText("sub-agent of sub-agents outlive")
  await expect(beside.brief).toContainText("Fake AI asked")
  await expect(beside.brief).toContainText(
    "Read a.txt and answer with its first line only."
  )
  await expect(beside.brief.locator("[data-slot=bubble-content]")).toBeVisible()
  // The status bar in the composer's place, with no text box and no Stop.
  await expect(beside.status).toHaveAttribute(
    "aria-label",
    /^Working( · Haiku 5\.5)? · Runs on its own$/
  )
  await expect(beside.pane.getByRole("textbox")).toHaveCount(0)
  await expect(beside.pane.getByRole("button", { name: /Stop/ })).toHaveCount(0)
  // The row it shows stays lit.
  await expect(thread.locator("[data-slot=subagent]")).toHaveAttribute(
    "data-lit",
    "true"
  )
  await shots(window, "beside-working")
  // It follows the lane: its answer, then how it ended, with a still
  // duration.
  await expect(beside.status).toHaveAttribute(
    "aria-label",
    /^Done · Haiku 5\.5 · \d+s · Returned its answer to Fake AI$/,
    { timeout: 20_000 }
  )
  await expect(beside.status).toContainText("Done")
  await expect(beside.pane).toContainText("alpha")
  await shots(window, "beside-done")
})

test("a Thread has one sub-agent Pane: another row's Open beside shows that one in it", async () => {
  window = await startWindow({ look: LOOK })
  const { page } = window
  const { thread, composer } = await firstThread(page)
  await composer.fill("sub-agents three")
  await composer.press("Enter")
  await expect(thread.getByText(/^The sub-agents said:/)).toBeVisible()
  await thread.getByRole("button", { name: /^Ran 3 sub-agents/ }).click()
  const rows = thread.locator("[data-slot=subagent]")
  await expect(rows).toHaveCount(3)
  const beside = besidePane(page)
  const explore = await openBeside(thread, "Explore")
  await expect(beside.title).toHaveText("Explore")
  // Its model is not its Thread's: the bar says it.
  await expect(beside.status).toHaveAttribute(
    "aria-label",
    /^Done · Haiku 5\.5 · \d+s · Returned its answer to Fake AI$/
  )
  const lit = thread.locator("[data-slot=subagent][data-lit]")
  await expect(lit).toHaveCount(1)
  await expect(
    lit.getByRole("button", { name: "Explore", exact: true })
  ).toBeVisible()
  const tile = await beside.tile.getAttribute("data-tile")
  // Another sub-agent: the same Pane, which shows it now, and its row is
  // the one lit.
  // Back in the Thread, whose composer takes the focus as it comes.
  await composer.click()
  const reviewer = await openBeside(thread, "Reviewer")
  await expect(beside.title).toHaveText("Reviewer")
  await expect(beside.pane).toHaveCount(1)
  await expect(beside.tile).toHaveAttribute("data-tile", tile!)
  await expect(lit).toHaveCount(1)
  await expect(
    lit.getByRole("button", { name: "Reviewer", exact: true })
  ).toBeVisible()
  await expect(explore).toBeVisible()
  await expect(reviewer).toBeVisible()
  await shots(window, "beside-another")
})

test("a nested sub-agent opens deeper in the same Pane, with its crumbs, and Esc goes back up", async () => {
  window = await startWindow({ look: LOOK })
  const { page } = window
  const { thread, composer } = await firstThread(page)
  await composer.fill("sub-agents nested")
  await composer.press("Enter")
  await expect(thread.getByText(/^The sub-agents said:/)).toBeVisible()
  await openBeside(thread, "Read a.txt one line")
  const beside = besidePane(page)
  await expect(beside.title).toHaveText("Read a.txt one line")
  await expect(beside.crumbs).toHaveCount(0)
  // Its own sub-agent is a row in it, one level down.
  await expect(beside.pane.locator("[data-slot=subagent]")).toHaveCount(1)
  await openBeside(beside.pane, "Explore")
  // Deeper: the crumbs from its Thread, its label, then its title muted;
  // its parent asked it.
  await expect(beside.title).toHaveText("Explore")
  await expect(beside.crumbs.getByRole("button")).toHaveText([
    "sub-agents nested",
    "Read a.txt one line",
  ])
  await expect(beside.pane).toContainText("Find b.txt")
  await expect(beside.brief).toContainText("Read a.txt one line asked")
  await expect(beside.brief).toContainText(
    "Read b.txt and answer with its first line only."
  )
  await expect(beside.pane).toContainText("bravo")
  await expect(beside.status).toHaveAttribute(
    "aria-label",
    /^Done · .* · Returned its answer to Read a\.txt one line$/
  )
  // Its Thread lights the row it went from.
  await expect(thread.locator("[data-slot=subagent]")).toHaveAttribute(
    "data-lit",
    "true"
  )
  await shots(window, "beside-nested")
  // Esc goes one level up; at the top it does nothing new.
  await page.keyboard.press("Escape")
  await expect(beside.title).toHaveText("Read a.txt one line")
  await expect(beside.crumbs).toHaveCount(0)
  await page.keyboard.press("Escape")
  await expect(beside.title).toHaveText("Read a.txt one line")
  await expect(beside.pane).toBeVisible()
  // A crumb goes to its level, the Thread's to the Thread.
  await openBeside(beside.pane, "Explore")
  await beside.crumbs
    .getByRole("button", { name: "Read a.txt one line" })
    .click()
  await expect(beside.title).toHaveText("Read a.txt one line")
  await openBeside(beside.pane, "Explore")
  await beside.crumbs.getByRole("button", { name: "sub-agents nested" }).click()
  await expect(thread).toHaveAttribute("data-focused", "true")
})

test("a Codex sub-agent with no name opens beside by its number, its answer returned to its Harness", async () => {
  window = await startWindow({ look: LOOK })
  const { page } = window
  const { thread, composer } = await firstThread(page)
  await composer.fill("sub-agents codex unnamed")
  await composer.press("Enter")
  await expect(thread.getByText(/^The sub-agents said:/)).toBeVisible()
  await openBeside(thread, "Agent 1")
  const beside = besidePane(page)
  await expect(beside.title).toHaveText("Agent 1")
  await expect(beside.pane).toContainText(
    "sub-agent of sub-agents codex unnamed"
  )
  await expect(beside.status).toHaveAttribute(
    "aria-label",
    /^Done · 6 Luna · \d+s · Returned its answer to Fake AI$/
  )
})

test("Ask about it starts the Thread's message with the sub-agent's chip, and its bubble shows it sent", async () => {
  window = await startWindow({
    look: LOOK,
    env: { FAKE_AGENT_OUTLIVES_BY: "8000" },
  })
  const { page } = window
  const { thread, composer } = await firstThread(page)
  await composer.fill("sub-agents outlive")
  await composer.press("Enter")
  const row = thread.getByRole("button", { name: "Read a.txt one line" })
  await expect(row.getByRole("img", { name: "Working" })).toBeVisible()
  await openBeside(thread, "Read a.txt one line")
  const beside = besidePane(page)
  // At the status bar's end, by the Thread's Harness, as it works.
  const ask = beside.status.getByRole("button", {
    name: "Ask Fake AI about it",
  })
  await expect(ask).toBeVisible()
  // What is written already stays, after the chip.
  await composer.fill("why so slow?")
  await ask.click()
  await expect(composer).toBeFocused()
  const chip = composer.locator("[data-chip=subagent]")
  await expect(chip).toHaveCount(1)
  await expect(chip).toHaveText("Read a.txt one line")
  await expect(composer).toHaveText("Read a.txt one line why so slow?")
  // The caret is after the chip and its space: typing goes there.
  await page.keyboard.type("tell me ")
  await expect(composer).toHaveText("Read a.txt one line tell me why so slow?")
  // Asked again, the chip is there already.
  await ask.click()
  await expect(composer).toBeFocused()
  await expect(chip).toHaveCount(1)
  await composer.press("Enter")
  // Sent, the bubble shows the chip, not the words that stand for it.
  const sent = thread.locator("[data-slot=subagent-chip]")
  await expect(sent).toHaveText("Read a.txt one line")
  await expect(sent.getByRole("img")).toBeVisible()
  await expect(thread).not.toContainText("(about sub-agent")
  await expect(composer.locator("[data-chip]")).toHaveCount(0)
  // Done, it is offered still.
  await expect(beside.status).toHaveAttribute("aria-label", /^Done/, {
    timeout: 20_000,
  })
  await expect(ask).toBeVisible()
})

test("what the Agent writes to a sub-agent after its brief is a row in the Thread and a bubble in its Pane", async () => {
  window = await startWindow({ look: LOOK })
  const { page } = window
  const { thread, composer } = await firstThread(page)
  await composer.fill("sub-agents again")
  await composer.press("Enter")
  // Where the Agent sent it: "Messaged", its label, then its words.
  const messaged = thread.locator("[data-slot=messaged]")
  await expect(messaged).toHaveText(
    /^Messaged Read a\.txt one line\s*· Read it once more\.$/
  )
  await expect(thread.getByText(/^The sub-agents said:/)).toBeVisible()
  await openBeside(thread, "Read a.txt one line")
  const beside = besidePane(page)
  // Its first brief stays the brief; what came after is a bubble of its
  // own, among its work.
  await expect(beside.brief).toContainText("Fake AI asked")
  const wrote = beside.pane.locator("[data-slot=subagent-wrote]")
  await expect(wrote).toContainText("Fake AI wrote")
  await expect(wrote).toContainText("Read it once more.")
  await expect(beside.pane.locator("[data-slot=messaged]")).toHaveCount(0)
  // Each time it was set to work folds its own work: both its replies show.
  const replies = beside.pane.getByText("alpha", { exact: true })
  await expect(replies).toHaveCount(2)
  await expect(replies.first()).toBeVisible()
})

test("a message queued for a sub-agent at work is a row with no words", async () => {
  window = await startWindow({ look: LOOK })
  const { page } = window
  const { thread, composer } = await firstThread(page)
  await composer.fill("sub-agents queued")
  await composer.press("Enter")
  const messaged = thread.locator("[data-slot=messaged]")
  await expect(messaged).toHaveText("Messaged Read a.txt one line")
  await expect(thread.getByText(/^The sub-agents said:/)).toBeVisible()
  await openBeside(thread, "Read a.txt one line")
  // Its words never came: no bubble in its Pane.
  const beside = besidePane(page)
  await expect(beside.brief).toBeVisible()
  await expect(beside.pane.locator("[data-slot=subagent-wrote]")).toHaveCount(0)
})

/** The screens over a Thread in `scope`, where its Pane is alone, and the
 * parts of the one on top. */
function screenOf(scope: Locator) {
  const screen = scope.locator("[data-slot=subagent-screen]:not([inert])")
  return {
    all: scope.locator("[data-slot=subagent-screen]"),
    screen,
    title: screen.getByRole("heading", { level: 2 }),
    back: screen.getByRole("button", { name: "Back", exact: true }),
    status: screen.locator("[data-slot=subagent-status]"),
    brief: screen.locator("[data-slot=subagent-brief]"),
  }
}

/** The Thread `thread` shows, by its tile, which stays found while a
 * screen hides its composer. */
async function tileOf(thread: Locator) {
  const tile = await thread.getAttribute("data-tile")
  return thread.page().locator(`[data-tile="${tile}"]`)
}

test("in a narrow window a sub-agent opens over its Thread as a screen, and ← and Esc go back to it as it was", async () => {
  window = await startWindow({ look: LOOK })
  const { page } = window
  const { thread, composer } = await firstThread(page)
  const tile = await tileOf(thread)
  // Narrower than the sidebar and a column: the sidebar hides, and
  // nothing can be drawn beside the Thread.
  await sized(window, 728)
  await expect(
    page.getByRole("complementary", { name: "Sidebar" })
  ).toBeHidden()
  await composer.fill("sub-agents nested")
  await composer.press("Enter")
  await expect(tile.getByText(/^The sub-agents said:/)).toBeVisible()
  await composer.fill("a draft")
  const view = tile.locator("[data-slot=message-scroller-viewport]")
  await expect
    .poll(() => view.evaluate((one) => one.scrollHeight > one.clientHeight))
    .toBe(false)
  // Its row's button reads Open, opened or not.
  const row = tile.getByRole("button", {
    name: "Read a.txt one line",
    exact: true,
  })
  await row.click()
  const opened = tile.locator("[data-slot=subagent]")
  await expect(opened.getByRole("button", { name: "Open beside" })).toHaveCount(
    0
  )
  await opened.getByRole("button", { name: "Open", exact: true }).click()
  // The screen covers the Thread, its composer included, under the Pane's
  // own header: ←, its label and its Thread, then its brief and work.
  const over = screenOf(tile)
  await expect(over.screen).toBeVisible()
  await expect(over.screen).toBeFocused()
  await expect(over.title).toHaveText("Read a.txt one line")
  await expect(over.screen).toContainText("sub-agent of sub-agents nested")
  await expect(over.brief).toContainText("Fake AI asked")
  await expect(over.screen).toContainText("alpha")
  await expect(composer).toBeHidden()
  await expect(
    tile.getByRole("button", { name: "Close sub-agents nested" })
  ).toBeVisible()
  // Its status bar at the bottom, with no text box and no Stop.
  await expect(over.status).toHaveAttribute("aria-label", /^Done · /)
  await expect(
    over.status.getByRole("button", { name: "Ask Fake AI about it" })
  ).toBeVisible()
  await expect(over.screen.getByRole("textbox")).toHaveCount(0)
  await expect(over.screen.getByRole("button", { name: /Stop/ })).toHaveCount(0)
  // The window was asked for no Pane.
  await expect(page.locator("[data-slot=subagent-pane]")).toHaveCount(0)
  await page.screenshot({ path: "test-results/thread-subagents-screen.png" })
  // ← goes back to the Thread as it was: its draft, and the row it went
  // from focused.
  await over.back.click()
  await expect(over.all).toHaveCount(0)
  await expect(composer).toHaveText("a draft")
  await expect(row).toBeFocused()
  // Esc too.
  await opened.getByRole("button", { name: "Open", exact: true }).click()
  await expect(over.title).toHaveText("Read a.txt one line")
  await page.keyboard.press("Escape")
  await expect(over.all).toHaveCount(0)
  await expect(row).toBeFocused()

  // Its own sub-agent is one more screen, in place of the breadcrumb, and
  // Esc goes up one level at a time.
  await opened.getByRole("button", { name: "Open", exact: true }).click()
  await openBeside(over.screen, "Explore", "Open")
  await expect(over.all).toHaveCount(2)
  await expect(over.title).toHaveText("Explore")
  await expect(over.screen).toContainText("sub-agent of Read a.txt one line")
  await expect(over.screen.getByRole("navigation")).toHaveCount(0)
  await expect(over.brief).toContainText("Read a.txt one line asked")
  await expect(over.screen).toContainText("bravo")
  await page.screenshot({
    path: "test-results/thread-subagents-screen-nested.png",
  })
  await page.keyboard.press("Escape")
  await expect(over.all).toHaveCount(1)
  await expect(over.title).toHaveText("Read a.txt one line")
  await expect(
    over.screen.getByRole("button", { name: "Explore", exact: true })
  ).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(over.all).toHaveCount(0)
  await expect(row).toBeFocused()
  await expect(page.locator("[data-slot=subagent-pane]")).toHaveCount(0)

  // Where the bar is narrow, its button goes to a second line, under its
  // words.
  await opened.getByRole("button", { name: "Open", exact: true }).click()
  await sized(window, 400)
  const words = over.status.locator("p")
  const ask = over.status.getByRole("button")
  const box = async (part: Locator) => (await part.boundingBox())!
  await expect
    .poll(async () => (await box(ask)).y)
    .toBeGreaterThan((await box(words)).y + (await box(words)).height - 1)
  // The button moves there as it moves anywhere: once it is there.
  await expect
    .poll(async () => Math.round((await box(ask)).x - (await box(words)).x))
    .toBe(0)
  await page.screenshot({
    path: "test-results/thread-subagents-screen-400.png",
  })
})

test("Ask Claude about it from a screen goes back to the Thread, its composer focused with the sub-agent's chip", async () => {
  window = await startWindow({ look: LOOK })
  const { page } = window
  const { thread, composer } = await firstThread(page)
  const tile = await tileOf(thread)
  await sized(window, 728)
  await composer.fill("sub-agents nested")
  await composer.press("Enter")
  await expect(tile.getByText(/^The sub-agents said:/)).toBeVisible()
  await composer.fill("why?")
  await openBeside(tile, "Read a.txt one line", "Open")
  const over = screenOf(tile)
  await openBeside(over.screen, "Explore", "Open")
  await expect(over.all).toHaveCount(2)
  await over.status
    .getByRole("button", { name: "Ask Fake AI about it" })
    .click()
  // Every screen goes; the composer has the chip, then what was written.
  await expect(over.all).toHaveCount(0)
  await expect(composer).toBeFocused()
  const chip = composer.locator("[data-chip=subagent]")
  await expect(chip).toHaveText("Explore")
  await expect(composer).toHaveText("Explore why?")
})

test("in the Drawer a sub-agent opens over its Thread, and Esc goes back without lifting the Drawer", async () => {
  window = await startWindow({ look: LOOK })
  const { page } = window
  await firstThread(page)
  const drawer = page.getByRole("dialog", { name: "Drawer" })
  await page.keyboard.press("Alt+Backquote")
  await expect(drawer).toHaveAttribute("data-drawer")
  const ask = drawer.getByRole("textbox", { name: "Message to Fake AI" })
  await ask.fill("sub-agents three")
  await ask.press("Enter")
  await expect(drawer.getByText(/^The sub-agents said:/)).toBeVisible()
  await drawer.getByRole("button", { name: /^Ran 3 sub-agents/ }).click()
  const reviewer = await openBeside(drawer, "Reviewer", "Open")
  const over = screenOf(drawer)
  await expect(over.title).toHaveText("Reviewer")
  await expect(over.status).toBeVisible()
  await expect(page.locator("[data-slot=subagent-pane]")).toHaveCount(0)
  await page.screenshot({
    path: "test-results/thread-subagents-screen-drawer.png",
  })
  // Esc goes back to the Thread, and the Drawer stays dropped.
  await page.keyboard.press("Escape")
  await expect(over.all).toHaveCount(0)
  await expect(drawer).toHaveAttribute("data-drawer")
  await expect(reviewer).toBeFocused()
  await expect(ask).toBeVisible()
  // Then Esc lifts it, as ever.
  await page.keyboard.press("Escape")
  await expect(drawer).not.toHaveAttribute("data-drawer")
})
