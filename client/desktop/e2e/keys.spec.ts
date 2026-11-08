/**
 * How soon a tiling key is drawn (ADR 0088, decision 11; the plan's
 * §8.11): on the Strip motion.spec.ts measures, three terminals and a
 * browser Pane, each kind of tiling key is pressed, with the engine near
 * and with every word it says 150 ms late, as a host far away
 * (`startWindow({ latency })`).
 *
 * For each key the probe takes the time from the key to the Tiling's
 * commit of what it changed, and the frames that began meanwhile
 * (motion-probe.ts): a key committed before the next frame begins is
 * drawn in it. It counts React's drawings of the Tiles and the widgets
 * for each key too, as motion.spec.ts does, so a reconcile that draws
 * again shows. Once each phase is over, the Strips drawn are the
 * engine's arrangement: no prediction is left behind.
 *
 * The numbers go to test-results/keys.json and keys.md.
 */
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { availableParallelism, loadavg } from "node:os"
import { join } from "node:path"
import { expect, type Page, test } from "@playwright/test"
import { install, read, reset, type Reading } from "./motion-probe"
import { keysOf } from "./motion-report"
import {
  firstThread,
  layoutOf,
  newTerminal,
  startWindow,
  type Window,
} from "./window"

let window: Window
let site: Server | undefined

test.afterEach(async () => {
  await window?.close()
  site?.close()
})

/** A column as the engine keeps it, of what this spec compares. */
type Kept = {
  id: string
  panes: { id: string }[]
  width?: string
  full?: boolean
}

/** Every workspace, as the engine's `workspaces.list` answers, through the
 * Person's `banda call`. */
function arrangedOf(window: Window): { id: string; columns: Kept[] }[] {
  return JSON.parse(window.banda("call", "workspaces.list")).ok.workspaces
}

/** A width's share in hundredths, as `share` in model.ts reads it. */
function hundredths(width: string): number {
  const [top, bottom = "1"] = width.split("/")
  return Math.round((Number(top) / Number(bottom)) * 100)
}

/**
 * Where the Strips drawn differ from the engine's arrangement: each
 * workspace by its ID, each column by its ID and its Tiles, top down,
 * and its share of the Strip where the engine gives it one. None once
 * the window draws what the engine keeps.
 */
async function apart(page: Page, window: Window): Promise<string[]> {
  const drawn = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-stack]")].map(
      (stack) => ({
        id: stack.dataset.stack!,
        shown: stack.getAttribute("aria-hidden") !== "true",
        columns: [
          ...stack.querySelectorAll<HTMLElement>(
            "[data-strip] > [data-column]"
          ),
        ].map((column) => {
          const strip = column.parentElement!
          const style = getComputedStyle(strip)
          const gap = parseFloat(style.columnGap) || 0
          const room =
            strip.clientWidth -
            parseFloat(style.paddingLeft) -
            parseFloat(style.paddingRight) +
            gap
          return {
            id: column.dataset.column!,
            panes: [
              ...column.querySelectorAll<HTMLElement>(":scope > [data-tile]"),
            ].map((tile) => tile.dataset.tile!),
            share: Math.round(((column.offsetWidth + gap) / room) * 100),
          }
        }),
      })
    )
  )
  const kept = arrangedOf(window)
  const found: string[] = []
  const ids = (list: { id: string }[]) => list.map((one) => one.id).join(" ")
  if (ids(drawn) !== ids(kept)) found.push(`workspaces ${ids(drawn)}`)
  for (const [w, workspace] of kept.entries()) {
    const columns = drawn[w]?.columns ?? []
    if (ids(columns) !== ids(workspace.columns))
      found.push(`workspace ${w + 1}: columns ${ids(columns)}`)
    for (const [c, column] of workspace.columns.entries()) {
      const there = columns[c]
      if (!there || there.id !== column.id) continue
      if (there.panes.join(" ") !== ids(column.panes))
        found.push(`column ${column.id}: Tiles ${there.panes.join(" ")}`)
      const share = column.full
        ? 100
        : column.width !== undefined
          ? hundredths(column.width)
          : undefined
      // Only the workspace on screen is laid out to be read.
      const shown = drawn[w]?.shown
      if (share !== undefined && shown && Math.abs(there.share - share) > 1)
        found.push(`column ${column.id}: ${there.share}, kept ${share}`)
    }
  }
  return found
}

/** A page titled Page, served here; its address. */
async function pageSite(): Promise<string> {
  site = createServer((_, response) => {
    response.writeHead(200, { "content-type": "text/html" })
    response.end("<title>Page</title><h1>Page</h1>")
  })
  await new Promise<void>((done) => site!.listen(0, "127.0.0.1", done))
  return `http://127.0.0.1:${(site.address() as AddressInfo).port}/`
}

/** A Strip of three terminals and a browser Pane on a page of `address`,
 * as motion.spec.ts has; the last terminal has the focus. */
async function strip(page: Page, address: string) {
  await newTerminal(page)
  const open = async (kind: string) => {
    await page.keyboard.press("Alt+KeyN")
    await page
      .getByRole("region", { name: "New Pane" })
      .getByRole("button", { name: kind })
      .click()
  }
  const screens = page.getByRole("region", { name: "Terminal screen" })
  for (let i = 0; i < 2; i++) {
    await open("Terminal")
    await expect(screens).toHaveCount(i + 2)
  }
  await open("Browser")
  const bar = page.getByRole("textbox", { name: "Address" })
  await bar.fill(address)
  await bar.press("Enter")
  await expect(page.locator("[data-held-by]")).toHaveCount(1)
  await screens.nth(2).click()
  // Nothing has the keyboard but the window: no cursor blinks.
  await page.waitForTimeout(500)
}

/** A phase's keys, pressed one at a time as a Person does: each lands on
 * a window at rest. */
const PHASES: Record<string, string[]> = {
  width: [
    "Control+Alt+ArrowLeft",
    "Control+Alt+ArrowRight",
    "Control+Alt+ArrowRight",
    "Control+Alt+ArrowLeft",
    "Control+Alt+ArrowLeft",
    "Control+Alt+ArrowRight",
  ],
  maximize: ["Alt+KeyF", "Alt+KeyF", "Alt+KeyF", "Alt+KeyF"],
  // Along the terminals, never to the browser's page, which takes the
  // keys from there.
  focus: [
    "Alt+ArrowLeft",
    "Alt+ArrowLeft",
    "Alt+ArrowRight",
    "Alt+ArrowRight",
    "Alt+ArrowLeft",
    "Alt+ArrowRight",
  ],
  workspace: ["Alt+PageDown", "Alt+PageUp", "Alt+PageDown", "Alt+PageUp"],
  move: [
    "Alt+Shift+ArrowLeft",
    "Alt+Shift+ArrowRight",
    "Alt+Shift+ArrowLeft",
    "Alt+Shift+ArrowRight",
  ],
  // A New Pane opened, then closed: open and close, each three times.
  "open and close": [
    "Alt+KeyN",
    "Alt+KeyW",
    "Alt+KeyN",
    "Alt+KeyW",
    "Alt+KeyN",
    "Alt+KeyW",
  ],
}

/** What a phase measured: each key, React's drawings and the steps. */
type Measured = {
  keys: Reading["keys"]
  renders: Reading["renders"]
  steps: number
}

/** The numbers each phase's keys came to, by phase, `open and close` split
 * by its keys. */
function numbersOf(measured: Record<string, Measured>) {
  const numbers: Record<string, unknown> = {}
  for (const [name, { keys, renders, steps }] of Object.entries(measured)) {
    const perStep = (count: number) => Math.round((count / steps) * 100) / 100
    const drawings = {
      tiles: perStep(renders.tiles),
      widgets: perStep(renders.widgets),
    }
    if (name === "open and close") {
      numbers.open = { keys: keysOf(keys.filter((k) => k.code === "KeyN")) }
      numbers.close = { keys: keysOf(keys.filter((k) => k.code === "KeyW")) }
    } else numbers[name] = { keys: keysOf(keys), renders: drawings }
  }
  return numbers
}

/** Keeps `numbers` in test-results/keys.json under `latency`, and the
 * whole as a table in keys.md. */
function report(latency: number, numbers: Record<string, unknown>) {
  const out = test.info().project.outputDir
  const json = join(out, "keys.json")
  const all: Record<string, Record<string, unknown>> = existsSync(json)
    ? JSON.parse(readFileSync(json, "utf8"))
    : {}
  all[String(latency)] = numbers
  writeFileSync(json, `${JSON.stringify(all, null, 2)}\n`)
  type Row = {
    keys: ReturnType<typeof keysOf>
    renders?: { tiles: number; widgets: number }
  }
  const lines = Object.entries(all).flatMap(([ms, phases]) =>
    Object.entries(phases as Record<string, Row>).map(
      ([phase, { keys, renders }]) =>
        `| ${ms} | ${phase} | ${keys?.count ?? "–"} | ${keys?.missed ?? "–"} | ${keys?.p50 ?? "–"} · ${keys?.p95 ?? "–"} | ${keys?.framesLate.p95 ?? "–"} | ${renders?.tiles ?? "–"} | ${renders?.widgets ?? "–"} |`
    )
  )
  const text = [
    "## Key to drawn",
    "",
    "From each key to the Tiling's commit of what it changed, in ms, and the frames that began meanwhile; React's drawings of the Tiles and widgets for each key.",
    "",
    "| Engine late ms | Phase | Keys | Missed | ms p50 · p95 | Frames late p95 | Tiles a key | Widgets a key |",
    "| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...lines,
    "",
  ].join("\n")
  writeFileSync(join(out, "keys.md"), text)
  console.log(text)
}

for (const latency of [0, 150]) {
  test.describe(`with the engine ${latency} ms away`, () => {
    test("each tiling key is drawn, and what is drawn is the engine's", async () => {
      test.setTimeout(180_000)
      const address = await pageSite()
      window = await startWindow({ latency })
      const { page } = window
      await strip(page, address)
      await page.evaluate(install)

      const measured: Record<string, Measured> = {}
      for (const [name, keys] of Object.entries(PHASES)) {
        await page.evaluate(reset, false)
        for (const key of keys) {
          await page.keyboard.press(key)
          await page.waitForTimeout(700)
        }
        const counted = await page.evaluate(read)
        measured[name] = {
          keys: counted.keys,
          renders: counted.renders,
          steps: keys.length,
        }
        // No prediction is left behind.
        await expect
          .poll(() => apart(page, window), { message: `after ${name}` })
          .toEqual([])
      }
      const numbers = numbersOf(measured)
      report(latency, numbers)

      // Each key drew again the two Tiles the focus moved between and no
      // other, the one in focus as its workspace left or came back, none
      // for a width, and no widget (ADR 0088, decision 7): a reconcile
      // draws nothing again.
      const each = (phase: string) => measured[phase].renders
      const steps = (phase: string) => measured[phase].steps
      expect(each("focus").tiles, "focus: Tiles drawn").toBe(2 * steps("focus"))
      expect(each("focus").widgets, "focus: widgets drawn").toBe(0)
      expect(each("width").tiles, "width: Tiles drawn").toBe(0)
      expect(each("maximize").tiles, "maximize: Tiles drawn").toBe(0)
      expect(each("workspace").tiles, "workspace: Tiles drawn").toBe(
        steps("workspace")
      )
      // Each key is drawn before the frame after it begins, the engine
      // near or far (decision 11): no frame begins between a key and its
      // commit, a count however busy the machine is.
      const tiling = ["width", "maximize", "focus", "workspace", "move"]
      for (const phase of tiling) {
        const keys = keysOf(measured[phase].keys)!
        expect(keys.missed, `${phase}: keys not drawn`).toBe(0)
        expect(keys.framesLate.max, `${phase}: frames late`).toBe(0)
      }
      // A Pane opened is drawn too.
      const open = keysOf(
        measured["open and close"].keys.filter((k) => k.code === "KeyN")
      )!
      expect(open.missed, "open: keys not drawn").toBe(0)
      // And in ms: the tiling keys within 16, all of them together, so one
      // key the machine held up does not fail it, as a phase of four
      // would; a Pane opened within a mount's budget, 50. A machine busier
      // than half its cores times itself, not the window: there the ms
      // are only told, as the plan's §8.11 has them, a soft gate.
      const all = keysOf(tiling.flatMap((phase) => measured[phase].keys))!
      const busy = loadavg()[0] / availableParallelism()
      if (busy <= 0.5) {
        expect(all.p95, "tiling keys: key to drawn p95").toBeLessThanOrEqual(16)
        expect(open.p95, "open: key to drawn p95").toBeLessThanOrEqual(50)
      } else
        test.info().annotations.push({
          type: "busy",
          description: `load ${busy.toFixed(2)} a core, not gated: tiling keys p95 ${all.p95} ms, open p95 ${open.p95} ms`,
        })
    })

    test("ten tiling keys pressed faster than the Window draws land in order, as the engine has them", async () => {
      window = await startWindow({ latency })
      const { page } = window
      const { composer: box } = await firstThread(page)
      await expect(box).toBeFocused()
      const launchers = page.getByRole("region", { name: "New Pane" })
      for (let n = 1; n <= 3; n++) {
        await page.keyboard.press("Alt+KeyN")
        await expect(launchers).toHaveCount(n)
        await expect(launchers.nth(n - 1)).toHaveAttribute(
          "data-focused",
          "true"
        )
      }
      const [[thread], [one], [two], [three]] = await layoutOf(page)
      // roma-day.spec.ts's ten, in one task of the page.
      const keys = [
        "Alt+KeyN",
        "Alt+Shift+Home",
        "Alt+ArrowRight",
        "Alt+Shift+End",
        "Alt+Home",
        "Alt+KeyW",
        "Alt+Shift+ArrowRight",
        "Alt+Shift+ArrowRight",
        "Alt+ArrowLeft",
        "Alt+Shift+Home",
      ].map((press) => {
        const mods = press.split("+")
        const code = mods.pop()!
        return {
          code,
          key: code.startsWith("Key") ? code.slice(3).toLowerCase() : code,
          altKey: mods.includes("Alt"),
          shiftKey: mods.includes("Shift"),
        }
      })
      await page.evaluate((keys) => {
        const target = document.activeElement ?? document.body
        for (const key of keys)
          for (const type of ["keydown", "keyup"])
            target.dispatchEvent(
              new KeyboardEvent(type, {
                ...key,
                bubbles: true,
                cancelable: true,
              })
            )
      }, keys)
      await expect
        .poll(() => layoutOf(page))
        .toEqual([[three], [two], [one], [thread]])
      await expect(page.locator(`[data-tile="${three}"]`)).toHaveAttribute(
        "data-focused",
        "true"
      )
      await expect.poll(() => apart(page, window)).toEqual([])
    })
  })
}

/**
 * What the page says to the engine from now, counted by method; and its
 * socket to the engine, for a test that breaks the connection. A test
 * that `swallow`s a method sends its next call with `params` instead, as
 * one the engine refuses.
 */
async function hearSent(page: Page) {
  await page.evaluate(() => {
    const kept = window as unknown as Sent
    kept.sent = {}
    const send = WebSocket.prototype.send
    WebSocket.prototype.send = function (data) {
      kept.socket = this
      if (typeof data !== "string") return send.call(this, data)
      const frame = JSON.parse(data) as { method?: string; params?: object }
      if (!frame.method) return send.call(this, data)
      kept.sent[frame.method] = (kept.sent[frame.method] ?? 0) + 1
      const instead = kept.swallow?.[frame.method]
      if (!instead) return send.call(this, data)
      delete kept.swallow![frame.method]
      return send.call(this, JSON.stringify({ ...frame, params: instead }))
    }
  })
  return () => page.evaluate(() => (window as unknown as Sent).sent)
}

type Sent = {
  sent: Record<string, number>
  socket?: WebSocket
  swallow?: Record<string, object>
}

/** The page's warnings, as they come. */
function warningsOf(page: Page): string[] {
  const warnings: string[] = []
  page.on("console", (message) => {
    if (message.type() === "warning") warnings.push(message.text())
  })
  return warnings
}

/** Each column's share of its Strip, in hundredths, by its ID. */
function sharesNow(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() =>
    Object.fromEntries(
      [
        ...document.querySelectorAll<HTMLElement>(
          "[data-strip] > [data-column]"
        ),
      ].map((column) => {
        const strip = column.parentElement!
        const style = getComputedStyle(strip)
        const gap = parseFloat(style.columnGap) || 0
        const room =
          strip.clientWidth -
          parseFloat(style.paddingLeft) -
          parseFloat(style.paddingRight) +
          gap
        const share = ((column.offsetWidth + gap) / room) * 100
        return [column.dataset.column!, Math.round(share)]
      })
    )
  )
}

/** Columns drawn as narrow as the engine keeps them, so each one's share
 * on screen is its width. */
const NARROW = "[columns]\nmin = 0\n"

/** Each column's width as drawn, by its ID: what React set, before any
 * motion. */
function widthsNow(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() =>
    Object.fromEntries(
      [
        ...document.querySelectorAll<HTMLElement>(
          "[data-strip] > [data-column]"
        ),
      ].map((column) => [column.dataset.column!, column.style.width])
    )
  )
}

/** The share column `column` is drawn at once its motion is over. */
async function widthShare(page: Page, column: string): Promise<number> {
  const width = (await widthsNow(page))[column]
  return Number(/^calc\(([\d.]+) \*/.exec(width)![1])
}

/** The Tile in focus, and its column's ID. */
async function inFocus(page: Page) {
  const tile = page.locator('[data-tile][data-focused="true"]')
  const id = (await tile.getAttribute("data-tile"))!
  const column = await tile.evaluate(
    (tile) => tile.closest<HTMLElement>("[data-column]")!.dataset.column!
  )
  return { tile, id, column }
}

/** Two terminals, side by side after the first Thread; the second in
 * focus. */
async function twoTerminals(page: Page) {
  const first = await newTerminal(page)
  const screens = page.getByRole("region", { name: "Terminal screen" })
  await page.keyboard.press("Control+Alt+Enter")
  await expect(screens).toHaveCount(2)
  await expect(screens.nth(1)).toHaveAttribute("data-state", "running")
  await screens.nth(1).click()
  return first
}

test.describe("a key drawn before the engine answers", () => {
  test("a Pane drawn before the engine has it stays the one drawn: its terminal keeps its stream, its page its document", async () => {
    test.setTimeout(120_000)
    const late = 800
    const address = await pageSite()
    window = await startWindow({ latency: late })
    const { app, page, dir } = window
    const warnings = warningsOf(page)
    await newTerminal(page)
    const sent = await hearSent(page)
    const tiles = page.locator("section[data-tile]")
    const before = await tiles.count()

    // A terminal, drawn at once: its Tile is taken as drawn, before the
    // engine's word can come.
    const pressed = Date.now()
    await page.keyboard.press("Control+Alt+Enter")
    await expect(tiles).toHaveCount(before + 1)
    const { tile, id } = await inFocus(page)
    const drawn = await tile.elementHandle()
    expect(Date.now() - pressed, "taken before the engine spoke").toBeLessThan(
      late - 100
    )
    // The engine's fact draws it by the same ID, in the same Tile.
    await expect.poll(() => apart(page, window)).toEqual([])
    const screen = page
      .locator(`[data-tile="${id}"]`)
      .getByRole("region", { name: "Terminal screen" })
    await expect(screen).toHaveAttribute("data-state", "running")
    expect(await drawn!.evaluate((tile) => tile.isConnected)).toBe(true)
    // Its program hears what is typed, on the one stream it started.
    const typed = join(dir, "typed-once")
    await screen.click()
    await page.keyboard.type(`: > '${typed}'`)
    await page.keyboard.press("Enter")
    await expect.poll(() => existsSync(typed)).toBe(true)
    expect(await sent()).toMatchObject({
      "terminal.open": 1,
      "terminal.watch": 1,
    })

    // A page, opened from the launcher and given its address before the
    // engine's word comes: one page, loaded once.
    await app.evaluate(({ app }) => {
      const pages = { made: 0, loaded: [] as string[] }
      Object.assign(globalThis, { pages })
      app.on("web-contents-created", (_, contents) => {
        if (contents.getType() !== "webview") return
        pages.made++
        contents.on("did-finish-load", () =>
          pages.loaded.push(contents.getURL())
        )
      })
    })
    await page.keyboard.press("Alt+KeyN")
    await page
      .getByRole("region", { name: "New Pane" })
      .getByRole("button", { name: "Browser" })
      .click()
    const bar = page.getByRole("textbox", { name: "Address" })
    await bar.fill(address)
    await bar.press("Enter")
    await expect(page.locator("[data-held-by]")).toHaveCount(1)
    await expect.poll(() => apart(page, window)).toEqual([])
    await expect
      .poll(() =>
        app.evaluate(({ webContents }) =>
          webContents
            .getAllWebContents()
            .filter((c) => c.getType() === "webview")
            .map((c) => c.getTitle())
        )
      )
      .toEqual(["Page"])
    // Long enough for a second document to have come, were there one.
    await page.waitForTimeout(late)
    expect(
      await app.evaluate(() => (globalThis as { pages?: object }).pages)
    ).toEqual({ made: 1, loaded: [address] })
    expect(warnings.filter((text) => text.includes("another ID"))).toEqual([])
  })

  test("a change the engine refuses is drawn until its refusal comes, and the changes after it stay", async () => {
    const late = 150
    window = await startWindow({ latency: late, look: NARROW })
    const { page } = window
    const warnings = warningsOf(page)
    await twoTerminals(page)
    const { column: maximized } = await inFocus(page)
    const shares = await sharesNow(page)
    expect(shares[maximized]).toBeLessThan(100)
    await hearSent(page)
    // The engine is asked to maximize a column it has none of, and
    // refuses: the window drew the one in focus maximized.
    await page.evaluate(() => {
      const kept = window as unknown as Sent
      kept.swallow = {
        "workspaces.maximize": {
          column: "00000000-0000-4000-8000-0000000000ff",
          full: true,
        },
      }
    })
    // The column's share as each frame draws it, as its width moves to
    // where the Tiling puts it (layout.ts).
    await page.evaluate((column) => {
      const seen: { at: number; share: number }[] = []
      Object.assign(window, { seen })
      const look = () => {
        const one = document.querySelector<HTMLElement>(
          `[data-column="${column}"]`
        )
        const share = one && /^calc\(([\d.]+) \*/.exec(one.style.width)?.[1]
        if (share) seen.push({ at: performance.now(), share: Number(share) })
        if (seen.length < 600) requestAnimationFrame(look)
      }
      requestAnimationFrame(look)
    }, maximized)
    const was = await widthShare(page, maximized)
    const key = await page.evaluate(() => performance.now())
    await page.keyboard.press("Alt+KeyF")
    // Then the column before it, in focus, and a width of its own: changes
    // that leave the maximized one as it is.
    await page.keyboard.press("Alt+ArrowLeft")
    await page.keyboard.press("Control+Alt+ArrowLeft")
    const after = await page.evaluate(() => performance.now())
    await expect.poll(() => apart(page, window), { timeout: 5000 }).toEqual([])
    // Its motion back over too.
    const last = () =>
      page.evaluate(
        () =>
          (window as unknown as { seen: { share: number }[] }).seen.at(-1)!
            .share
      )
    await expect.poll(last).toBe(was)
    const seen = await page.evaluate(
      () =>
        (window as unknown as { seen: { at: number; share: number }[] }).seen
    )
    const moving = seen.filter((frame) => frame.at > key)
    // It grows toward the whole screen from the frame after the key, and
    // still does after the keys that followed: the queue drew them on top
    // of it.
    const grows = moving.findIndex((frame) => frame.share > was + 0.01)
    expect(grows, "drawn maximized at once").toBeGreaterThanOrEqual(0)
    expect(
      moving[grows].at - key,
      "maximized before the engine could speak"
    ).toBeLessThan(late)
    const peak = moving.reduce(
      (top, frame, i) => (frame.share > moving[top].share ? i : top),
      grows
    )
    expect(moving[peak].at, "maximized after the next keys").toBeGreaterThan(
      after
    )
    // Back as the refusal comes, no sooner than the engine can speak.
    expect(moving[peak].at - key, "back once refused").toBeGreaterThanOrEqual(
      late
    )
    expect(moving.at(-1)!.share).toBe(was)
    expect(
      warnings.filter((text) =>
        text.startsWith("The workspaces did not change")
      )
    ).toHaveLength(1)
  })

  test("a change from elsewhere while keys wait for their answers is drawn under them", async () => {
    window = await startWindow({ latency: 150, look: NARROW })
    const { page } = window
    await twoTerminals(page)
    const tiles = await page.locator("section[data-tile]").elementHandles()
    const { column } = await inFocus(page)
    const others = arrangedOf(window)[0].columns.filter((c) => c.id !== column)
    const keys = [
      "Control+Alt+ArrowLeft",
      "Control+Alt+ArrowLeft",
      "Control+Alt+ArrowRight",
    ]
    await page.keyboard.press(keys[0])
    // An Agent's width, or another device's, for a column the keys leave.
    window.banda(
      "call",
      "workspaces.size",
      "--params",
      JSON.stringify({ column: others[0].id, width: "1/4" })
    )
    for (const key of keys.slice(1)) await page.keyboard.press(key)
    await expect.poll(() => apart(page, window)).toEqual([])
    expect(arrangedOf(window)[0].columns[0].width).toBe("1/4")
    // Nothing was made again.
    for (const tile of tiles)
      expect(await tile.evaluate((tile) => tile.isConnected)).toBe(true)
  })

  test("keys pressed as the connection breaks land in order, drawn as the engine then has them", async () => {
    const late = 1500
    window = await startWindow({ latency: late, look: NARROW })
    const { page } = window
    await twoTerminals(page)
    await hearSent(page)
    const tiles = await page.locator("section[data-tile]").elementHandles()
    const { column } = await inFocus(page)
    const pressed = Date.now()
    // Down two widths and maximized; the connection breaks with their
    // answers on the way; back from the whole screen and up a width.
    for (const key of [
      "Control+Alt+ArrowLeft",
      "Control+Alt+ArrowLeft",
      "Alt+KeyF",
    ])
      await page.keyboard.press(key)
    await page.evaluate(() => (window as unknown as Sent).socket!.close())
    for (const key of ["Alt+KeyF", "Control+Alt+ArrowRight", "Alt+ArrowLeft"])
      await page.keyboard.press(key)
    // What the keys drew, once its motion is over, before the engine
    // answered them.
    await page.waitForTimeout(600)
    const drawn = await widthsNow(page)
    expect(Date.now() - pressed, "read before the engine spoke").toBeLessThan(
      late - 100
    )
    await expect.poll(() => apart(page, window)).toEqual([])
    // The engine ran each in order: it has what was drawn, each width a
    // key set being whole, so nothing moved as it answered.
    const kept = arrangedOf(window)[0].columns.find((c) => c.id === column)!
    expect(kept.full ?? false).toBe(false)
    expect(await widthsNow(page)).toEqual(drawn)
    for (const tile of tiles)
      expect(await tile.evaluate((tile) => tile.isConnected)).toBe(true)
  })
})
