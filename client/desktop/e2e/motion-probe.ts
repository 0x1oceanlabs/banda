/**
 * What motion.spec.ts counts inside the window's page (ADR 0088, decision
 * 13). `install` runs in the page once it has loaded. It wraps
 * `requestAnimationFrame`, the getters that read layout and the canvas's
 * drawing calls in place, and the page's code looks each up as it calls
 * it: so it counts the Window's code, its Panes' and the terminals', and
 * never its own.
 *
 * - The page's own ticks: each `requestAnimationFrame` callback, the ticks
 *   any of them ran in, and the reads of layout made inside them, those
 *   of the clock's read phase (`afterMoves`) too.
 * - Each terminal: its draws, while its canvas shows on screen and while it
 *   does not, and its fits. A draw is one pass of drawing calls, within one
 *   task; a fit, the canvas taking a new size.
 * - The Marks' draws: each task that changed the drawing of a Mark on the
 *   window at `reset`, as the logo's trick does.
 * - Long tasks, long animation frames and slow keys, where Chromium has
 *   them.
 * - React's drawings of the Tiles, the Strips, the bar's widgets and the
 *   sidebar: each time React commits one's element again. React gives an
 *   element it commits its props, under a key of its own, only when the
 *   component that draws it was drawn again, so the probe counts the sets
 *   of that key. It finds the elements as it resets and as it reads where
 *   the page stands, and counts each from then on.
 * - Where the browser's page stands against its slot. In a phase that
 *   moves, the probe reads it after every tick, with ticks of its own, and
 *   keeps how long each tick came after the last; in a still one, five
 *   times a second, asking for no tick, so a quiet window stays quiet. It
 *   keeps the time those reads took.
 *
 * The wrappers cost time on every call they count: the timings measured
 * with the probe on are a little worse than the window's own.
 *
 * Every function here runs in the page: none may reach anything outside
 * itself.
 */

/** A terminal's counts: `[shown, not shown]` for its draws and calls. */
export type TerminalCount = {
  name: string
  draws: [number, number]
  calls: [number, number]
  fits: number
}

/** What the probe counted since `reset`. */
export type Reading = {
  /** How long it counted, in ms: from `reset` to `read`. */
  ms: number
  /** The page's `requestAnimationFrame` callbacks, and the ticks they ran in. */
  callbacks: number
  ticks: number
  /** Reads of layout (sizes, places, rects) inside those callbacks. */
  reads: number
  terminals: TerminalCount[]
  /** The tasks that changed a Mark's drawing. */
  marks: number
  longTasks: { count: number; worstMs: number }
  /** None where Chromium has no long animation frames. */
  longFrames: { count: number; worstMs: number; blockingMs: number } | null
  /** Keys whose next frame came 16 ms or more after them. */
  slowKeys: { count: number; worstMs: number } | null
  /** While the probe follows the ticks: the time between each and the one
   * before, in ms. */
  intervals: number[]
  /** For each read that found the browser's slot showing: how far its page
   * stood from it, in px; -1 if the page was put away. */
  trail: number[]
  /** The time the probe's own reads of the page took, in ms. */
  ownMs: number
  /** React's drawings of the parts it counts, by the part. */
  renders: Record<Drawn, number>
}

/** The parts whose drawings the probe counts. */
export type Drawn = "tiles" | "strips" | "widgets" | "sidebar"

type Probe = { reset: (moving: boolean) => void; read: () => Reading }

export function install(): void {
  const global = globalThis as unknown as { bandaMotion?: Probe }
  if (global.bandaMotion) return

  const types = PerformanceObserver.supportedEntryTypes
  const hasLongFrames = types.includes("long-animation-frame")
  const hasKeys = types.includes("event")
  const fresh = () => ({
    from: performance.now(),
    callbacks: 0,
    ticks: 0,
    reads: 0,
    marks: 0,
    longTasks: { count: 0, worstMs: 0 },
    longFrames: hasLongFrames ? { count: 0, worstMs: 0, blockingMs: 0 } : null,
    slowKeys: hasKeys ? { count: 0, worstMs: 0 } : null,
    intervals: [] as number[],
    trail: [] as number[],
    ownMs: 0,
    renders: { tiles: 0, strips: 0, widgets: 0, sidebar: 0 },
  })
  let state = fresh()
  let inside = 0
  let lastTick = -1

  // The page's ticks. Callbacks of one tick share its time.
  const frame = window.requestAnimationFrame.bind(window)
  window.requestAnimationFrame = (callback) =>
    frame((now) => {
      state.callbacks += 1
      if (now !== lastTick) {
        state.ticks += 1
        lastTick = now
      }
      inside += 1
      try {
        callback(now)
      } finally {
        inside -= 1
      }
    })

  // Reads of layout, counted only inside a tick.
  const countReads = (proto: object, name: string) => {
    const own = Object.getOwnPropertyDescriptor(proto, name)
    const get = own?.get
    if (!own || !get) return
    Object.defineProperty(proto, name, {
      ...own,
      get() {
        if (inside) state.reads += 1
        return get.call(this)
      },
    })
  }
  for (const name of ["offsetLeft", "offsetTop", "offsetWidth", "offsetHeight"])
    countReads(HTMLElement.prototype, name)
  for (const name of [
    "clientLeft",
    "clientTop",
    "clientWidth",
    "clientHeight",
    "scrollLeft",
    "scrollTop",
    "scrollWidth",
    "scrollHeight",
  ])
    countReads(Element.prototype, name)
  const rect = Element.prototype.getBoundingClientRect
  const rects = Element.prototype.getClientRects
  Element.prototype.getBoundingClientRect = function () {
    if (inside) state.reads += 1
    return rect.call(this)
  }
  Element.prototype.getClientRects = function () {
    if (inside) state.reads += 1
    return rects.call(this)
  }

  // The terminals, by their canvases, named in the order first seen.
  type Terminal = TerminalCount & {
    shown: boolean
    drawing: boolean
    sizing: boolean
  }
  const terminals = new Map<HTMLCanvasElement, Terminal>()
  // A canvas that only touches the screen's edge intersects with nothing
  // showing: the second threshold says when it comes on.
  const sight = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const terminal = terminals.get(entry.target as HTMLCanvasElement)
        if (terminal)
          terminal.shown = entry.isIntersecting && entry.intersectionRatio > 0
      }
    },
    { threshold: [0, 0.001] }
  )
  const find = () => {
    for (const canvas of document.querySelectorAll<HTMLCanvasElement>(
      '[aria-label="Terminal screen"] > canvas'
    )) {
      if (terminals.has(canvas)) continue
      terminals.set(canvas, {
        name: `terminal ${terminals.size}`,
        draws: [0, 0],
        calls: [0, 0],
        fits: 0,
        shown: false,
        drawing: false,
        sizing: false,
      })
      sight.observe(canvas)
    }
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
      const terminal = terminals.get(this.canvas)
      if (terminal) {
        const side = terminal.shown ? 0 : 1
        terminal.calls[side] += 1
        if (!terminal.drawing) {
          terminal.drawing = true
          terminal.draws[side] += 1
          queueMicrotask(() => (terminal.drawing = false))
        }
      }
      return draw.apply(this, args)
    }
  }
  for (const name of ["width", "height"] as const) {
    const own = Object.getOwnPropertyDescriptor(
      HTMLCanvasElement.prototype,
      name
    )!
    Object.defineProperty(HTMLCanvasElement.prototype, name, {
      ...own,
      set(this: HTMLCanvasElement, value: number) {
        const terminal = terminals.get(this)
        if (terminal && !terminal.sizing && own.get!.call(this) !== value) {
          terminal.sizing = true
          terminal.fits += 1
          queueMicrotask(() => (terminal.sizing = false))
        }
        own.set!.call(this, value)
      },
    })
  }

  // The Marks, watched from `reset`: one callback is one task's changes.
  const marks = new MutationObserver(() => (state.marks += 1))
  const watchMarks = () => {
    marks.disconnect()
    for (const mark of document.querySelectorAll('[data-slot="banda-mark"]'))
      marks.observe(mark, { attributes: true, subtree: true })
  }

  // React's drawings, by the elements the parts draw: the Tiles in the
  // Strips, the Strips, the bar's widgets but the workspaces', whose list
  // follows the workspaces, and the sidebar.
  const drawn: Record<Drawn, string> = {
    tiles: "[data-strip] section[data-tile]",
    strips: "[data-strip]",
    widgets: "[data-widget]:not([data-widget='workspaces.list']) > *",
    sidebar: "aside[aria-label='Sidebar']",
  }
  const counted = new WeakSet<Element>()
  const hook = () => {
    for (const [part, selector] of Object.entries(drawn))
      for (const element of document.querySelectorAll(selector)) {
        if (counted.has(element)) continue
        const key = Object.keys(element).find((name) =>
          name.startsWith("__reactProps$")
        )
        if (!key) continue
        counted.add(element)
        let props = (element as unknown as Record<string, unknown>)[key]
        Object.defineProperty(element, key, {
          configurable: true,
          enumerable: true,
          get: () => props,
          set: (next: unknown) => {
            props = next
            state.renders[part as Drawn] += 1
          },
        })
      }
  }

  // What Chromium reports by itself.
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      state.longTasks.count += 1
      state.longTasks.worstMs = Math.max(
        state.longTasks.worstMs,
        entry.duration
      )
    }
  }).observe({ type: "longtask" })
  if (hasLongFrames)
    new PerformanceObserver((list) => {
      const counted = state.longFrames!
      for (const entry of list.getEntries()) {
        const blocking = (entry as unknown as { blockingDuration: number })
          .blockingDuration
        counted.count += 1
        counted.worstMs = Math.max(counted.worstMs, entry.duration)
        counted.blockingMs += blocking
      }
    }).observe({ type: "long-animation-frame" })
  if (hasKeys)
    new PerformanceObserver((list) => {
      const counted = state.slowKeys!
      for (const entry of list.getEntries()) {
        if (entry.name !== "keydown") continue
        counted.count += 1
        counted.worstMs = Math.max(counted.worstMs, entry.duration)
      }
    }).observe({
      type: "event",
      durationThreshold: 16,
    } as PerformanceObserverInit)

  // Where the browser's page stands, when its slot shows: inside its Strip
  // and inside the workspaces, which the Panes' layer fills.
  const sample = () => {
    const started = performance.now()
    hook()
    const box = document.querySelector("[data-held-by]")
    const id = box?.getAttribute("data-held-by")
    const slot = id && document.querySelector(`[data-holds="${id}"]`)
    const strip = slot && slot.closest("[data-strip]")
    const layer = document.querySelector("[data-pane-layer]")
    if (box && slot && strip && layer) {
      const a = rect.call(box)
      const b = rect.call(slot)
      const seen = [rect.call(strip), rect.call(layer)].reduce(
        (shown, clip) => ({
          left: Math.max(shown.left, clip.left),
          right: Math.min(shown.right, clip.right),
          top: Math.max(shown.top, clip.top),
          bottom: Math.min(shown.bottom, clip.bottom),
        }),
        { left: b.left, right: b.right, top: b.top, bottom: b.bottom }
      )
      if (seen.right - seen.left > 8 && seen.bottom - seen.top > 8)
        state.trail.push(
          a.left < -50000
            ? -1
            : Math.max(
                Math.abs(a.left - b.left),
                Math.abs(a.top - b.top),
                Math.abs(a.width - b.width)
              )
        )
    }
    state.ownMs += performance.now() - started
  }
  // Following the ticks, it reads after each, when layout is clean.
  let following = false
  let looping = false
  let last = 0
  let timer: ReturnType<typeof setInterval> | undefined
  const step = (now: number) => {
    looping = following
    if (!following) return
    if (last) state.intervals.push(now - last)
    last = now
    setTimeout(sample)
    frame(step)
  }

  const reset = (moving: boolean) => {
    find()
    watchMarks()
    hook()
    state = fresh()
    for (const terminal of terminals.values()) {
      terminal.draws = [0, 0]
      terminal.calls = [0, 0]
      terminal.fits = 0
    }
    following = moving
    last = 0
    clearInterval(timer)
    timer = moving ? undefined : setInterval(sample, 200)
    if (moving && !looping) {
      looping = true
      frame(step)
    }
  }
  reset(false)

  global.bandaMotion = {
    reset,
    read: () => ({
      ms: performance.now() - state.from,
      callbacks: state.callbacks,
      ticks: state.ticks,
      reads: state.reads,
      marks: state.marks,
      terminals: [...terminals.values()].map(
        ({ name, draws, calls, fits }) => ({ name, draws, calls, fits })
      ),
      longTasks: state.longTasks,
      longFrames: state.longFrames,
      slowKeys: state.slowKeys,
      intervals: state.intervals,
      trail: state.trail,
      ownMs: state.ownMs,
      renders: { ...state.renders },
    }),
  }
}

/** Starts counting afresh: following the ticks if `moving`. */
export function reset(moving: boolean): void {
  ;(globalThis as unknown as { bandaMotion: Probe }).bandaMotion.reset(moving)
}

/** What was counted since `reset`. */
export function read(): Reading {
  return (globalThis as unknown as { bandaMotion: Probe }).bandaMotion.read()
}
