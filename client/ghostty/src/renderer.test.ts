import { readFileSync } from "node:fs"
import { join } from "node:path"
import { beforeAll, describe, expect, it, vi } from "vitest"
import { GhosttyTerminalCore } from "./t3/core"
import {
  GhosttyRenderer,
  rowsDrawAlike,
  type GhosttyCellRange,
} from "./t3/renderer"

// The adapter fetches its WebAssembly by URL, as a page does; here, from
// the vendored files.
beforeAll(() => {
  vi.stubGlobal("fetch", async (url: string) => {
    const name = String(url).split("/").pop()!.split("?")[0]!
    return new Response(
      readFileSync(join(import.meta.dirname, "t3/vendor", name))
    )
  })
})

const THEME = {
  foreground: { r: 220, g: 221, b: 222 },
  background: { r: 10, g: 11, b: 12 },
  cursor: { r: 255, g: 255, b: 255 },
}

const COLS = 40
const ROWS = 10
const METRICS = { width: 8, height: 16, baseline: 12 }
const PADDING = 4

type Call = { name: string; args: unknown[] }

/** A canvas's context that keeps the calls made on it, and draws nothing. */
function recording() {
  const calls: Call[] = []
  const canvas = { width: COLS * 8 + PADDING * 2, height: ROWS * 16 + 8 }
  const state: Record<string, unknown> = { canvas }
  const context = new Proxy(state, {
    get: (target, name: string) =>
      name in target
        ? target[name]
        : (...args: unknown[]) => void calls.push({ name, args }),
    set: (target, name: string, value) => ((target[name] = value), true),
  }) as unknown as CanvasRenderingContext2D
  return { calls, context }
}

/** A terminal, a renderer and its canvas: `frame` draws what it shows now
 * and says the calls that took. */
async function terminal(text: string, ratio = 1) {
  const core = await GhosttyTerminalCore.create(
    COLS,
    ROWS,
    METRICS.width,
    METRICS.height,
    THEME,
    () => {}
  )
  core.write(text)
  const renderer = new GhosttyRenderer()
  const { calls, context } = recording()
  const frame = (
    options: {
      forceFull?: boolean
      hoveredLinkRange?: GhosttyCellRange | null
    } = {}
  ) => {
    calls.length = 0
    renderer.render({
      context,
      snapshot: core.snapshot(),
      metrics: METRICS,
      fontSize: 12,
      fontFamily: "monospace",
      ratio,
      padding: PADDING,
      forceFull: options.forceFull ?? false,
      cursorOn: true,
      focused: true,
      hoveredLinkRange: options.hoveredLinkRange ?? null,
    })
    return [...calls]
  }
  return { core, frame }
}

/** The rows a frame's calls cleared to draw again, in order. */
const rowsDrawn = (calls: Call[]) =>
  calls
    .filter(
      ({ name, args }) => name === "clearRect" && args[3] === METRICS.height
    )
    .map(({ args }) => ((args[1] as number) - PADDING) / METRICS.height)

const lines = (from: number, to: number) =>
  Array.from({ length: to - from }, (_, i) => `line ${from + i}\r\n`).join("")

describe("the renderer", () => {
  it("draws every row at first, then nothing while nothing changes", async () => {
    const { core, frame } = await terminal("hello")
    const first = frame()
    expect(rowsDrawn(first)).toEqual([...Array(ROWS).keys()])
    // T3's renderer drew the cursor's row again on every frame.
    expect(frame()).toEqual([])
    core.write(" world")
    expect(rowsDrawn(frame())).toEqual([0])
    core.dispose()
  })

  it("moves the pixels of a screen that scrolls, and draws only the rows that came in", async () => {
    const { core, frame } = await terminal(lines(0, ROWS))
    frame()
    core.write(lines(ROWS, ROWS + 1))
    const scrolled = frame()
    const moves = scrolled.filter(({ name }) => name === "drawImage")
    expect(moves).toHaveLength(1)
    // Up by one row, on the screen's pixels: from the second row to the
    // first, the nine rows that stay.
    expect(moves[0]!.args.slice(1)).toEqual([
      0,
      PADDING + METRICS.height,
      COLS * 8 + PADDING * 2,
      (ROWS - 1) * METRICS.height,
      0,
      PADDING,
      COLS * 8 + PADDING * 2,
      (ROWS - 1) * METRICS.height,
    ])
    // The line that came in; the cursor's empty row below it is as it was.
    expect(rowsDrawn(scrolled)).toEqual([ROWS - 2])
    core.write(lines(ROWS + 1, ROWS + 4))
    expect(rowsDrawn(frame())).toEqual([ROWS - 4, ROWS - 3, ROWS - 2])
    core.dispose()
  })

  it("draws a selection's rows and a hovered link's, and nothing else", async () => {
    const { core, frame } = await terminal(lines(0, 6))
    frame()
    core.setSelection({ x: 2, y: 1 }, { x: 10, y: 3 })
    expect(rowsDrawn(frame({ forceFull: true }))).toEqual([1, 2, 3])
    core.clearSelection()
    expect(rowsDrawn(frame({ forceFull: true }))).toEqual([1, 2, 3])
    const link = { start: { x: 0, y: 4 }, end: { x: 3, y: 4 } }
    expect(rowsDrawn(frame({ hoveredLinkRange: link }))).toEqual([4])
    expect(rowsDrawn(frame({ hoveredLinkRange: link }))).toEqual([])
    expect(rowsDrawn(frame())).toEqual([4])
    core.dispose()
  })

  it("draws as T3's renderer did where rows do not draw alike", async () => {
    // At 1.25 a screen pixel is 0.8 CSS pixels: 16 rows of 20 screen
    // pixels each, but no edge the drawing rounds is exact.
    const { core, frame } = await terminal(lines(0, ROWS), 1.25)
    expect(rowsDrawn(frame())).toEqual([...Array(ROWS).keys()])
    expect(rowsDrawn(frame())).toEqual([ROWS - 1])
    core.write(lines(ROWS, ROWS + 1))
    const scrolled = frame()
    expect(scrolled.filter(({ name }) => name === "drawImage")).toEqual([])
    expect(rowsDrawn(scrolled)).toEqual([...Array(ROWS).keys()])
    core.dispose()
  })

  it("knows where rows draw alike", () => {
    // Scale, row height and origin, in CSS pixels.
    expect(rowsDrawAlike(1, 16, 4)).toBe(true)
    expect(rowsDrawAlike(2, 16.5, 4)).toBe(true)
    // Not whole screen pixels tall, or not starting on one.
    expect(rowsDrawAlike(1, 16.5, 4)).toBe(false)
    expect(rowsDrawAlike(2, 16, 4.25)).toBe(false)
    // A scale that is no power of two: 1.6 as Chromium reports it.
    expect(rowsDrawAlike(Math.fround(1.6), 29 / Math.fround(1.6), 4)).toBe(
      false
    )
    expect(rowsDrawAlike(1.25, 16, 4)).toBe(false)
    expect(rowsDrawAlike(1.5, 18, 4)).toBe(false)
    expect(rowsDrawAlike(3, 17, 4)).toBe(false)
  })

  it("draws as T3's renderer did while a glyph may stand past its row", async () => {
    const { core, frame } = await terminal("╱ diagonal\r\n" + lines(1, 3))
    expect(rowsDrawn(frame())).toEqual([...Array(ROWS).keys()])
    // T3's rows: the cursor's, every frame, though nothing changed.
    expect(rowsDrawn(frame())).toEqual([3])
    core.write(lines(3, ROWS + 2))
    const scrolled = frame()
    expect(scrolled.filter(({ name }) => name === "drawImage")).toEqual([])
    expect(rowsDrawn(scrolled)).toEqual([...Array(ROWS).keys()])
    // Scrolled off, and every row drawn since: the renderer draws only
    // what changed again.
    expect(frame()).toEqual([])
    core.dispose()
  })
})
