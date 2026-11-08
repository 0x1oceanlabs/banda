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
import type { Code, JsonValue } from "@banda/contract"
import type { Workspace } from "@banda/contract/workspaces"
import { describe, expect, test } from "vitest"
import { keptOf, NO_VIEW, resolve } from "./arrange"
import { apply, type Command, METHODS } from "./arrangement"

type Step = {
  method: Command["method"]
  seed: string
  params: unknown
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
 * An arrangement as JSON text to compare, by its shape: a field the
 * contract leaves out may be missing or none on either side, and the keys
 * of a Pane's args are put in order, its nulls kept.
 */
function normalized(list: readonly Workspace[]): string {
  return JSON.stringify(
    list.map((workspace) =>
      present({
        id: workspace.id,
        columns: workspace.columns.map((column) =>
          present({
            id: column.id,
            panes: column.panes.map((pane) =>
              present({
                id: pane.id,
                project: pane.project,
                kind: pane.kind,
                args: ordered(pane.args),
                by: pane.by,
                height: pane.height,
              })
            ),
            width: column.width,
            full: column.full,
            display: column.display,
            group: column.group,
          })
        ),
        filled: workspace.filled,
        project: workspace.project,
      })
    )
  )
}

/** `fields` but those that are none. */
function present(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value != null)
  )
}

/** `value` with the keys of each object in order. */
function ordered(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(ordered)
  if (typeof value !== "object" || value === null) return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, ordered(value[key])])
  )
}

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
    const applied = apply(before, command, step.seed)
    // Pure, refused or not.
    expect(JSON.stringify(before)).toBe(given)
    if (step.refused !== undefined) {
      expect("refused" in applied && applied.refused).toBe(step.refused)
      return
    }
    if ("refused" in applied) {
      throw new Error(`Refused, ${applied.refused}: ${applied.message}`)
    }
    expect(applied.answer).toEqual(step.answer)
    expect(normalized(applied.list)).toBe(normalized(step.after))
  })

  test("the window draws each arrangement and keeps it again as it was", () => {
    for (const list of [trace.start, ...trace.steps.map((s) => s.after)]) {
      expect(normalized(keptOf(resolve(list, NO_VIEW)))).toBe(normalized(list))
    }
  })
})
