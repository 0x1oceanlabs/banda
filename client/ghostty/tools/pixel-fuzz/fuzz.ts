// The page `run.mjs` opens: this checkout's GhosttyRenderer and another's
// renderer, `@against`, each on a canvas of its own, fed the same random
// output, scrolls, selections, hovered links, focus, cursors and resizes,
// and their pixels compared after every frame (ADR 0088, step P4). With
// `?self`, `@against` is this checkout and draws a whole frame each time,
// so what the renderer leaves out of a frame must already be on its
// canvas.
import { GhosttyTerminalCore } from "../../src/t3/core"
import {
  GhosttyRenderer,
  measureGhosttyCell,
  type GhosttyCellRange,
  type GhosttyRenderOptions,
} from "../../src/t3/renderer"
import { onDevicePixel } from "../../src/glyphs"
import { GhosttyTerminalCore as AgainstCore } from "@against/t3/core"
import * as against from "@against/t3/renderer"

const SELF = new URLSearchParams(location.search).has("self")

const THEME = {
  foreground: { r: 220, g: 221, b: 222 },
  background: { r: 10, g: 11, b: 12 },
  cursor: { r: 255, g: 200, b: 0 },
}

/** The same numbers for the same seed, on every build. */
function random(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 2 ** 32
  }
}

// What a line is made of: every style a cell has, wide letters, emoji, a
// ligature, and each kind of glyph the terminal draws itself.
const PIECES = [
  "hello world ",
  "\x1b[1;32mgreen\x1b[0m ",
  "\x1b[4munder\x1b[0m ",
  "\x1b[7minv\x1b[0m ",
  "\x1b[44mblue\x1b[0m ",
  "漢字 ",
  "👍 ",
  "👨‍👩‍👧 ",
  "-> != ",
  "┌─┐ ",
  "╭─╮ ",
  "⣿▀▄▒ ",
  "\x1b[38;2;255;128;0morange\x1b[0m ",
  "\x1b[2mfaint\x1b[0m ",
  "\x1b[53mover\x1b[0m ",
  "\x1b[9mstrike\x1b[0m ",
  "\x1b[3mitalic gy\x1b[0m ",
  "\x1b[48;5;22merased\x1b[K\x1b[0m",
  "┄┅┆┇┈┉┊┋╌╍╎╏ ",
  "━┃┏┓┗┛╋═║╔╗╚╝╬ ",
  " ",
  "░▒▓ ",
  "▖▗▘▙▚▛▜▝▞▟ ",
  "▁▂▃▅▆▇█▉▊▋▌▍▎▏▐▔▕ ",
  "⠁⠂⠄⡀⢀⠈⠐⠠⣀⣤⣶ ",
  "╰╯ ",
  "\x1b[1;4;3mbold under italic\x1b[0m ",
  "\x1b[4;53;9mall lines\x1b[0m ",
]
// Diagonals stand past their rows: only with `diagonals`.
const DIAGONALS = "╱╲╳ "

/** Some output: lines, a scroll region scrolled both ways, lines put in or
 * taken out, the other screen, a clear, text anywhere, the cursor hidden,
 * shown or restyled, scrolls, characters put in, a line erased. */
function output(
  next: () => number,
  rows: number,
  cols: number,
  diagonals: boolean
): string {
  const pick = next()
  const n = (k: number) => Math.floor(next() * k)
  const piece = () => PIECES[n(PIECES.length)]
  if (pick < 0.35) {
    let text = ""
    for (let line = 0, count = 1 + n(4); line < count; line++) {
      for (let j = 0, pieces = 1 + n(4); j < pieces; j++) text += piece()
      if (diagonals && next() < 0.15) text += DIAGONALS
      text += "\r\n"
    }
    return text
  }
  if (pick < 0.45) {
    const top = 1 + n(rows - 2)
    const bottom = top + 1 + n(rows - top)
    let text = `\x1b[${top};${bottom}r\x1b[${bottom};1H`
    for (let i = 0, count = 1 + n(3); i < count; i++)
      text += `region ${i} ${piece()}\r\n`
    if (next() < 0.5) text += `\x1b[${top};1H\x1bM\x1bMrev`
    if (next() < 0.5) text += `\x1b[${1 + n(3)}S`
    if (next() < 0.5) text += `\x1b[${1 + n(3)}T`
    return `${text}\x1b[r\x1b[${rows};1H`
  }
  if (pick < 0.5) return `\x1b[${1 + n(rows)};1H\x1b[${1 + n(3)}L`
  if (pick < 0.55) return `\x1b[${1 + n(rows)};1H\x1b[${1 + n(3)}M`
  if (pick < 0.6)
    return next() < 0.5
      ? `\x1b[?1049h\x1b[H\x1b[2Jalt screen\r\n${piece()}`
      : "\x1b[?1049l"
  if (pick < 0.63)
    return next() < 0.5 ? "\x1b[H\x1b[2J" : "\x1b[H\x1b[2J\x1b[3J"
  if (pick < 0.7) return `\x1b[${1 + n(rows)};${1 + n(cols)}H${piece()}`
  if (pick < 0.73) return next() < 0.5 ? "\x1b[?25l" : "\x1b[?25h"
  if (pick < 0.76) return `\x1b[${n(7)} q`
  if (pick < 0.8) return `\x1b[${1 + n(3)}S`
  if (pick < 0.83) return `\x1b[${1 + n(3)}T`
  if (pick < 0.86) return `\x1b[${1 + n(rows)};${1 + n(cols)}H\x1b[${1 + n(4)}@`
  if (pick < 0.88) return `\x1b[${1 + n(rows)};1H\x1b[K`
  return piece()
}

function canvasOf(width: number, height: number, ratio: number) {
  const canvas = document.createElement("canvas")
  canvas.width = Math.round(width * ratio)
  canvas.height = Math.round(height * ratio)
  document.body.append(canvas)
  const context = canvas.getContext("2d")!
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  return { canvas, context }
}

type Options = Omit<GhosttyRenderOptions, "context" | "snapshot">
type Snapshot = GhosttyRenderOptions["snapshot"]

/** How the other build draws a frame, as its surface drives it. */
function againstDrawer() {
  if (SELF)
    return (options: GhosttyRenderOptions) =>
      new against.GhosttyRenderer().render({ ...options, forceFull: true })
  if ("GhosttyRenderer" in against) {
    const renderer = new against.GhosttyRenderer()
    return (options: GhosttyRenderOptions) => renderer.render(options)
  }
  // T3's renderer before P4: the surface tells it the cursor's last row.
  let cursorRow: number | null = null
  return (options: GhosttyRenderOptions) => {
    const { snapshot } = options
    against.renderGhosttySnapshot({ ...options, previousCursorY: cursorRow })
    cursorRow =
      options.cursorOn && snapshot.cursorVisible && snapshot.cursorY >= 0
        ? snapshot.cursorY
        : null
  }
}

/** The first difference of two canvases' pixels, or null. */
function compare(left: HTMLCanvasElement, right: HTMLCanvasElement) {
  const read = (canvas: HTMLCanvasElement) =>
    canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height)
      .data
  const [a, b] = [read(left), read(right)]
  let count = 0
  let first = -1
  // The most a pixel's alpha differs by, and its colour as it shows.
  let alpha = 0
  let shown = 0
  for (let at = 0; at < a.length; at += 4) {
    if (
      a[at] === b[at] &&
      a[at + 1] === b[at + 1] &&
      a[at + 2] === b[at + 2] &&
      a[at + 3] === b[at + 3]
    )
      continue
    count += 1
    if (first < 0) first = at / 4
    alpha = Math.max(alpha, Math.abs(a[at + 3]! - b[at + 3]!))
    for (let channel = 0; channel < 3; channel++) {
      const premultiplied = (data: Uint8ClampedArray) =>
        (data[at + channel]! * data[at + 3]!) / 255
      shown = Math.max(shown, Math.abs(premultiplied(a) - premultiplied(b)))
    }
  }
  if (count === 0) return null
  const x = first % left.width
  const y = Math.floor(first / left.width)
  return { count, x, y, alpha, shown: Math.round(shown) }
}

async function run(
  seed: number,
  scale: number,
  diagonals: boolean,
  steps: number
) {
  // Chromium keeps a screen's scale as a float: its 1.6 is
  // 1.600000023841858, and so is the page's devicePixelRatio.
  const ratio = Math.fround(scale)
  const next = random(seed)
  let cols = 34
  let rows = 14
  const fontSize = 11 + (seed % 7)
  const fontFamily = "monospace"
  const probe = canvasOf(10, 10, ratio)
  const metrics = measureGhosttyCell(probe.context, fontSize, fontFamily, ratio)
  probe.canvas.remove()
  const padding = 4
  const originY = onDevicePixel(padding, ratio)
  const width = 40 * metrics.width + padding * 2
  const height = 20 * metrics.height + padding * 2
  const mine = canvasOf(width, height, ratio)
  const theirs = canvasOf(width, height, ratio)
  const make = (Core: typeof GhosttyTerminalCore) =>
    Core.create(cols, rows, metrics.width, metrics.height, THEME, () => {})
  const cores = [
    await make(GhosttyTerminalCore),
    await make(AgainstCore as typeof GhosttyTerminalCore),
  ]
  const renderer = new GhosttyRenderer()
  const draw = againstDrawer()
  let link: GhosttyCellRange | null = null
  let focused = true
  let cursorOn = true
  let forceFull = true
  let hidden = 0
  const both = (act: (core: GhosttyTerminalCore) => void) => cores.forEach(act)
  const done = () => {
    mine.canvas.remove()
    theirs.canvas.remove()
    cores.forEach((core) => core.dispose())
  }
  for (let step = 0; step < steps; step++) {
    const p = next()
    let what: string
    if (p < 0.6) {
      const text = output(next, rows, cols, diagonals)
      what = `write ${JSON.stringify(text)}`
      both((core) => core.write(text))
    } else if (p < 0.67) {
      const by = Math.floor(next() * 9) - 6
      what = `scroll ${by}`
      both((core) => core.scroll(by))
      forceFull = true
    } else if (p < 0.7) {
      what = "bottom"
      both((core) => core.scrollToBottom())
      forceFull = true
    } else if (p < 0.76) {
      const y0 = Math.floor(next() * rows)
      const y1 = Math.min(rows - 1, y0 + Math.floor(next() * 4))
      const x0 = Math.floor(next() * cols)
      const x1 = Math.floor(next() * cols)
      what = `select ${x0},${y0} ${x1},${y1}`
      both((core) => core.setSelection({ x: x0, y: y0 }, { x: x1, y: y1 }))
      forceFull = true
    } else if (p < 0.79) {
      what = "unselect"
      both((core) => core.clearSelection())
      forceFull = true
    } else if (p < 0.84) {
      const y = Math.floor(next() * rows)
      link =
        next() < 0.3
          ? null
          : {
              start: { x: Math.floor(next() * 10), y },
              end: {
                x: 10 + Math.floor(next() * 10),
                y: Math.min(rows - 1, y + Math.floor(next() * 2)),
              },
            }
      what = `link ${JSON.stringify(link)}`
      forceFull = true
    } else if (p < 0.88) {
      focused = !focused
      what = `focused ${focused}`
    } else if (p < 0.92) {
      cursorOn = !cursorOn
      what = `cursor on ${cursorOn}`
    } else if (p < 0.94) {
      cols = 24 + Math.floor(next() * 14)
      rows = 8 + Math.floor(next() * 10)
      what = `resize ${cols}x${rows}`
      both((core) => core.resize(cols, rows, metrics.width, metrics.height))
      forceFull = true
    } else if (p < 0.97) {
      // Hidden for some frames: the next drawn frame takes what they missed.
      hidden = 1 + Math.floor(next() * 5)
      what = `hidden ${hidden}`
    } else {
      forceFull = true
      what = "full"
    }
    if (hidden > 0) {
      hidden -= 1
      continue
    }
    const options: Options = {
      metrics,
      fontSize,
      fontFamily,
      ligatures: true,
      ratio,
      padding,
      originY,
      forceFull,
      cursorOn,
      focused,
      hoveredLinkRange: link,
    }
    const [own, other] = cores.map((core) => core.snapshot()) as Snapshot[]
    renderer.render({ ...options, context: mine.context, snapshot: own! })
    draw({ ...options, context: theirs.context, snapshot: other! })
    forceFull = false
    const differs = compare(mine.canvas, theirs.canvas)
    if (differs) {
      done()
      const row = Math.floor((differs.y / ratio - originY) / metrics.height)
      return { seed, scale, diagonals, step, what, row, ...differs }
    }
  }
  done()
  return null
}

declare global {
  interface Window {
    fuzz: (options: {
      from: number
      to: number
      scales: number[]
      diagonals: boolean
      steps: number
    }) => Promise<unknown[]>
    ready: boolean
  }
}

window.fuzz = async ({ from, to, scales, diagonals, steps }) => {
  const failures: unknown[] = []
  for (let seed = from; seed < to; seed++) {
    for (const scale of scales) {
      const failure = await run(seed, scale, diagonals, steps)
      if (failure) failures.push(failure)
    }
  }
  return failures
}
window.ready = true
