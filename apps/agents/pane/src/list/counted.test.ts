import type { CountedAs, ListedThread } from "@banda/contract/agents"
import { isAway, standOf, takes } from "@banda/ui/status"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { expect, test } from "vitest"
import { listedOf } from "./rows"

/** `apps/agents/counted.json`: what each Thread counts as in the bar at
 * `now`, null when the bar leaves it out. The engine's copy of the rule,
 * `counted()` in counts.rs for `banda status`, reads the same cases. */
const { now, cases } = JSON.parse(
  readFileSync(join(import.meta.dirname, "../../../counted.json"), "utf8")
) as {
  now: number
  cases: { case: string; thread: ListedThread; counted: CountedAs | null }[]
}

/** A count the bar may show (`Count` in the sidebar's settings). */
type Count = Parameters<typeof takes>[0]

/** Every count the bar may show, in one order. */
const COUNTS = Object.keys({
  asking: true,
  done: true,
  waiting: true,
  working: true,
} satisfies Record<Count, true>) as Count[]

/** The counts `banda status` adds a Thread to by what it counts as
 * (`AgentCounts::of` in counts.rs): what fails is in `asking`, and all
 * but work in `waiting`. In `COUNTS`' order. */
const ADDS: Record<CountedAs, Count[]> = {
  working: ["working"],
  asking: ["asking", "waiting"],
  failed: ["asking", "waiting"],
  done: ["done", "waiting"],
}

test("the shared cases are there", () => {
  expect(cases.length).toBeGreaterThanOrEqual(10)
})

// The Thread as the sidebar lists it (`listedOf`: `markOf` and the
// archive), where it stands and which counts take it (`status.ts`), as the
// bar's tally reads them: what is put away no count takes.
test.each(cases)(
  "the bar counts a Thread as banda status does: $case",
  ({ case: name, thread, counted }) => {
    const listed = listedOf(thread, thread.harness)
    const stand = standOf(listed, now)
    const bar = isAway(stand)
      ? []
      : COUNTS.filter((count) => takes(count, stand, listed.mark))
    expect(
      bar,
      `"${name}": the window's bar and \`banda status\` (counts.rs) count it in different counts`
    ).toEqual(counted ? ADDS[counted] : [])
  }
)
