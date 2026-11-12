import type { Crew, CrewAgent, SubagentState } from "@banda/contract/agents"
import { expect, test } from "vitest"
import {
  afterCrew,
  currentPhase,
  dotTip,
  duringCrew,
  endedNote,
  endedWords,
  footOf,
  footWords,
  goOnMessage,
  MOST_DOTS,
  phasesLine,
  phaseWords,
  quietOf,
  stripOf,
} from "./crew"

const MINUTE = 60_000

/** Agent `index` of phase `phase`, started at `started` unless queued. */
const agent = (
  phase: number,
  index: number,
  state: SubagentState,
  started?: number
): CrewAgent => ({
  index,
  label: `route-${phase}.${index}.ts`,
  phase,
  state,
  attempt: 1,
  ...(state === "queued" ? {} : { started: started ?? phase * 100 + index }),
})

const crew = (agents: CrewAgent[], more: Partial<Crew> = {}): Crew => ({
  id: "w",
  turn: "u",
  title: "audit-routes",
  description: "Find every route that skips the access check",
  phases: [
    { index: 1, title: "Scan" },
    { index: 2, title: "Fix" },
    { index: 3, title: "Verify" },
  ],
  agents,
  state: "working",
  started: 0,
  ...more,
})

/** Scan done, Fix under way with one failed, Verify not reached. */
const running = crew([
  agent(1, 1, "done"),
  agent(1, 2, "done"),
  agent(2, 1, "done"),
  agent(2, 2, "running"),
  agent(2, 3, "failed"),
  agent(2, 4, "running"),
])

test("the strip: past phases done with a ✓, the current one counted, future ones faint", () => {
  const strip = stripOf(running)
  expect(
    strip.map(({ title, when, done, count }) => [title, when, done, count])
  ).toEqual([
    ["Scan", "past", true, undefined],
    ["Fix", "current", false, "1/4"],
    ["Verify", "future", false, undefined],
  ])
  expect(strip[1].dots.map((dot) => dot.look)).toEqual([
    "done",
    "working",
    "failed",
    "working",
  ])
  expect(strip[1].dots[2].tip).toBe("route-2.3.ts · Failed")
})

test("a phase past 24 agents becomes a bar of shares with its count", () => {
  const fix = [
    ...Array.from({ length: 12 }, (_, at) => agent(2, at + 1, "done")),
    agent(2, 13, "failed"),
    agent(2, 14, "asks"),
    ...Array.from({ length: 5 }, (_, at) => agent(2, at + 15, "running")),
    ...Array.from({ length: 8 }, (_, at) => agent(2, at + 20, "queued")),
  ]
  expect(fix.length).toBeGreaterThan(MOST_DOTS)
  const [, big] = stripOf(crew([agent(1, 1, "done"), ...fix]))
  expect(big.dots).toEqual([])
  expect(big.bar).toEqual([
    { look: "done", n: 12 },
    { look: "failed", n: 1 },
    { look: "asks", n: 1 },
    { look: "working", n: 5 },
    { look: "queued", n: 8 },
  ])
  expect(big.count).toBe("12/27")
  expect(big.tip).toBe(
    "Fix · 27 agents · 5 working · 1 asks · 12 done · 1 failed · 8 waiting"
  )
  // 24 still are dots.
  const [, dots] = stripOf(crew(fix.slice(0, MOST_DOTS)))
  expect(dots.dots).toHaveLength(MOST_DOTS)
  expect(dots.bar).toBeUndefined()
})

test("the current phase is the one whose agent started last; before any, the first", () => {
  expect(currentPhase(running)).toBe(2)
  expect(currentPhase(crew([]))).toBe(1)
  // A pipeline's agent back in Scan after Fix began.
  expect(
    currentPhase(crew([agent(2, 1, "running", 5), agent(1, 3, "running", 9)]))
  ).toBe(1)
  // Ended, none is: every phase reached is past.
  const done = crew(running.agents, { state: "done", ended: 14 * MINUTE })
  expect(currentPhase(done)).toBeUndefined()
  expect(stripOf(done).map((phase) => phase.when)).toEqual([
    "past",
    "past",
    "future",
  ])
})

test("the foot: only the failed in red, the asking in the attention's colour", () => {
  const foot = footOf(
    crew([...running.agents, agent(3, 1, "asks"), agent(3, 2, "queued")]),
    4 * MINUTE
  )
  expect(footWords(foot)).toBe(
    "8 agents · 2 working · 1 asks · 3 done · 1 failed · 1 waiting · 4m"
  )
  expect(foot.counts.flatMap((count) => (count.tone ? [count] : []))).toEqual([
    { words: "1 asks", tone: "asks" },
    { words: "1 failed", tone: "failed" },
  ])
  expect(foot.goOn).toBe(false)
})

test("finished and Lost say so in their own words; only Lost offers to go on", () => {
  const ended = (more: Partial<Crew>) =>
    crew(running.agents, { ended: 14 * MINUTE, ...more })
  expect(footWords(footOf(ended({ state: "done" })))).toBe(
    "6 agents · 3 phases · 1 failed · 14m 00s"
  )
  const lost = footOf(
    ended({ state: "lost", why: "Stopped when Banda restarted." })
  )
  expect(footWords(lost)).toBe("Stopped when Banda restarted · 3 of 6 done")
  expect(lost.goOn).toBe(true)
  const failed = ended({
    state: "failed",
    why: 'Dynamic workflow "audit" failed: Error: it threw\n    at x.js:5',
  })
  expect(footWords(footOf(failed))).toBe(
    "6 agents · Failed · 1 agent failed · 14m 00s"
  )
  expect(quietOf(failed)).toBe(
    'Dynamic workflow "audit" failed: Error: it threw'
  )
  expect(quietOf(ended({ state: "done", log: "phase 3 done" }))).toBe(
    "phase 3 done"
  )
  expect(quietOf(running)).toBeUndefined()
})

test("the live line: during the turn after its clock, and after it with who goes on", () => {
  expect(phaseWords(running)).toBe("Fix 1/4")
  expect(duringCrew([running], "u")).toBe("Crew audit-routes · Fix 1/4")
  expect(duringCrew([running], "other")).toBeUndefined()
  expect(afterCrew([running], "Claude")).toEqual({
    words: "Crew audit-routes is at work · Fix 1/4",
    then: "Claude goes on when it ends",
  })
  expect(afterCrew([running, { ...running, id: "w2" }], "Claude")).toEqual({
    words: "2 Crews at work",
    then: "Claude goes on when they end",
  })
  expect(afterCrew([{ ...running, state: "done" }], "Claude")).toBeUndefined()
})

test("its end after the turn, and what a notification says of it", () => {
  const done = crew(running.agents, {
    state: "done",
    ended: 14 * MINUTE,
    went_on: "u2",
  })
  expect(endedWords(done, "Claude")).toEqual({
    words: "Crew audit-routes finished · 14m 00s",
    then: "Claude went on by itself",
  })
  expect(endedWords({ ...done, went_on: undefined }, "Claude")).toEqual({
    words: "Crew audit-routes finished · 14m 00s",
  })
  expect(endedNote("audit-routes", "done", 2)).toBe(
    "Crew audit-routes finished · 2 failed"
  )
  expect(endedNote("audit-routes", "failed", 0)).toBe(
    "Crew audit-routes failed"
  )
})

test("Ask Claude to go on, and the start Question's phases", () => {
  expect(goOnMessage(crew(running.agents, { state: "lost" }))).toBe(
    "The Crew audit-routes stopped before it ended, with 3 of its 6 agents done. Please go on from where it stopped, and keep what the last run did."
  )
  expect(phasesLine(running.phases)).toBe("1 Scan · 2 Fix · 3 Verify")
  expect(dotTip({ ...agent(1, 2, "queued"), label: " " })).toBe(
    "Agent 2 · Queued"
  )
})
