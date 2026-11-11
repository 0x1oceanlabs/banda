/**
 * A phase's trace, summed up (ADR 0088, decision 13): Chromium's own record
 * of the window's processes while the phase ran, taken over the DevTools
 * protocol and read here, in the test, so nothing but the numbers is kept.
 * Electron's `contentTracing` takes the same trace, but writes it only as
 * Perfetto's protobuf; the protocol hands it over as JSON.
 *
 * - **Frames**, from cc's `PipelineReporter`, one per tick of a renderer's
 *   compositor: presented whole, presented in part, dropped, or not wanted
 *   (nothing changed); late, when the main thread's part came after its
 *   tick; and how long the presented ones took from the tick to the
 *   screen. The window's renderer and the browser's pages apart.
 * - **Moving frames**: the window's ticks whose frame was presented or
 *   dropped, so its picture changed. In the phases that move something,
 *   these are the frames that moved it. For each, what its renderer's main
 *   thread began from that tick to the next: layouts, style
 *   recalculations, and the time its tasks took, whole, so a task that
 *   runs past the next tick counts in full in the frame it began in.
 * - **Tasks** of the window's main thread over 8.3 ms (a frame at 120 Hz)
 *   and over 16.7 ms, and the longest.
 * - **viz and the GPU**: the frames the display compositor showed, how
 *   long it took to draw one, and how busy the GPU process's main thread
 *   was.
 * - **Paints** of the window's main thread, a second: what a CSS
 *   animation the compositor cannot run costs it on every frame, and the
 *   loops' steps (ADR 0117).
 */
import { writeFileSync } from "node:fs"
import type { Shown } from "@banda/ui/lib/mark-state"
import { LOOPED, LOOPS } from "@banda/ui/lib/mark-rhythm"
import type { CDPSession } from "@playwright/test"

/** What the spec stamps into the window's trace as a phase starts and
 * ends: only what lies between counts. */
export const MARKS = { start: "motion: start", end: "motion: end" }

/** What a phase's trace takes in: few categories, so it costs little. */
const CATEGORIES = ["toplevel", "devtools.timeline", "benchmark"]

/** `promise`, or a failure that names `what` once 20 s went by without it:
 * a DevTools call that never answers fails the phase, not the test's whole
 * time. */
export function within<T>(promise: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, fail) => {
    timer = setTimeout(
      () => fail(new Error(`${what}: no answer in 20 s`)),
      20_000
    )
  })
  return Promise.race([promise, late]).finally(() => clearTimeout(timer))
}

/** Starts a trace of every process of the window, for `phase`. */
export async function startTrace(
  cdp: CDPSession,
  phase: string
): Promise<void> {
  await within(
    cdp.send("Tracing.start", {
      transferMode: "ReturnAsStream",
      streamFormat: "json",
      traceConfig: {
        includedCategories: CATEGORIES,
        excludedCategories: ["*"],
        recordMode: "recordAsMuchAsPossible",
      },
    }),
    `${phase}: Tracing.start`
  )
}

/** Ends the trace `startTrace` began, and reads its events; with `keep`,
 * it writes them to that file as well. A trace that lost events fails. */
export async function stopTrace(
  cdp: CDPSession,
  phase: string,
  keep?: string
): Promise<TraceEvent[]> {
  const complete = new Promise<{ stream?: string; dataLossOccurred: boolean }>(
    (done) => cdp.once("Tracing.tracingComplete", done)
  )
  await within(cdp.send("Tracing.end"), `${phase}: Tracing.end`)
  const { stream: handle, dataLossOccurred } = await within(
    complete,
    `${phase}: Tracing.tracingComplete`
  )
  if (dataLossOccurred) throw new Error(`${phase}: the trace lost events`)
  if (!handle) throw new Error(`${phase}: the trace came with no stream`)
  const parts: string[] = []
  for (;;) {
    const { data, eof, base64Encoded } = await within(
      cdp.send("IO.read", { handle, size: 1 << 22 }),
      `${phase}: IO.read`
    )
    parts.push(base64Encoded ? Buffer.from(data, "base64").toString() : data)
    if (eof) break
  }
  await within(cdp.send("IO.close", { handle }), `${phase}: IO.close`)
  const text = parts.join("")
  if (keep) writeFileSync(keep, text)
  const parsed = JSON.parse(text) as
    TraceEvent[] | { traceEvents: TraceEvent[] }
  return Array.isArray(parsed) ? parsed : parsed.traceEvents
}

/** One event of Chromium's JSON trace format. */
export type TraceEvent = {
  name: string
  ph: string
  pid: number
  tid: number
  ts: number
  dur?: number
  id2?: { local?: string; global?: string }
  id?: string | number
  args?: Record<string, unknown>
}

export type Frames = {
  /** Ticks presented with all their updates. */
  presented: number
  /** Ticks presented with the compositor's updates and not all the main
   * thread's. */
  partial: number
  dropped: number
  /** Ticks in which nothing changed, so no frame was wanted. */
  idle: number
  /** Ticks whose main thread's update came after the tick: cc forked their
   * reporter, and showed the rest later. */
  late: number
  /** From the tick to the screen, of the ticks presented. */
  latencyMs: { p50: number; p95: number } | null
}

export type Summary = {
  /** The window's renderer. */
  frames: Frames
  /** The browser's pages, each in a renderer of its own; none without. */
  pages: Frames | null
  moving: {
    frames: number
    /** Per moving frame; none without one. */
    layouts: number | null
    styles: number | null
    mainMs: { p50: number; p95: number; max: number } | null
  }
  tasks: { over8ms: number; over16ms: number; longestMs: number }
  /** The frames the display compositor showed, a second, and how long it
   * took to draw one. */
  viz: { perSecond: number; drawMs: { p50: number; p95: number } | null } | null
  /** How busy the GPU process's main thread was, in ms a second. */
  gpu: { msPerSecond: number } | null
  /** What the window's main thread painted, a second. */
  paints: { perSecond: number }
}

/** `value` to `places` decimal places. */
export const round = (value: number, places = 0) =>
  Math.round(value * 10 ** places) / 10 ** places

/** A copy of `values`, from the least. */
export const sortedOf = (values: readonly number[]) =>
  [...values].sort((a, b) => a - b)

/** The value at `q` of sorted `values`, to a tenth. */
export function quantile(sorted: readonly number[], q: number): number {
  const at = Math.min(sorted.length - 1, Math.floor(q * sorted.length))
  return round(sorted[at], 1)
}

/** The threads of `pid` named `name`. */
function threads(events: TraceEvent[], pid: number, name: string): Set<number> {
  const found = new Set<number>()
  for (const event of events)
    if (
      event.ph === "M" &&
      event.name === "thread_name" &&
      event.pid === pid &&
      (event.args as { name?: string } | undefined)?.name === name
    )
      found.add(event.tid)
  return found
}

/** cc's states, the best first: a tick takes the best of its reporters. */
const STATES = [
  "STATE_PRESENTED_ALL",
  "STATE_PRESENTED_PARTIAL",
  "STATE_DROPPED",
  "STATE_NO_UPDATE_DESIRED",
]

type Tick = { ts: number; state: number; late: boolean; latency?: number }

type Reporter = {
  state?: string
  frame_sequence?: number
  frame_type?: string
}

/** Each compositor tick of the renderers in `pids`, in order: cc reports
 * a tick once, or twice when it forks the report of a late main thread. */
function ticksOf(events: TraceEvent[], pids: Set<number>): Tick[] {
  const ticks = new Map<string, Tick>()
  const begun = new Map<string, { tick: Tick; state: number }>()
  for (const event of events) {
    if (event.name !== "PipelineReporter" || !pids.has(event.pid)) continue
    const id = `${event.pid}:${event.id2?.local ?? event.id2?.global ?? event.id}`
    if (event.ph === "b") {
      const reporter = (event.args?.frame_reporter ?? {}) as Reporter
      const key = `${event.pid}:${reporter.frame_sequence ?? event.ts}`
      const state = STATES.indexOf(reporter.state ?? "")
      // A state it does not know would read as the best: it fails instead.
      if (state < 0)
        throw new Error(
          `motion-trace.ts: cc reported a frame as ${reporter.state ?? "nothing"}`
        )
      const tick = ticks.get(key) ?? { ts: event.ts, state, late: false }
      tick.state = Math.min(tick.state, state)
      tick.late ||= reporter.frame_type === "FORKED"
      ticks.set(key, tick)
      begun.set(id, { tick, state })
    } else if (event.ph === "e") {
      const found = begun.get(id)
      begun.delete(id)
      // How long the tick took to show whole.
      if (found && found.state === 0)
        found.tick.latency = (event.ts - found.tick.ts) / 1000
    }
  }
  return [...ticks.values()].sort((a, b) => a.ts - b.ts)
}

function framesOf(ticks: Tick[]): Frames {
  const count = (state: number) => ticks.filter((t) => t.state === state).length
  const latencies = sortedOf(
    ticks.flatMap((t) => (t.latency === undefined ? [] : [t.latency]))
  )
  return {
    presented: count(0),
    partial: count(1),
    dropped: count(2),
    idle: count(3),
    late: ticks.filter((t) => t.late).length,
    latencyMs: latencies.length
      ? { p50: quantile(latencies, 0.5), p95: quantile(latencies, 0.95) }
      : null,
  }
}

/**
 * Sums up a phase's trace. `window` is the pid of the window's renderer,
 * `pages` those of the browser's pages, `gpu` the GPU process's.
 */
export function summarise(
  events: TraceEvent[],
  { window, pages, gpu }: { window: number; pages: number[]; gpu?: number }
): Summary {
  // Chromium hands each thread's events over in chunks, not in time's
  // order, and cc names its reporters by ids it uses again.
  events = [...events].sort((a, b) => a.ts - b.ts)
  // Only what happened between the spec's two marks. A trace without
  // both measured something else: it fails.
  const said = (event: TraceEvent, message: string) =>
    event.name === "TimeStamp" &&
    event.pid === window &&
    (event.args?.data as { message?: string } | undefined)?.message === message
  const from = events.find((e) => said(e, MARKS.start))?.ts
  const to = events.findLast((e) => said(e, MARKS.end))?.ts
  if (from === undefined || to === undefined)
    throw new Error(
      `motion-trace.ts: the trace has no "${from === undefined ? MARKS.start : MARKS.end}"`
    )
  events = events.filter(
    (e) => e.ph === "M" || (e.ts + (e.dur ?? 0) >= from && e.ts <= to)
  )
  const seconds = (to - from) / 1e6
  const main = threads(events, window, "CrRendererMain")
  const ticks = ticksOf(events, new Set([window]))
  const pageTicks = ticksOf(events, new Set(pages))

  // A tick's span runs to the next tick, or two ticks' time at most where
  // the compositor went quiet after it.
  const gaps = sortedOf(ticks.slice(1).map((t, i) => t.ts - ticks[i].ts))
  const period = gaps.length
    ? Math.min(gaps[Math.floor(gaps.length / 2)], 50_000)
    : 16_667
  const spans = ticks.map((tick, i) => ({
    tick,
    from: tick.ts,
    to: Math.min(ticks[i + 1]?.ts ?? Infinity, tick.ts + 2 * period),
    layouts: 0,
    styles: 0,
    mainUs: 0,
  }))
  /** The first span that ends after `ts`. */
  const spanAfter = (ts: number) => {
    let low = 0
    let high = spans.length
    while (low < high) {
      const middle = (low + high) >> 1
      if (spans[middle].to <= ts) low = middle + 1
      else high = middle
    }
    return low
  }

  const tasks: number[] = []
  let paints = 0
  let shown = 0
  const draws: number[] = []
  let gpuUs = 0
  const gpuMain =
    gpu === undefined ? new Set<number>() : threads(events, gpu, "CrGpuMain")
  const viz =
    gpu === undefined
      ? new Set<number>()
      : threads(events, gpu, "VizCompositorThread")
  for (const event of events) {
    if (event.pid === window && main.has(event.tid) && event.ph === "X") {
      const span = spans[spanAfter(event.ts)]
      const began = span && span.from <= event.ts ? span : undefined
      if (event.name === "ThreadControllerImpl::RunTask") {
        tasks.push((event.dur ?? 0) / 1000)
        if (began) began.mainUs += event.dur ?? 0
      } else if (event.name === "Paint") paints += 1
      else if (began && event.name === "Layout") began.layouts += 1
      else if (began && event.name === "UpdateLayoutTree") began.styles += 1
    } else if (event.pid === gpu && viz.has(event.tid)) {
      if (event.name === "Display::FrameDisplayed") shown += 1
      else if (event.name === "DirectRenderer::DrawFrame" && event.dur)
        draws.push(event.dur / 1000)
    } else if (
      event.pid === gpu &&
      gpuMain.has(event.tid) &&
      event.name === "ThreadControllerImpl::RunTask"
    )
      gpuUs += event.dur ?? 0
  }

  const moving = spans.filter((s) => s.tick.state < 3)
  const mainMs = sortedOf(moving.map((s) => s.mainUs / 1000))
  const per = (sum: number) =>
    moving.length ? round(sum / moving.length, 2) : null
  const drawn = sortedOf(draws)
  return {
    frames: framesOf(ticks),
    pages: pageTicks.length ? framesOf(pageTicks) : null,
    moving: {
      frames: moving.length,
      layouts: per(moving.reduce((sum, s) => sum + s.layouts, 0)),
      styles: per(moving.reduce((sum, s) => sum + s.styles, 0)),
      mainMs: mainMs.length
        ? {
            p50: quantile(mainMs, 0.5),
            p95: quantile(mainMs, 0.95),
            max: quantile(mainMs, 1),
          }
        : null,
    },
    tasks: {
      over8ms: tasks.filter((t) => t > 8.3).length,
      over16ms: tasks.filter((t) => t > 16.7).length,
      longestMs: round(Math.max(0, ...tasks), 1),
    },
    viz: viz.size
      ? {
          perSecond: Math.round(shown / seconds),
          drawMs: drawn.length
            ? { p50: quantile(drawn, 0.5), p95: quantile(drawn, 0.95) }
            : null,
        }
      : null,
    gpu: gpuMain.size
      ? { msPerSecond: Math.round(gpuUs / 1000 / seconds) }
      : null,
    paints: { perSecond: round(paints / seconds, 1) },
  }
}

/** The CSS animations marks.css plays for `looks`, a working Mark's by
 * what its Agent does, by their names: each loop's, and for eyes that
 * look about, the body's that moves back. */
export function animationsOf(looks: readonly Shown[]): string[] {
  const names = looks.flatMap((look) =>
    (LOOPED[look] ?? []).flatMap((name) =>
      LOOPS[name].part === "look"
        ? [`mark-${name}`, `mark-${name}-back`]
        : [`mark-${name}`]
    )
  )
  return [...new Set(names)].sort()
}
