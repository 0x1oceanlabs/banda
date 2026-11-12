/**
 * The Crew Pane (ADR 0103, decision 22; mock 03): it opens by itself once
 * a Crew, beside its Thread, and stays closed once closed; its header
 * names the Crew and its Thread, with Phases, Timeline and a menu, and no
 * Stop; its phases are columns when it is wide and bands when it is
 * narrow; a click on an agent shows its detail, which Esc closes; once the
 * Crew ended its Result stands on top. Where the Thread's Pane is alone,
 * the Crew opens over it as a screen on top. The fake agent's `crew …`
 * words play one (tools/fake-agent/src/crew.rs); `rich` makes its agents
 * say what Claude's do, and `FAKE_AGENT_CREW_CUE` holds it in its Fix
 * phase until the cue's file is there.
 */
import { expect, type Locator, type Page, test } from "@playwright/test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { firstThread, startWindow, type Window } from "./window"

let window: Window

test.afterEach(async () => {
  await window?.close()
})

/** Light, with the glass off, as the mocks' pictures are taken; still, so
 * a window resized for them is drawn at once. */
const LOOK = 'mode = "light"\n[desk]\nglass = false\n[motion]\noff = true\n'

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

/** A picture of the window as it is now. */
async function shot(page: Page, name: string) {
  await page.screenshot({ path: `test-results/crew-pane-${name}.png` })
}

/** The Crew Pane and its parts. */
function crewPane(page: Page) {
  const pane = page.locator("[data-slot=crew-pane]")
  return {
    pane,
    tile: page.locator("[data-tile]", { has: pane }),
    body: pane.locator("[data-slot=crew-body]"),
    summary: pane.locator("[data-slot=crew-summary]"),
    agent: pane.locator("[data-slot=crew-agent]"),
  }
}

/** Sends `words` in the first Thread; its Crew's card once it shows. */
async function started(page: Page, words: string) {
  const { thread, composer } = await firstThread(page)
  await composer.fill(words)
  await composer.press("Enter")
  const card = thread.locator("[data-slot=crew]")
  await expect(card).toBeVisible()
  return { thread, composer, card }
}

/** A row of agent `key` ("2.3") in `scope`. */
const row = (scope: Locator, key: string) =>
  scope.locator(`[data-agent="${key}"]`).first()

test("a Crew's Pane opens by itself beside its Thread, wide in columns, with no Stop, and stays closed once closed", async () => {
  const cue = cued()
  window = await startWindow({ look: LOOK, env: cue.env })
  const { page } = window
  await sized(window, 1920, 1000)
  const { thread, card } = await started(page, "crew rich long log")
  const crew = crewPane(page)
  // By itself, beside the Thread; the focus stays in the Thread.
  await expect(crew.pane).toBeVisible()
  await expect(thread.getByRole("textbox")).toBeFocused()
  const header = crew.pane.locator("header")
  await expect(header.getByRole("heading", { level: 2 })).toHaveText(
    "Crew · audit-routes"
  )
  await expect(header).toContainText("from crew rich long log")
  await expect(header.getByRole("tab")).toHaveText(["Phases", "Timeline"])
  // Shows only: no Stop anywhere in it (Roma's call 11).
  await expect(crew.pane.getByRole("button", { name: /stop/i })).toHaveCount(0)
  // Held in Fix: its columns, one a phase.
  await expect(crew.body).toHaveAttribute("data-wide", "true")
  const columns = crew.pane.locator("[data-slot=crew-columns] > section")
  await expect(columns).toHaveCount(3)
  await expect(columns.nth(0)).toContainText("Scan")
  await expect(columns.nth(1)).toContainText("Fix")
  await expect(columns.nth(2)).toContainText("Not started yet")
  await expect(crew.summary).toContainText(/^5 agents/)
  await expect(crew.summary).toContainText("tokens")
  await expect(row(columns.nth(1), "2.2")).toContainText("attempt 2")
  await shot(page, "wide")

  // A dot in the Thread's card picks its agent here: its detail.
  await card.getByRole("button", { name: /hosts\/pair\.ts/ }).click()
  await expect(crew.agent).toBeVisible()
  await expect(crew.agent).toContainText("Fix · 3 of 3")
  await expect(crew.agent).toContainText("Brief")
  await expect(crew.agent).toContainText("Comes when it ends.")
  await shot(page, "detail")
  // Esc closes it.
  await crew.agent.getByRole("button", { name: "Close the agent" }).focus()
  await page.keyboard.press("Escape")
  await expect(crew.agent).toHaveCount(0)

  // The Timeline: a lane an agent, and now.
  // A few seconds into Fix, so its lanes have a length.
  await page.waitForTimeout(3000)
  await crew.pane.getByRole("tab", { name: "Timeline" }).click()
  const timeline = crew.pane.locator("[data-slot=crew-timeline]")
  await expect(timeline).toContainText("now")
  await expect(row(timeline, "1.1")).toBeVisible()
  await shot(page, "timeline")
  await crew.pane.getByRole("tab", { name: "Phases" }).click()

  // Closed, it stays closed for that Crew as it works on and ends.
  await crew.pane.getByRole("button", { name: /^Close Crew/ }).click()
  await expect(crew.pane).toHaveCount(0)
  cue.go()
  await expect(card).toHaveAttribute("data-state", "done", { timeout: 30_000 })
  await expect(crew.pane).toHaveCount(0)

  // Open on its card opens it again: done, its Result on top.
  await card.getByRole("button", { name: "Open", exact: true }).click()
  await expect(crew.pane).toBeVisible()
  const result = crew.pane.locator("[data-slot=crew-result]")
  await expect(result).toContainText("Fixed 3 dead routes; the build passes.")
  await expect(result).toContainText(/returned to Fake AI at/)
  await expect(row(columns.nth(1), "2.3")).toContainText("Failed")
  await shot(page, "finished")
  // Its menu: View script, Copy result.
  await crew.pane.getByRole("button", { name: "Crew menu" }).click()
  await expect(
    page.getByRole("menuitem", { name: "Copy result" })
  ).toBeEnabled()
  await page.getByRole("menuitem", { name: "View script" }).click()
  await expect(crew.pane.locator("[data-slot=crew-script]")).toContainText(
    "export const meta"
  )
})

test("narrow, a Crew of fifty agents is in bands: those at work show, the done fold, the queued wait for a slot", async () => {
  const cue = cued()
  window = await startWindow({ look: LOOK, env: cue.env })
  const { page } = window
  await sized(window, 1440)
  await started(page, "crew rich big")
  const crew = crewPane(page)
  await expect(crew.pane).toBeVisible()
  await expect(crew.body).not.toHaveAttribute("data-wide")
  const bands = crew.pane.locator("[data-slot=crew-bands] > section")
  await expect(bands).toHaveCount(3)
  await expect(crew.summary).toContainText(/^52 agents/)
  const fix = bands.nth(1)
  await expect(fix).toContainText(/\d+ waiting for a slot/)
  await expect(fix.getByRole("button", { name: /^\d+ done$/ })).toBeVisible()
  await expect(
    bands.nth(0).getByRole("button", { name: "2 done" })
  ).toBeVisible()
  await shot(page, "narrow-50")
  // The filter keeps those at work alone, and folds none.
  await crew.pane.getByRole("radio", { name: "Working" }).click()
  await expect(fix).not.toContainText("waiting for a slot")
  await crew.pane.getByRole("radio", { name: "All" }).click()
  // Narrow, an agent's detail takes the list's place, under its
  // breadcrumb; Esc goes back to the list.
  await row(fix, "2.2").click()
  await expect(crew.agent.getByRole("navigation")).toHaveText(
    /audit-routes.*Fix.*keys\.ts/
  )
  await expect(bands).toHaveCount(0)
  await shot(page, "narrow-detail")
  await page.keyboard.press("Escape")
  await expect(bands).toHaveCount(3)
  cue.go()
})

test("in a narrow window the Crew opens over its Thread as a screen on top, and ← and Esc go back", async () => {
  const cue = cued()
  window = await startWindow({ look: LOOK, env: cue.env })
  const { page } = window
  const { thread, composer } = await firstThread(page)
  // Narrower than the sidebar and a column: nothing can be drawn beside
  // the Thread.
  await sized(window, 728)
  await composer.fill("crew rich long")
  await composer.press("Enter")
  const card = thread.locator("[data-slot=crew]")
  await expect(card).toBeVisible()
  const tile = page.locator(
    `[data-tile="${await thread.getAttribute("data-tile")}"]`
  )
  // Alone, nothing opens by itself: a screen would cover the composer.
  await expect(page.locator("[data-slot=crew-pane]")).toHaveCount(0)
  await card.getByRole("button", { name: "Open", exact: true }).click()
  const screen = tile.locator("[data-slot=crew-screen]")
  await expect(screen).toBeVisible()
  await expect(screen).toBeFocused()
  await expect(screen.getByRole("heading", { level: 2 })).toHaveText(
    "Crew · audit-routes"
  )
  await expect(screen.locator("[data-slot=crew-bands] > section")).toHaveCount(
    3
  )
  await expect(screen.getByRole("button", { name: /stop/i })).toHaveCount(0)
  // Once what it covers has faded out.
  await page.waitForTimeout(400)
  await shot(page, "screen")
  // An agent, then Esc back to the list, then Esc back to the Thread.
  await row(screen, "2.1").click()
  await expect(screen.locator("[data-slot=crew-agent]")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(screen.locator("[data-slot=crew-agent]")).toHaveCount(0)
  await page.keyboard.press("Escape")
  await expect(screen).toHaveCount(0)
  await expect(thread.getByRole("textbox")).toBeVisible()
  // A dot opens the screen on its agent; ← goes back.
  await card.locator("[data-slot=crew-strip] button").first().click()
  await expect(screen.locator("[data-slot=crew-agent]")).toBeVisible()
  await screen.getByRole("button", { name: "Back", exact: true }).click()
  await screen.getByRole("button", { name: "Back", exact: true }).click()
  await expect(screen).toHaveCount(0)
  cue.go()
})
