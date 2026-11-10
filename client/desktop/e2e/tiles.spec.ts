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
 *
 * A Tile's size, as the resize gate gives it (decision 5): a terminal's
 * screen and a browser's page take each size their Tile is laid out at,
 * and what their Pane takes of it inside, as a footer or the tabs on the
 * left.
 */
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { join } from "node:path"
import { writeFileSync } from "node:fs"
import { expect, test, type Page } from "@playwright/test"
import { install, read, reset, resetTexts } from "./motion-probe"
import {
  FREE,
  newTerminal,
  pressInPage,
  startWindow,
  textOf,
  type Window,
} from "./window"

let window: Window
let site: Server | undefined

test.afterEach(async () => {
  await window?.close()
  site?.close()
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
    // It types into this terminal, not one a landing swipe focused.
    await expect(
      terminals.nth(n).getByRole("textbox", { name: "Terminal input" })
    ).toBeFocused()
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
  // The swipe lands 160 ms after its last wheel (`SWIPE_END`), and focuses
  // the column it lands on: a click before that loses its focus to it.
  await page.waitForTimeout(500)

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

/** How far, on screen, each terminal's canvas is from its screen's size,
 * in the screen's pixels, and the browser's page from its slot, in CSS
 * pixels: 0 once each took the size it is laid out at. Off screen, a
 * terminal sizes nothing and the page waits out of sight: neither is
 * counted. */
const off = (page: Page) =>
  page.evaluate(() => {
    const ratio = devicePixelRatio
    const terminals = [
      ...document.querySelectorAll<HTMLElement>(
        '[aria-label="Terminal screen"]'
      ),
    ].flatMap((screen) => {
      const { left, right } = screen.getBoundingClientRect()
      if (right <= 0 || left >= innerWidth) return []
      const canvas = screen.querySelector("canvas")!
      return [
        Math.abs(canvas.width - Math.round(screen.clientWidth * ratio)) +
          Math.abs(canvas.height - Math.round(screen.clientHeight * ratio)),
      ]
    })
    const box = document.querySelector("[data-held-by]")!
    const slot = document.querySelector("[data-holds]")!
    const [a, b] = [box.getBoundingClientRect(), slot.getBoundingClientRect()]
    const away = b.right <= 0 || b.left >= innerWidth
    return {
      terminals,
      // Less than a pixel is none: the page takes its slot's whole pixels.
      page: away
        ? null
        : Math.floor(
            Math.max(
              Math.abs(a.x - b.x),
              Math.abs(a.y - b.y),
              Math.abs(a.width - b.width),
              Math.abs(a.height - b.height)
            )
          ),
    }
  })

/** Whether all `off` counts are 0. */
const fitted = async (page: Page) => {
  const { terminals, page: box } = await off(page)
  return terminals.every((each) => each === 0) && (box ?? 0) === 0
}

test("a terminal and a browser's page take each size their Tile gives them, and what their Pane keeps inside it", async () => {
  test.setTimeout(120_000)
  site = createServer((_, response) => {
    response.writeHead(200, { "content-type": "text/html" })
    response.end("<title>Page</title><body style='margin:0'><h1>Page</h1>")
  })
  await new Promise<void>((done) => site!.listen(0, "127.0.0.1", done))
  const address = `http://127.0.0.1:${(site.address() as AddressInfo).port}/`
  window = await startWindow({ files: FREE })
  const { app, page, dir } = window
  const screen = await newTerminal(page)
  await page.keyboard.press("Alt+KeyN")
  await page
    .getByRole("region", { name: "New Pane" })
    .getByRole("button", { name: "Browser" })
    .click()
  const bar = page.getByRole("textbox", { name: "Address" })
  await bar.fill(address)
  await bar.press("Enter")
  const browser = page.getByRole("region", { name: "Page" })
  await expect(browser).toBeVisible()
  await expect.poll(() => off(page)).toEqual({ terminals: [0], page: 0 })

  // The browser's column first, by a key from its page.
  await bar.press("Escape")
  const inPage = async (key: string, held: ("alt" | "control" | "shift")[]) =>
    expect(await pressInPage(app, key, held, { focused: true })).toBe(true)
  await inPage("Home", ["alt", "shift"])
  await expect
    .poll(async () => (await browser.boundingBox())!.x)
    .toBeLessThan((await screen.boundingBox())!.x)
  await page.waitForTimeout(700)
  await expect.poll(() => fitted(page)).toBe(true)

  // A step narrower and wider, by keys from its page.
  for (const key of ["Left", "Right", "Right", "Left"]) {
    await inPage(key, ["control", "alt"])
    await page.waitForTimeout(700)
    await expect.poll(() => fitted(page)).toBe(true)
  }

  // A hand drags the gap right of it: in each frame that lays its slot
  // out at a new size, the page has taken it before the frame is drawn,
  // as an observer of the slot made after the window's own sees.
  await page.evaluate(() => {
    const slot = document.querySelector("[data-holds]")!
    const box = document.querySelector("[data-held-by]")!
    const seen: number[] = []
    ;(globalThis as { seen?: number[] }).seen = seen
    new ResizeObserver(() => {
      const [a, b] = [box.getBoundingClientRect(), slot.getBoundingClientRect()]
      seen.push(
        Math.max(
          Math.abs(a.x - b.x),
          Math.abs(a.y - b.y),
          Math.abs(a.width - b.width),
          Math.abs(a.height - b.height)
        )
      )
    }).observe(slot)
  })
  const tile = (await browser.boundingBox())!
  const from = { x: tile.x + tile.width + 6, y: tile.y + tile.height / 2 }
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await expect(page.locator("html[data-drag]")).toHaveCount(1)
  await page.mouse.move(from.x + 160, from.y, { steps: 16 })
  await page.mouse.up()
  await expect(page.locator("html[data-drag]")).toHaveCount(0)
  const seen = await page.evaluate(
    () => (globalThis as { seen?: number[] }).seen!
  )
  expect(seen.length, "the sizes the slot was laid out at").toBeGreaterThan(5)
  // Less than a pixel: the page takes its slot's whole pixels.
  expect(Math.max(...seen), "how far the page was from its slot").toBeLessThan(
    1
  )
  await page.waitForTimeout(700)
  await expect.poll(() => fitted(page)).toBe(true)

  // Over the whole window and back.
  for (let i = 0; i < 2; i++) {
    await inPage("F", ["alt", "shift"])
    await page.waitForTimeout(700)
    await expect.poll(async () => (await off(page)).page).toBe(0)
  }
  await expect.poll(() => fitted(page)).toBe(true)

  // The tabs on the left, as browser.toml says, take the slot's left
  // inside the Tile; and back on top.
  const tabs = page.getByRole("tablist", { name: "Tabs" })
  const file = join(dir, "config/browser.toml")
  writeFileSync(file, 'tabs = "left"\n')
  await expect(tabs).toHaveAttribute("aria-orientation", "vertical")
  await expect.poll(() => fitted(page)).toBe(true)
  writeFileSync(file, 'tabs = "top"\n')
  await expect(tabs).not.toHaveAttribute("aria-orientation", "vertical")
  await expect.poll(() => fitted(page)).toBe(true)

  // The terminal's column, a step wider and back.
  await screen.click()
  await expect.poll(async () => (await off(page)).terminals).toEqual([0])
  for (const key of ["Control+Alt+ArrowRight", "Control+Alt+ArrowLeft"]) {
    await page.keyboard.press(key)
    await page.waitForTimeout(700)
    await expect.poll(() => fitted(page)).toBe(true)
  }

  // The shell ends: the footer that says so takes its room from the
  // screen, which fits to what is left.
  const before = await screen.evaluate((element) => element.clientHeight)
  await page.keyboard.type("exit")
  await page.keyboard.press("Enter")
  await expect(
    page
      .locator("section[data-tile]")
      .filter({ has: screen })
      .getByRole("status")
  ).toContainText("The shell ended.")
  expect(await screen.evaluate((element) => element.clientHeight)).toBeLessThan(
    before
  )
  await expect.poll(async () => (await off(page)).terminals).toEqual([0])
})
