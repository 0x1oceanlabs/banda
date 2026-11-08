/**
 * What motion.spec.ts writes, and how it reads motion-budget.json (ADR 0088,
 * decision 1).
 *
 * Each phase's numbers go to test-results/motion.json, keyed by the
 * screen's scale, and as tables to test-results/motion.md, the test's
 * output and the CI job's summary.
 *
 * motion-budget.json names the measures the budgets hold, each as
 * `phase.path` into a phase's numbers, with its gate (hard for counts, soft
 * for timings), its budget, and the numbers recorded for each scale. In
 * record mode, a measure worse than its recorded number only warns: 10%
 * worse for a count, 20% for a timing, or the `tolerance` the measure
 * names, for a count that follows the machine's speed (the frames an
 * animation gets, the lines a shell prints); and `SLACK` more. A measure
 * with no number this run is not read. A measure that `blocks`, a count
 * the same on every run as React's drawings for a key, fails the test
 * over its budget, in record mode too. `MOTION_RECORD=1` writes the
 * recorded numbers, the median of the runs this test run made (with
 * `--repeat-each=3`, of three), over those recorded before. A PR may lower
 * one, and raises one only by saying why.
 */
import {
  existsSync,
  appendFileSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"
import { expect, test } from "@playwright/test"
import type { Reading, TerminalCount } from "./motion-probe"
import {
  quantile,
  round,
  sortedOf,
  type Frames,
  type Summary,
} from "./motion-trace"

/** Chrome's own counters the spec reads (`Performance.getMetrics`). */
export const METRICS = [
  "LayoutCount",
  "RecalcStyleCount",
  "LayoutDuration",
  "RecalcStyleDuration",
  "ScriptDuration",
  "TaskDuration",
] as const

/** Chrome's counters, a second: counts, and durations in ms. */
type PerSecond = Record<(typeof METRICS)[number], number>

/** Chrome's counters a second between two readings of them, by the time
 * each reading names. */
export function perSecondOf(
  before: Record<string, number>,
  after: Record<string, number>
): PerSecond {
  const seconds = after.Timestamp - before.Timestamp
  return Object.fromEntries(
    METRICS.map((metric) => {
      const change = after[metric] - before[metric]
      const ms = metric.endsWith("Duration")
      return [metric, Math.round((ms ? change * 1000 : change) / seconds)]
    })
  ) as PerSecond
}

/** A phase as the spec measured it. */
export type Phase = {
  /** How long its acts took. */
  seconds: number
  /** The keys it pressed; none in a still one. */
  steps: number
  perSecond: PerSecond
  counted: Reading
  trace: Summary | null
}

type Gate = "hard" | "soft"

type Budget = {
  mode: "record"
  measures: {
    measure: string
    gate: Gate
    budget: number
    tolerance?: number
    note?: string
    /** Over its budget, or with no number, it fails the test. */
    blocks?: boolean
  }[]
  /** By scale, then by measure. */
  recorded: Record<string, Record<string, number>>
}

const BUDGET = join(import.meta.dirname, "motion-budget.json")

const TOLERANCE: Record<Gate, number> = { hard: 0.1, soft: 0.2 }

/** What a measure may grow by besides its tolerance: a ratio a frame
 * recorded at 0.03 moves by a few hundredths from run to run, and one
 * recorded at 0 has no tolerance of its own. */
const SLACK = 0.05

/** A phase's numbers, as motion.json has them. */
function numbersOf({ seconds, steps, perSecond, counted, trace }: Phase) {
  const rate = (count: number) => round(count / (counted.ms / 1000), 1)
  const sum = (pick: (t: TerminalCount) => number) =>
    counted.terminals.reduce((total, t) => total + pick(t), 0)
  const fits = sum((t) => t.fits)
  const intervals = sortedOf(counted.intervals)
  const trail = counted.trail
  return {
    seconds: round(seconds, 1),
    steps,
    perSecond,
    /** The probe's own reads of the page, in ms a second. */
    probeMs: rate(counted.ownMs),
    /** The page's own ticks, a second: its rAF callbacks, the ticks they
     * ran in, and the reads of layout inside them. */
    ticks: {
      callbacksPerSecond: rate(counted.callbacks),
      perSecond: rate(counted.ticks),
      readsPerSecond: rate(counted.reads),
    },
    /** The terminals' draws a second, on screen and off. */
    draws: {
      shown: rate(sum((t) => t.draws[0])),
      hidden: rate(sum((t) => t.draws[1])),
    },
    /** The terminals' fits in the phase. */
    fits,
    /** React's drawings of the Tiles, Strips, widgets and sidebar in the
     * phase, and of each for each key pressed, where it pressed some. */
    renders: {
      ...counted.renders,
      perStep: steps
        ? (Object.fromEntries(
            Object.entries(counted.renders).map(([part, count]) => [
              part,
              round(count / steps, 2),
            ])
          ) as Reading["renders"])
        : null,
    },
    terminals: counted.terminals.map((t) => ({
      name: t.name,
      drawsPerSecond: { shown: rate(t.draws[0]), hidden: rate(t.draws[1]) },
      callsPerSecond: { shown: rate(t.calls[0]), hidden: rate(t.calls[1]) },
      fits: t.fits,
    })),
    /** Each moving frame's work; none without a trace. */
    moving: trace && {
      ...trace.moving,
      fits: trace.moving.frames ? round(fits / trace.moving.frames, 2) : null,
    },
    tasks: {
      /** Chromium's long tasks, over 50 ms. */
      long: counted.longTasks.count,
      ...trace?.tasks,
    },
    longFrames: counted.longFrames && {
      count: counted.longFrames.count,
      worstMs: round(counted.longFrames.worstMs),
      blockingMs: round(counted.longFrames.blockingMs),
    },
    slowKeys: counted.slowKeys && {
      count: counted.slowKeys.count,
      worstMs: round(counted.slowKeys.worstMs),
    },
    /** The time between ticks, as the page saw them; none where the probe
     * did not follow them. */
    intervals: intervals.length
      ? {
          count: intervals.length,
          p50: quantile(intervals, 0.5),
          p95: quantile(intervals, 0.95),
          max: quantile(intervals, 1),
          over25ms: intervals.filter((i) => i > 25).length,
        }
      : null,
    /** The reads that found the browser's slot showing; those in which its
     * page stood elsewhere or was put away, so it did not show in it; and of
     * them, those in which it was put away. */
    page: {
      seen: trail.length,
      trailing: trail.filter((t) => t > 1 || t < 0).length,
      trailMaxPx: round(Math.max(0, ...trail)),
      hiddenWhileShown: trail.filter((t) => t < 0).length,
    },
    frames: trace?.frames ?? null,
    pageFrames: trace?.pages ?? null,
    viz: trace?.viz ?? null,
    gpu: trace?.gpu ?? null,
  }
}

type Numbers = ReturnType<typeof numbersOf>

/** The number `measure` names, `phase.path`; none if the phase has none. */
function valueOf(
  numbers: Record<string, Numbers>,
  measure: string
): number | undefined {
  let found: unknown = numbers
  for (const key of measure.split("."))
    found = (found as Record<string, unknown> | null | undefined)?.[key]
  return typeof found === "number" ? found : undefined
}

const median = (values: number[]) => {
  const sorted = sortedOf(values)
  const middle = sorted.length >> 1
  return sorted.length % 2
    ? sorted[middle]
    : round((sorted[middle - 1] + sorted[middle]) / 2, 2)
}

const cell = (value: number | string | null | undefined) =>
  value === null || value === undefined ? "–" : String(value)
const pair = (a?: number | null, b?: number | null) =>
  a === null || a === undefined ? "–" : `${a} · ${cell(b)}`
const framesCell = (f: Frames | null) =>
  f ? `${f.presented} · ${f.partial} · ${f.dropped} · ${f.late}` : "–"

function table(head: string[], rows: (string | number)[][]): string {
  return [
    `| ${head.join(" | ")} |`,
    `|${head.map((_, i) => (i ? " ---: " : " --- ")).join("|")}|`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n")
}

function summary(
  scale: number,
  versions: { electron: string; chrome: string },
  numbers: Record<string, Numbers>,
  mode: string,
  budgets: string[][]
): string {
  const rows = Object.entries(numbers)
  return [
    `## Motion at ${scale}×`,
    "",
    `Electron ${versions.electron}, Chromium ${versions.chrome}` +
      (process.env.BANDA_E2E_SHOW ? ". " : ", headless. ") +
      "A second, unless named. A moving frame is a tick whose picture " +
      "changed (motion-trace.ts). The timings are taken with the probe " +
      "counting in the page and the trace running, both of which cost " +
      "time; the probe's own reads are in Probe ms.",
    "",
    table(
      [
        "Phase",
        "s",
        "Layouts",
        "Styles",
        "Script ms",
        "Task ms",
        "rAF callbacks",
        "Ticks",
        "Reads in ticks",
        "Draws shown · hidden",
        "Fits",
        "Page trailing",
        "Probe ms",
      ],
      rows.map(([name, n]) => [
        name,
        n.seconds,
        n.perSecond.LayoutCount,
        n.perSecond.RecalcStyleCount,
        n.perSecond.ScriptDuration,
        n.perSecond.TaskDuration,
        n.ticks.callbacksPerSecond,
        n.ticks.perSecond,
        n.ticks.readsPerSecond,
        pair(n.draws.shown, n.draws.hidden),
        n.fits,
        `${n.page.trailing} of ${n.page.seen}`,
        n.probeMs,
      ])
    ),
    "",
    table(
      [
        "Phase",
        "Moving frames",
        "Layouts each",
        "Styles each",
        "Fits each",
        "Main ms each p50 · p95",
        "Tasks > 8.3 ms",
        "Longest task ms",
        "Long frames",
        "Slow keys",
        "Presented · partial · dropped · late",
        "To screen ms p50 · p95",
        "viz frames",
        "GPU ms",
      ],
      rows.map(([name, n]) => [
        name,
        cell(n.moving?.frames),
        cell(n.moving?.layouts),
        cell(n.moving?.styles),
        cell(n.moving?.fits),
        pair(n.moving?.mainMs?.p50, n.moving?.mainMs?.p95),
        cell(n.tasks.over8ms),
        cell(n.tasks.longestMs),
        cell(n.longFrames?.count),
        cell(n.slowKeys?.count),
        framesCell(n.frames),
        pair(n.frames?.latencyMs?.p50, n.frames?.latencyMs?.p95),
        cell(n.viz?.perSecond),
        cell(n.gpu?.msPerSecond),
      ])
    ),
    "",
    "React's drawings in the phase: of the Tiles in the Strips, the " +
      "Strips, the bar's widgets but the workspaces' and the sidebar; and " +
      "for each key pressed.",
    "",
    table(
      [
        "Phase",
        "Keys",
        "Tiles",
        "Strips",
        "Widgets",
        "Sidebar",
        "Tiles a key",
        "Widgets a key",
      ],
      rows.map(([name, n]) => [
        name,
        n.steps || "–",
        n.renders.tiles,
        n.renders.strips,
        n.renders.widgets,
        n.renders.sidebar,
        cell(n.renders.perStep?.tiles),
        cell(n.renders.perStep?.widgets),
      ])
    ),
    "",
    "Each terminal's draws a second, on screen · off it, and the browser " +
      "page's own frames.",
    "",
    table(
      [
        "Phase",
        ...(rows[0]?.[1].terminals.map((t) => t.name) ?? []),
        "Page presented · partial · dropped · late",
      ],
      rows.map(([name, n]) => [
        name,
        ...n.terminals.map((t) =>
          pair(t.drawsPerSecond.shown, t.drawsPerSecond.hidden)
        ),
        framesCell(n.pageFrames),
      ])
    ),
    "",
    `Budgets, in ${mode} mode: a measure worse than recorded only warns.`,
    "",
    table(["Measure", "Gate", "Budget", "Recorded", "Now", "Note"], budgets),
    "",
  ].join("\n")
}

/**
 * Writes the phases measured on a screen of `scale`, reads them against
 * the budgets, and records them when asked.
 */
export function report(
  scale: number,
  versions: { electron: string; chrome: string },
  phases: Record<string, Phase>
): void {
  const info = test.info()
  const out = info.project.outputDir
  const key = String(scale)
  const numbers = Object.fromEntries(
    Object.entries(phases).map(([name, phase]) => [name, numbersOf(phase)])
  )

  const budget = JSON.parse(readFileSync(BUDGET, "utf8")) as Budget
  if (budget.mode !== "record")
    throw new Error(`motion-budget.json: no "${budget.mode}" mode yet`)
  const recorded = budget.recorded[key] ?? {}
  const warnings: string[] = []
  const budgets = budget.measures.map(
    ({ measure, gate, budget: most, tolerance, note }) => {
      const now = valueOf(numbers, measure)
      const was = recorded[measure]
      const worse =
        now !== undefined &&
        was !== undefined &&
        now > was * (1 + (tolerance ?? TOLERANCE[gate])) + SLACK
      if (worse)
        warnings.push(
          `${measure} at ${scale}×: ${now}, recorded ${was} (${gate})`
        )
      return [
        `\`${measure}\``,
        gate,
        String(most),
        cell(was),
        cell(now),
        worse ? "**worse**" : (note ?? ""),
      ]
    }
  )
  const text = summary(scale, versions, numbers, budget.mode, budgets)

  // Every scale this run measured, once each however often its test ran.
  type Measured = { versions: object; summary: string; phases: object }
  const json = join(out, "motion.json")
  const all: Record<string, Measured> = existsSync(json)
    ? JSON.parse(readFileSync(json, "utf8"))
    : {}
  all[key] = { versions, summary: text, phases: numbers }
  writeFileSync(json, `${JSON.stringify(all, null, 2)}\n`)
  writeFileSync(
    join(out, "motion.md"),
    Object.values(all)
      .map((measured) => measured.summary)
      .join("\n")
  )
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`)
  console.log(text)

  for (const warning of warnings) {
    console.warn(`motion: worse than recorded: ${warning}`)
    info.annotations.push({ type: "warning", description: warning })
  }

  if (process.env.MOTION_RECORD) {
    // The runs of this test run, kept beside motion.json.
    const file = join(out, "motion-runs.json")
    const runs: Record<string, Record<string, number[]>> = existsSync(file)
      ? JSON.parse(readFileSync(file, "utf8"))
      : {}
    const mine = (runs[key] ??= {})
    for (const { measure } of budget.measures) {
      const now = valueOf(numbers, measure)
      if (now !== undefined) (mine[measure] ??= []).push(now)
    }
    writeFileSync(file, `${JSON.stringify(runs, null, 2)}\n`)
    // What this run measured, over what was recorded before: a run
    // without the trace keeps the trace's numbers. A measure no longer
    // listed leaves.
    const now = { ...recorded }
    for (const [measure, values] of Object.entries(mine))
      now[measure] = median(values)
    budget.recorded[key] = Object.fromEntries(
      budget.measures.flatMap(({ measure }) =>
        now[measure] === undefined ? [] : [[measure, now[measure]]]
      )
    )
    writeFileSync(BUDGET, `${JSON.stringify(budget, null, 2)}\n`)
  }

  const over = budget.measures.flatMap(({ measure, budget: most, blocks }) => {
    const now = valueOf(numbers, measure)
    return blocks && !(now !== undefined && now <= most)
      ? [`${measure} at ${scale}×: ${now ?? "none"}, budget ${most}`]
      : []
  })
  expect(over, "measures over a budget that blocks").toEqual([])
}
