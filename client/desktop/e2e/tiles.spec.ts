/**
 * A Tile's state, as its terminal keeps it (ADR 0088, decision 4): on
 * screen, a terminal draws as it prints; just past the screen's edge, as
 * the column beside a Strip scrolled by the least is, or on a workspace
 * away, it draws nothing; and as it comes back, by keys, by a hand's
 * swipe or with its workspace, it has drawn what it printed meanwhile
 * before the first frame that shows it, so no stale screen is ever seen.
 * One far off screen draws nothing either, which motion.spec gates.
 *
 * It counts with motion-probe.ts: each terminal's draws, on screen and
 * off, when it came on screen, and the text it drew before.
 */
import { join } from "node:path"
import { writeFileSync } from "node:fs"
import { expect, test, type Page } from "@playwright/test"
import { install, read, reset, resetTexts } from "./motion-probe"
import { newTerminal, startWindow, textOf, type Window } from "./window"

let window: Window

test.afterEach(async () => {
  await window?.close()
})

/** A shell loop that prints a numbered line into `printed` and on its
 * screen until `stop` is there, then the last number, `stopped-N`. */
const printing = (stop: string, printed: string) =>
  `i=0; while [ ! -e ${stop} ]; do i=$((i+1)); echo "line-$i" | tee -a ${printed}; sleep 0.02; done; echo "stopped-$i" | tee -a ${printed}`

/** The last line printed into `printed`, once it stopped. */
const stopped = async (printed: string) => {
  await expect.poll(() => textOf(printed)).toMatch(/stopped-\d+/)
  return textOf(printed).match(/stopped-\d+/)![0]
}

/** Terminal `n`'s counts since the probe's last reset. */
const counted = async (page: Page, n: number) =>
  (await page.evaluate(read)).terminals[n]

/** Once terminal `n` came on screen: the text it drew before. */
const drewBefore = async (page: Page, n: number) => {
  await expect
    .poll(async () => (await counted(page, n)).came)
    .toBeGreaterThan(0)
  return (await counted(page, n)).before
}

test("a terminal draws nothing while it is hidden, and has drawn what it printed as it shows again", async () => {
  test.setTimeout(150_000)
  window = await startWindow()
  const { page, dir } = window
  // Every Tile is hidden while the window is away: this one is not.
  expect(await page.evaluate(() => document.visibilityState)).toBe("visible")
  const files = (name: string) => ({
    stop: join(dir, `${name}.stop`),
    printed: join(dir, `${name}.printed`),
  })
  const lines = (printed: string) => textOf(printed).split("\n").length
  const terminals = page.getByRole("region", { name: "Terminal screen" })
  const print = async (n: number, into: ReturnType<typeof files>) => {
    await terminals.nth(n).click()
    await page.keyboard.type(printing(into.stop, into.printed))
    await page.keyboard.press("Enter")
    await expect.poll(() => lines(into.printed)).toBeGreaterThan(3)
  }

  // Four terminals, each half the screen wide. The first, the third and
  // the last print; the focus goes back to the last, scrolling by the
  // least: the last two show, and the first is far past the left edge.
  await newTerminal(page)
  for (let i = 1; i < 4; i++) {
    await page.keyboard.press("Alt+KeyN")
    await page
      .getByRole("region", { name: "New Pane" })
      .getByRole("button", { name: "Terminal" })
      .click()
    await expect(terminals).toHaveCount(i + 1)
    await expect(terminals.nth(i)).toHaveAttribute("data-state", "running")
  }
  const far = files("far")
  const edge = files("edge")
  const on = files("on")
  await print(3, on)
  await print(2, edge)
  for (let i = 0; i < 2; i++) await page.keyboard.press("Alt+ArrowLeft")
  await expect(terminals.nth(0)).toBeInViewport({ ratio: 1 })
  await print(0, far)
  for (let i = 0; i < 3; i++) await page.keyboard.press("Alt+ArrowRight")
  await expect(terminals.nth(3)).toBeInViewport({ ratio: 1 })
  await expect(terminals.nth(0)).not.toBeInViewport()
  await page.waitForTimeout(500)

  // On screen, a terminal draws as it prints.
  await page.evaluate(install)
  await page.evaluate(reset, false)
  const onFrom = lines(on.printed)
  await page.waitForTimeout(2000)
  const shown = await counted(page, 3)
  expect(lines(on.printed) - onFrom, "printed on screen").toBeGreaterThan(20)
  expect(shown.draws[0], "drawn on screen").toBeGreaterThan(0)

  // The focus walks back to the first, by keys, past the margin: it drew
  // what it printed meanwhile before the frame that shows it.
  writeFileSync(far.stop, "")
  writeFileSync(on.stop, "")
  const saidFar = await stopped(far.printed)
  await page.waitForTimeout(300)
  await page.evaluate(resetTexts)
  for (let i = 0; i < 3; i++) await page.keyboard.press("Alt+ArrowLeft")
  expect(await drewBefore(page, 0), "drawn before it shows").toContain(saidFar)

  // The third column touches the screen's right edge now: nothing of it
  // shows, and it draws nothing as it prints.
  await expect(terminals.nth(1)).toBeInViewport({ ratio: 1 })
  await expect(terminals.nth(2)).not.toBeInViewport()
  await page.waitForTimeout(500)
  await page.evaluate(reset, false)
  const edgeFrom = lines(edge.printed)
  await page.waitForTimeout(2000)
  const beside = await counted(page, 2)
  expect(lines(edge.printed) - edgeFrom, "printed beside").toBeGreaterThan(20)
  expect(beside.draws, "drawn beside the screen").toEqual([0, 0])

  // A hand's swipe brings it in, drawn before the frame that shows it.
  writeFileSync(edge.stop, "")
  const saidEdge = await stopped(edge.printed)
  await page.waitForTimeout(300)
  const header = page
    .locator("section[data-tile]")
    .filter({ has: terminals })
    .nth(1)
    .locator("header")
  const box = (await header.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.evaluate(resetTexts)
  for (let i = 0; i < 6; i++) await page.mouse.wheel(60, 0)
  expect(await drewBefore(page, 2), "drawn before it shows").toContain(saidEdge)

  // On a workspace away, as on the Strip.
  const away = files("away")
  await print(2, away)
  await page.keyboard.press("Alt+PageDown")
  await expect(terminals.nth(2)).not.toBeInViewport()
  await page.waitForTimeout(500)
  await page.evaluate(reset, false)
  const awayFrom = lines(away.printed)
  await page.waitForTimeout(2000)
  const hidden = await counted(page, 2)
  expect(lines(away.printed) - awayFrom, "printed away").toBeGreaterThan(20)
  expect(hidden.draws, "drawn away").toEqual([0, 0])
  writeFileSync(away.stop, "")
  const saidAway = await stopped(away.printed)
  await page.waitForTimeout(300)
  await page.evaluate(resetTexts)
  await page.keyboard.press("Alt+PageUp")
  expect(await drewBefore(page, 2), "drawn before it shows").toContain(saidAway)
})
