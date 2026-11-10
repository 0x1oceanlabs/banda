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
 *   of the clock's read phase (`afterMoves`) too; and of those, the reads
 *   of the sidebar's own elements, as the Tiling's and the pages' moves
 *   read theirs in the same ticks.
 * - Each terminal: its draws, while its canvas shows on screen and while it
 *   does not, and its fits. A draw is one pass of drawing calls, within one
 *   task; a fit, the canvas taking a new size. When it came on screen, as
 *   the browser's own observer works it out in the frame that first shows
 *   it; asked (`resetTexts`), the text it drew before.
 * - The Marks' draws: each task that changed the drawing of a Mark on the
 *   window at `reset`, as the logo's trick does.
 * - Long tasks, long animation frames and slow keys, where Chromium has
 *   them.
 * - React's drawings of the Tiles, the Strips, the bar's widgets and the
 *   sidebar: each time React commits one's element again. React gives an
 *   element it commits its props, under a key of its own, only when the
 *   component that draws it was drawn again, so the probe counts the sets
 *   of that key. It finds the elements as it resets and as React adds
 *   them, and counts each from then on; it says how many it found, so a
 *   probe that finds none never reads as a part drawn no more.
 * - Each key's way to the screen: how long after the key the Tiling
 *   committed what it changed, and how many frames began meanwhile. A
 *   MutationObserver watches the workspaces' root, its whole subtree, so
 *   a workspace's `aria-hidden` and a column's width count as they
 *   commit; what the ticks' callbacks write, the springs' motion, is
 *   taken out after each callback, so it never reads as a commit.
 *   Committed before the next frame begins, a key is drawn in it: so the
 *   time is to the commit, not to the frame, which a key that lands at a
 *   random point of a frame waits for even at its best.
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
  /** When it came on screen, as the frame showing it was worked out; 0
   * while it has not. */
  came: number
  /** Of the text it drew, kept only as `resetTexts` asks: what it drew
   * before it came on screen, or all of it if it has not. */
  before: string
}

/** What the probe counted since `reset`. */
export type Reading = {
  /** How long it counted, in ms: from `reset` to `read`. */
  ms: number
  /** The page's `requestAnimationFrame` callbacks, and the ticks they ran in. */
  callbacks: number
  ticks: number
  /** In a still phase, where the first few of those callbacks were asked
   * for: the stack of each one's `requestAnimationFrame` call. */
  stacks: string[]
  /** Reads of layout (sizes, places, rects) inside those callbacks. */
  reads: number
  /** Of those, the reads of the sidebar's own elements. */
  sidebarReads: number
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
  /** Each key pressed: how long after it the Tiling committed what it
   * changed, in ms, and how many frames began meanwhile; `ms` is null for
   * one that changed nothing within two seconds, or before the next key. */
  keys: { code: string; ms: number | null; frames: number }[]
  /** For each read that found the browser's slot showing: how far its page
   * stood from it, in px; -1 if the page was put away. */
  trail: number[]
  /** The time the probe's own reads of the page took, in ms. */
  ownMs: number
  /** React's drawings of the parts it counts, by the part. */
  renders: Record<Drawn, number>
  /** The elements of each part it has counted the drawings of, since it
   * was installed. */
  hooked: Record<Drawn, number>
}

/** The parts whose drawings the probe counts. */
export type Drawn = "tiles" | "strips" | "widgets" | "sidebar"

type Probe = {
  reset: (moving: boolean, texts?: boolean) => void
  read: () => Reading
}

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
    stacks: [] as string[],
    reads: 0,
    sidebarReads: 0,
    marks: 0,
    longTasks: { count: 0, worstMs: 0 },
    longFrames: hasLongFrames ? { count: 0, worstMs: 0, blockingMs: 0 } : null,
    slowKeys: hasKeys ? { count: 0, worstMs: 0 } : null,
    intervals: [] as number[],
    keys: [] as Reading["keys"],
    trail: [] as number[],
    ownMs: 0,
    renders: { tiles: 0, strips: 0, widgets: 0, sidebar: 0 },
  })
  let state = fresh()
  let inside = 0
  let lastTick = -1

  // The page's ticks. Callbacks of one tick share its time. In a still
  // phase, which asks for none, the first few say who asked: a stack costs
  // too much to take for each tick of a phase that moves.
  const STACKS = 3
  const frame = window.requestAnimationFrame.bind(window)
  window.requestAnimationFrame = (callback) => {
    const asked =
      !following && state.stacks.length < STACKS
        ? new Error().stack?.split("\n").slice(2).join("\n")
        : undefined
    return frame((now) => {
      state.callbacks += 1
      if (asked && state.stacks.length < STACKS) state.stacks.push(asked)
      if (now !== lastTick) {
        state.ticks += 1
        lastTick = now
      }
      inside += 1
      try {
        callback(now)
      } finally {
        inside -= 1
        // What a tick wrote is motion, not a key's commit.
        commits.takeRecords()
      }
    })
  }

  // Reads of layout, counted only inside a tick, the sidebar's apart.
  const countRead = (element: Element) => {
    state.reads += 1
    if (element.closest("aside[data-sidebar]")) state.sidebarReads += 1
  }
  const countReads = (proto: object, name: string) => {
    const own = Object.getOwnPropertyDescriptor(proto, name)
    const get = own?.get
    if (!own || !get) return
    Object.defineProperty(proto, name, {
      ...own,
      get(this: Element) {
        if (inside) countRead(this)
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
    if (inside) countRead(this)
    return rect.call(this)
  }
  Element.prototype.getClientRects = function () {
    if (inside) countRead(this)
    return rects.call(this)
  }

  // The terminals, by their canvases, named in the order first seen.
  type Terminal = Omit<TerminalCount, "before"> & {
    shown: boolean
    drawing: boolean
    sizing: boolean
    texts: { at: number; text: string }[]
  }
  // The text the terminals draw is kept only as asked.
  let texts = false
  const terminals = new Map<HTMLCanvasElement, Terminal>()
  // A canvas that only touches the screen's edge intersects with nothing
  // showing: the second threshold says when it comes on.
  const sight = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const terminal = terminals.get(entry.target as HTMLCanvasElement)
        if (!terminal) continue
        const shown = entry.isIntersecting && entry.intersectionRatio > 0
        if (shown && !terminal.shown && terminal.came === 0)
          terminal.came = entry.time
        terminal.shown = shown
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
        came: 0,
        shown: false,
        drawing: false,
        sizing: false,
        texts: [],
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
        if (texts && name === "fillText")
          terminal.texts.push({ at: performance.now(), text: String(args[0]) })
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

  // Each key, from its event's time to the first commit in the
  // workspaces after it, counting the frames that began meanwhile with
  // ticks of the probe's own, which ask for none once it is drawn.
  type Waiting = { code: string; at: number; frames: number }
  let waiting: Waiting[] = []
  const LONGEST = 120
  // The Window's own listener may hear a key before the probe's does, and
  // commit before it: the last commit's time tells it then.
  let committed = -1
  const commits = new MutationObserver(() => {
    const now = performance.now()
    committed = now
    for (const key of waiting)
      state.keys.push({ code: key.code, ms: now - key.at, frames: key.frames })
    waiting = []
  })
  const watchCommits = () => {
    commits.disconnect()
    const root = document.querySelector("[data-stack]")?.parentElement
    if (root)
      commits.observe(root, {
        attributes: true,
        childList: true,
        subtree: true,
      })
  }
  const count = (key: Waiting) => () => {
    if (!waiting.includes(key)) return
    key.frames += 1
    if (key.frames < LONGEST) frame(count(key))
    else {
      waiting = waiting.filter((one) => one !== key)
      state.keys.push({ code: key.code, ms: null, frames: key.frames })
    }
  }
  window.addEventListener(
    "keydown",
    (event) => {
      if (event.repeat || /^(Alt|Control|Shift|Meta)/.test(event.code)) return
      // One not drawn before the next key changed nothing it could see.
      for (const key of waiting)
        state.keys.push({ code: key.code, ms: null, frames: key.frames })
      waiting = []
      // Committed already, as the Window heard it first.
      const at = event.timeStamp
      if (commits.takeRecords().length > 0) committed = performance.now()
      if (committed >= at) {
        state.keys.push({ code: event.code, ms: committed - at, frames: 0 })
        return
      }
      const key = { code: event.code, at, frames: 0 }
      waiting = [key]
      frame(count(key))
    },
    { capture: true }
  )

  // The Marks, watched from `reset`: one callback is one task's changes.
  const marks = new MutationObserver(() => (state.marks += 1))
  const watchMarks = () => {
    marks.disconnect()
    for (const mark of document.querySelectorAll('[data-slot="banda-mark"]'))
      marks.observe(mark, { attributes: true, subtree: true })
  }

  // React's drawings, by the elements the parts draw: the Tiles in the
  // Strips, the Strips, the bar's widgets, the workspaces' numbers but not
  // their Group map, which frames the column in focus, and the sidebar.
  const drawn: Record<Drawn, string> = {
    tiles: "[data-strip] section[data-tile]",
    strips: "[data-strip]",
    widgets:
      "[data-widget]:not([data-widget='workspaces.list']) > *, [data-widget='workspaces.list'] > nav",
    sidebar: "aside[aria-label='Sidebar']",
  }
  const counted = new WeakSet<Element>()
  const hooked: Record<Drawn, number> = {
    tiles: 0,
    strips: 0,
    widgets: 0,
    sidebar: 0,
  }
  const hookOne = (part: Drawn, element: Element) => {
    if (counted.has(element)) return
    const key = Object.keys(element).find((name) =>
      name.startsWith("__reactProps$")
    )
    if (!key) return
    counted.add(element)
    hooked[part] += 1
    let props = (element as unknown as Record<string, unknown>)[key]
    Object.defineProperty(element, key, {
      configurable: true,
      enumerable: true,
      get: () => props,
      set: (next: unknown) => {
        props = next
        state.renders[part] += 1
      },
    })
  }
  const hook = (root: ParentNode) => {
    for (const [part, selector] of Object.entries(drawn) as [Drawn, string][]) {
      if (root instanceof Element && root.matches(selector)) hookOne(part, root)
      for (const element of root.querySelectorAll(selector))
        hookOne(part, element)
    }
  }
  // What React adds, as it adds it; its time is the probe's own.
  new MutationObserver((records) => {
    const started = performance.now()
    for (const record of records)
      for (const node of record.addedNodes)
        if (node instanceof Element) hook(node)
    state.ownMs += performance.now() - started
  }).observe(document.body, { childList: true, subtree: true })

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

  const reset = (moving: boolean, keep = false) => {
    texts = keep
    find()
    watchMarks()
    watchCommits()
    waiting = []
    hook(document)
    state = fresh()
    for (const terminal of terminals.values()) {
      terminal.draws = [0, 0]
      terminal.calls = [0, 0]
      terminal.fits = 0
      terminal.came = 0
      terminal.texts = []
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
      stacks: state.stacks,
      reads: state.reads,
      sidebarReads: state.sidebarReads,
      marks: state.marks,
      terminals: [...terminals.values()].map(
        ({ name, draws, calls, fits, came, texts }) => ({
          name,
          draws,
          calls,
          fits,
          came,
          before: texts
            .filter(({ at }) => came === 0 || at < came)
            .map(({ text }) => text)
            .join(" "),
        })
      ),
      longTasks: state.longTasks,
      longFrames: state.longFrames,
      slowKeys: state.slowKeys,
      intervals: state.intervals,
      keys: state.keys,
      trail: state.trail,
      ownMs: state.ownMs,
      renders: { ...state.renders },
      hooked: { ...hooked },
    }),
  }
}

/** Starts counting afresh: following the ticks if `moving`. */
export function reset(moving: boolean): void {
  ;(globalThis as unknown as { bandaMotion: Probe }).bandaMotion.reset(moving)
}

/** Starts counting afresh, still, keeping the text each terminal draws. */
export function resetTexts(): void {
  ;(globalThis as unknown as { bandaMotion: Probe }).bandaMotion.reset(
    false,
    true
  )
}

/** What was counted since `reset`. */
export function read(): Reading {
  return (globalThis as unknown as { bandaMotion: Probe }).bandaMotion.read()
}
