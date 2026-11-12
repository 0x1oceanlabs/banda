/**
 * A Crew in its Thread (ADR 0103, decisions 18, 19, 26, 30–33): the
 * Question to start it, its card where Claude started it, the live line
 * while it works on after the turn, the line once it ends, a Lost one's
 * Ask Claude to go on, line 2 in the sidebar, and Ultracode's magenta.
 * Banda shows a Crew and stops none of it (Roma's call 11). The fake
 * agent's `crew …` words play one (tools/fake-agent/src/crew.rs); with
 * `FAKE_AGENT_CREW_CUE` it holds in its Fix phase until the cue's file is
 * there.
 */
import { expect, test } from "@playwright/test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { firstThread, sidebarOf, startWindow, type Window } from "./window"

let window: Window

test.afterEach(async () => {
  await window?.close()
})

/** Light, with the glass off, as the mocks' pictures are taken; still, so
 * a window resized for them is drawn at once. */
const LOOK = 'mode = "light"\n[desk]\nglass = false\n[motion]\noff = true\n'

/** Two lines a card, so a working one shows its line 2. */
const TWO_LINES = "card = 2\n"

/** A cue file the fake's Crew waits for in its Fix phase, and how to give
 * it. */
function cued() {
  const path = join(mkdtempSync(join(tmpdir(), "banda-crew-")), "go")
  return {
    env: { FAKE_AGENT_CREW_CUE: path },
    go: () => writeFileSync(path, ""),
  }
}

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
      path: `test-results/thread-crew-${name}-${width}.png`,
    })
  }
  await sized(window, 1440)
}

test("Claude asks to start a Crew; once started its card works on after the turn, and its end comes back before Claude goes on", async () => {
  const cue = cued()
  window = await startWindow({ look: LOOK, sidebar: TWO_LINES, env: cue.env })
  const { thread, composer } = await firstThread(window.page)
  const title = "crew start log"
  await composer.fill(title)
  await composer.press("Enter")

  // The Question to start it, built from the script's meta: its phases,
  // the note, Claude's own answers with their keys, and the script.
  const ask = window.page.locator("[data-slot=crew-start]")
  await expect(thread.getByText("Fake AI wants to start a Crew")).toBeVisible()
  await expect(ask).toContainText("audit-routes")
  await expect(ask).toContainText("Find dead routes and fix them")
  await expect(ask.getByRole("listitem")).toHaveText([
    "1Scanread the routes",
    "2Fixone agent a route",
    "3Verifycheck the build",
  ])
  await expect(ask).toContainText(
    "Up to 16 sub-agents at once · uses your limits faster"
  )
  const start = ask.getByRole("button", { name: /Start/ })
  await expect(start).toHaveAttribute("aria-keyshortcuts", "1 Enter")
  // Claude's "don't ask again" stays as it offers it, as 2.
  await expect(
    ask.getByRole("button", { name: /don't ask again for Workflow/ })
  ).toHaveAttribute("aria-keyshortcuts", "2")
  await expect(
    ask.getByRole("button", { name: "No", exact: true })
  ).toHaveAttribute("aria-keyshortcuts", "Escape")
  // No card while it waits to start.
  await expect(thread.locator("[data-slot=crew]")).toHaveCount(0)
  await ask.getByRole("button", { name: "View script" }).click()
  await expect(window.page.locator("[data-slot=crew-script]")).toContainText(
    "export const meta"
  )
  await shots(window, "start")
  await start.click()

  // The card, where Claude started it: Scan done, Fix at work, Verify not
  // reached; the turn ended, the live line says the Crew works on.
  const card = thread.getByRole("group", { name: "Crew audit-routes" })
  await expect(card).toBeVisible()
  const strip = card.locator("[data-slot=crew-strip] > div")
  await expect(strip.nth(0)).toHaveAttribute("data-when", "past")
  await expect(strip.nth(1)).toHaveAttribute("data-when", "current")
  await expect(strip.nth(1)).toContainText("Fix 1/3")
  await expect(strip.nth(2)).toHaveAttribute("data-when", "future")
  await expect(
    card.getByRole("button", { name: "fix 1 · Done", exact: true })
  ).toBeVisible()
  await expect(card).toContainText("5 agents · 2 working · 3 done")
  await expect(
    thread.getByText("Crew audit-routes is at work · Fix 1/3")
  ).toBeVisible()
  await expect(thread.getByText("· Fake AI goes on when it ends")).toBeVisible()
  // Show only: no Stop on the card.
  await expect(card.getByRole("button", { name: /Stop/ })).toHaveCount(0)
  // Line 2 names the Crew and its phase.
  const sidebar = sidebarOf(window.page)
  await sidebar.getByRole("tab", { name: /^Working/ }).click()
  const row = sidebar
    .getByRole("tabpanel")
    .getByRole("option", { name: new RegExp(`^${title},`) })
  await expect(row.locator(":scope > span").nth(1)).toHaveText(
    "Crew audit-routes · Fix 1/3"
  )
  await shots(window, "at-work")

  // It ends: its line comes back in the place of Claude's going on, then
  // what Claude said; the card is finished, with its log line.
  cue.go()
  await expect(
    thread.getByText(/^Crew audit-routes finished · \d+s$/)
  ).toBeVisible()
  await expect(thread.getByText("· Fake AI went on by itself")).toBeVisible()
  await expect(thread.getByText("The Crew fixed the routes.")).toBeVisible()
  await expect(card).toHaveAttribute("data-state", "done")
  await expect(card.getByLabel(/^6 agents · 3 phases · \d+s$/)).toBeVisible()
  await expect(card).toContainText("phase 3 done")
  await expect(thread.getByText(/^Crew audit-routes is at work/)).toHaveCount(0)
  await shots(window, "finished")
})

test("past 24 agents a phase is a bar with its count", async () => {
  const cue = cued()
  window = await startWindow({ look: LOOK, env: cue.env })
  const { thread, composer } = await firstThread(window.page)
  await composer.fill("crew big")
  await composer.press("Enter")
  const card = thread.getByRole("group", { name: "Crew audit-routes" })
  const fix = card.locator("[data-slot=crew-strip] > div").nth(1)
  await expect(fix).toContainText("1/50")
  await expect(fix.locator("[data-sat]")).toHaveCount(3)
  await expect(fix.getByTitle(/^Fix · 50 agents · 7 working/)).toBeVisible()
  await expect(card).toContainText("42 waiting")
  await shots(window, "big")
  cue.go()
  await expect(card).toHaveAttribute("data-state", "done")
})

test("a Crew whose agent asks between turns docks its Question as the Crew's", async () => {
  window = await startWindow({ look: LOOK })
  const { thread, composer } = await firstThread(window.page)
  await composer.fill("crew asks")
  await composer.press("Enter")
  const question = thread.getByRole("group", { name: "echo ok > d.txt" })
  await expect(question).toContainText(/Crew audit-routes asks · /)
  await question.getByRole("button", { name: /^Yes/ }).click()
  await expect(
    thread.getByRole("group", { name: "Crew audit-routes" })
  ).toHaveAttribute("data-state", "done")
})

test("a Lost Crew offers Ask Claude to go on, a ready message in the composer", async () => {
  window = await startWindow({ look: LOOK })
  const { thread, composer } = await firstThread(window.page)
  await composer.fill("crew dies")
  await composer.press("Enter")
  const card = thread.getByRole("group", { name: "Crew audit-routes" })
  await expect(card).toHaveAttribute("data-state", "lost", { timeout: 20_000 })
  await expect(card).toContainText(/of \d+ done/)
  await shots(window, "lost")
  await card.getByRole("button", { name: "Ask Claude to go on" }).click()
  await expect(composer).toContainText(
    "The Crew audit-routes stopped before it ended"
  )
})

test("Ultracode names itself in the label in the top effort's magenta", async () => {
  window = await startWindow({ look: LOOK })
  const { thread, composer } = await firstThread(window.page)
  await composer.fill("crew ultracode")
  await composer.press("Enter")
  const model = window.page.getByRole("button", { name: /^Model: .*Ultracode/ })
  await expect(model).toBeVisible()
  const word = model.locator("[data-top]")
  await expect(word).toHaveText("Ultracode")
  await expect(word).toHaveClass(/text-effort-top/)
  await expect(
    thread.getByRole("group", { name: "Crew audit-routes" })
  ).toBeVisible()
  await shots(window, "ultracode")
})
