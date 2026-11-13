/**
 * The client's copy of the arrangement does what the engine does (ADR
 * 0088, decision 11): every golden trace the engine's tests record
 * (`platform/workspaces/engine/tests/traces.rs`) replays through `apply`,
 * step by step. Each step starts from the arrangement the engine had
 * before it, so one step the copy gets wrong fails alone.
 *
 * The window's own reading of an arrangement is held on every one too: it
 * draws it and keeps it again as it was (`resolve`, `keptOf`).
 */
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { Code } from "@banda/contract"
import type { Workspace } from "@banda/contract/workspaces"
import { describe, expect, test } from "vitest"
import { keptOf, NO_VIEW, resolve } from "./arrange"
import { apply, type Command, type Facts, METHODS } from "./arrangement"

type Step = {
  method: Command["method"]
  seed: string
  params: unknown
  /** What the engine placed a Pane by; left out, its facts with no Flow
   * and no kind known. */
  facts?: Facts
  answer?: { pane: string; new: boolean } | Record<string, never>
  refused?: Code
  after: Workspace[]
}

type Trace = { about: string; start: Workspace[]; steps: Step[] }

const folder = join(
  import.meta.dirname,
  "../../../../platform/workspaces/traces"
)

const traces: [string, Trace][] = readdirSync(folder)
  .filter((name) => name.endsWith(".json"))
  .sort()
  .map((name) => [
    name,
    JSON.parse(readFileSync(join(folder, name), "utf8")) as Trace,
  ])

/**
 * `value` as JSON text with the keys of each object in order, a Pane's
 * args too: the copy and the engine are compared by all they write, so a
 * key one has and the other lacks, or a none the engine never writes, sets
 * them apart.
 */
function text(value: unknown): string {
  return JSON.stringify(ordered(value))
}

/** `value` with the keys of each object in order. */
function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered)
  if (typeof value !== "object" || value === null) return value
  const object = value as Record<string, unknown>
  return Object.fromEntries(
    Object.keys(object)
      .sort()
      .map((key) => [key, ordered(object[key])])
  )
}

test("the traces place a Pane in the Flow free and in the row", () => {
  const flows = traces.flatMap(([, trace]) =>
    trace.steps.flatMap((step) => step.facts?.flow ?? [])
  )
  expect(new Set(flows)).toEqual(new Set(["free", "row"]))
})

test("there are traces to replay, of every command the copy runs", () => {
  expect(traces.length).toBeGreaterThan(0)
  const traced = new Set(
    traces.flatMap(([, trace]) => trace.steps.map((step) => step.method))
  )
  expect(METHODS.filter((method) => !traced.has(method))).toEqual([])
})

describe.each(traces)("%s", (_, trace) => {
  const steps = trace.steps.map(
    (step, i) =>
      [
        `${i + 1} ${step.method}`,
        step,
        i === 0 ? trace.start : trace.steps[i - 1].after,
      ] as const
  )

  test.each(steps)("%s", (_, step, before) => {
    const given = JSON.stringify(before)
    const command = { method: step.method, params: step.params } as Command
    const applied = apply(before, command, step.seed, step.facts)
    // Pure, refused or not.
    expect(JSON.stringify(before)).toBe(given)
    if (step.refused !== undefined) {
      expect("refused" in applied && applied.refused).toBe(step.refused)
      return
    }
    if ("refused" in applied) {
      throw new Error(`Refused, ${applied.refused}: ${applied.message}`)
    }
    expect(text(applied.answer)).toBe(text(step.answer))
    expect(text(applied.list)).toBe(text(step.after))
  })

  test("the window draws each arrangement and keeps it again as it was", () => {
    for (const list of [trace.start, ...trace.steps.map((s) => s.after)]) {
      expect(text(keptOf(resolve(list, NO_VIEW)))).toBe(text(list))
    }
  })
})
