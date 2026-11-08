/**
 * A Tile's state, as its terminal keeps it (ADR 0088, decision 4): hidden,
 * off the Strip's screen or on a workspace away, a terminal draws nothing
 * while it prints; on screen it draws; and as it comes back, it has drawn
 * what it printed meanwhile before the first frame that shows it, so no
 * stale screen is ever seen.
 */
import { join } from "node:path"
import { writeFileSync } from "node:fs"
import { expect, test, type Page } from "@playwright/test"
import { newTerminal, startWindow, textOf, type Window } from "./window"

let window: Window

test.afterEach(async () => {
  await window?.close()
})

/** What `count` reads of one terminal's canvas, from the last `arm`. */
type Count = {
  /** Its drawing calls. */
  draws: number
  /** The text it drew before it came on screen. */
  before: string
  /** It shows on screen now. */
  on: boolean
  /** When it came on screen, as the frame showing it was drawn; 0 while
   * it has not. */
  came: number
}

/**
 * Counts each terminal's drawing on its canvas, in the page: the calls,
 * the text drawn and when, and when it comes on screen, as the browser's
 * own observer works it out in the frame that first shows it. Runs in the
 * page: it reaches nothing outside itself.
 */
function install() {
  type Kept = {
    draws: number
    texts: { at: number; text: string }[]
    on: boolean
    came: number
  }
  const kept = new Map<HTMLCanvasElement, Kept>()
  const sight = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const each = kept.get(entry.target as HTMLCanvasElement)
        if (!each) continue
        const on = entry.isIntersecting && entry.intersectionRatio > 0
        if (on && !each.on && each.came === 0) each.came = entry.time
        each.on = on
      }
    },
    { threshold: [0, 0.001] }
  )
  const of = (canvas: HTMLCanvasElement) => {
    let each = kept.get(canvas)
    if (!each) {
      each = { draws: 0, texts: [], on: false, came: 0 }
      kept.set(canvas, each)
      sight.observe(canvas)
    }
    return each
  }
  const context = CanvasRenderingContext2D.prototype as unknown as Record<
    string,
    (...args: unknown[]) => unknown
  >
  for (const name of [
    "clearRect",
    "fillRect",
    "strokeRect",
    "fillText",
    "strokeText",
    "drawImage",
    "putImageData",
    "fill",
    "stroke",
  ]) {
    const draw = context[name]
    context[name] = function (this: CanvasRenderingContext2D, ...args) {
      const canvas = this.canvas
      if (canvas.parentElement?.ariaLabel === "Terminal screen") {
        const each = of(canvas)
        each.draws += 1
        if (name === "fillText")
          each.texts.push({ at: performance.now(), text: String(args[0]) })
      }
      return draw.apply(this, args)
    }
  }
  const canvases = () => [
    ...document.querySelectorAll<HTMLCanvasElement>(
      '[aria-label="Terminal screen"] > canvas'
    ),
  ]
  Object.assign(globalThis, {
    tiles: {
      arm() {
        for (const canvas of canvases())
          Object.assign(of(canvas), { draws: 0, texts: [], came: 0 })
      },
      count() {
        return canvases().map((canvas) => {
          const { draws, texts, on, came } = of(canvas)
          const before = texts.filter(({ at }) => came === 0 || at < came)
          return {
            draws,
            before: before.map(({ text }) => text).join(" "),
            on,
            came,
          }
        })
      },
    },
  })
}

type Counting = { tiles: { arm(): void; count(): Count[] } }
const arm = (page: Page) =>
  page.evaluate(() => (globalThis as unknown as Counting).tiles.arm())
const count = (page: Page) =>
  page.evaluate(() => (globalThis as unknown as Counting).tiles.count())

/** A shell loop that prints a numbered line into `printed` and on its
 * screen until `stop` is there, then the last number, `stopped-N`. */
const printing = (stop: string, printed: string) =>
  `i=0; while [ ! -e ${stop} ]; do i=$((i+1)); echo "line-$i" | tee -a ${printed}; sleep 0.02; done; echo "stopped-$i" | tee -a ${printed}`

/** The last line printed into `printed`, once it stopped. */
const stopped = async (printed: string) => {
  await expect.poll(() => textOf(printed)).toMatch(/stopped-\d+/)
  return textOf(printed).match(/stopped-\d+/)![0]
}

test("a terminal draws nothing while it is hidden, and has drawn what it printed as it shows again", async () => {
  test.setTimeout(120_000)
  window = await startWindow()
  const { page, dir } = window
  // Every Tile is hidden while the window is away: this one is not.
  expect(await page.evaluate(() => document.visibilityState)).toBe("visible")
  await page.evaluate(install)
  const files = (name: string) => ({
    stop: join(dir, `${name}.stop`),
    printed: join(dir, `${name}.printed`),
  })
  const lines = (printed: string) => textOf(printed).split("\n").length

  // The first terminal prints, then four more open: its column leaves
  // the screen, and the margin past it.
  const first = files("first")
  const screen = await newTerminal(page)
  await screen.click()
  await page.keyboard.type(printing(first.stop, first.printed))
  await page.keyboard.press("Enter")
  await expect.poll(() => lines(first.printed)).toBeGreaterThan(3)
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press("Alt+KeyN")
    await page
      .getByRole("region", { name: "New Pane" })
      .getByRole("button", { name: "Terminal" })
      .click()
    await expect(
      page.getByRole("region", { name: "Terminal screen" })
    ).toHaveCount(i + 2)
  }
  const terminals = page.getByRole("region", { name: "Terminal screen" })
  await expect(terminals.nth(4)).toHaveAttribute("data-state", "running")
  const width = await page.evaluate(() => innerWidth)
  await expect
    .poll(async () => {
      const box = (await terminals.nth(0).boundingBox())!
      return box.x + box.width
    })
    .toBeLessThan(-width / 4)
  // The last one prints on screen.
  const last = files("last")
  await terminals.nth(4).click()
  await page.keyboard.type(printing(last.stop, last.printed))
  await page.keyboard.press("Enter")
  await page.waitForTimeout(500)

  await arm(page)
  const firstFrom = lines(first.printed)
  const lastFrom = lines(last.printed)
  await page.waitForTimeout(2000)
  const counted = await count(page)
  let hidden = counted[0]
  const shown = counted[4]
  expect(
    lines(first.printed) - firstFrom,
    "printed off screen"
  ).toBeGreaterThan(20)
  expect(hidden.on).toBe(false)
  expect(hidden.draws, "drawn off screen").toBe(0)
  expect(lines(last.printed) - lastFrom, "printed on screen").toBeGreaterThan(
    20
  )
  expect(shown.on).toBe(true)
  expect(shown.draws, "drawn on screen").toBeGreaterThan(0)

  // It stops while hidden; the focus walks back to it.
  writeFileSync(first.stop, "")
  writeFileSync(last.stop, "")
  const said = await stopped(first.printed)
  await page.waitForTimeout(300)
  await arm(page)
  for (let i = 0; i < 4; i++) await page.keyboard.press("Alt+ArrowLeft")
  await expect.poll(async () => (await count(page))[0].came).toBeGreaterThan(0)
  ;[hidden] = await count(page)
  expect(hidden.before, "drawn before the frame that shows it").toContain(said)

  // On a workspace away, as on the Strip.
  const again = files("again")
  await expect(terminals.nth(0)).toBeInViewport()
  await terminals.nth(0).click()
  await page.keyboard.type(printing(again.stop, again.printed))
  await page.keyboard.press("Enter")
  await expect.poll(() => lines(again.printed)).toBeGreaterThan(3)
  await page.keyboard.press("Alt+PageDown")
  await expect(terminals.nth(0)).not.toBeInViewport()
  await page.waitForTimeout(500)
  await arm(page)
  const againFrom = lines(again.printed)
  await page.waitForTimeout(2000)
  ;[hidden] = await count(page)
  expect(lines(again.printed) - againFrom, "printed away").toBeGreaterThan(20)
  expect(hidden.draws, "drawn away").toBe(0)
  writeFileSync(again.stop, "")
  const saidAgain = await stopped(again.printed)
  await page.waitForTimeout(300)
  await arm(page)
  await page.keyboard.press("Alt+PageUp")
  await expect.poll(async () => (await count(page))[0].came).toBeGreaterThan(0)
  ;[hidden] = await count(page)
  expect(hidden.before, "drawn before the frame that shows it").toContain(
    saidAgain
  )
})
