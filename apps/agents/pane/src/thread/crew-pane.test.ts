import type { Crew, CrewAgent, SubagentState } from "@banda/contract/agents"
import { expect, test } from "vitest"
import {
  agentOf,
  bandsOf,
  clockOf,
  columnsOf,
  detailOf,
  endingOf,
  keeps,
  resultOf,
  rowOf,
  summaryOf,
  timelineOf,
  tokenWords,
  toOpen,
} from "./crew-pane"

const MINUTE = 60_000

/** Agent `index` of phase `phase`; started at `started` unless queued. */
const agent = (
  phase: number,
  index: number,
  state: SubagentState,
  more: Partial<CrewAgent> = {}
): CrewAgent => ({
  index,
  label: `route-${phase}.${index}.ts`,
  phase,
  state,
  attempt: 1,
  ...(state !== "queued" && { started: phase * MINUTE }),
  ...more,
})

const crew = (agents: CrewAgent[], more: Partial<Crew> = {}): Crew => ({
  id: "w",
  turn: "u",
  title: "audit-routes",
  phases: [
    { index: 1, title: "Scan", detail: "read each route" },
    { index: 2, title: "Fix", detail: "one agent per route" },
    { index: 3, title: "Verify", detail: "run the tests" },
  ],
  agents,
  state: "working",
  started: 0,
  ...more,
})

/** Scan done, Fix under way: one asks, one failed, one queued. */
const at_work = crew(
  [
    agent(1, 2, "done", { took: 50_000, model: "Haiku", result: "6 routes" }),
    agent(1, 1, "done", { took: 70_000, model: "Haiku" }),
    agent(2, 1, "done", {
      took: 30_000,
      last: "Edited invoices.ts",
      result: '{"fixed":true}',
    }),
    agent(2, 2, "running", { last: "Editing share.ts", attempt: 2 }),
    agent(2, 3, "failed", { why: "Pairing runs first\nstack", took: 9000 }),
    agent(2, 4, "asks"),
    agent(2, 5, "queued"),
  ],
  { tokens: 1_400_000 }
)

test("the summary counts the agents, Asks and the failed in their colours, and its tokens short", () => {
  expect(summaryOf(at_work)).toEqual({
    counts: [
      { words: "7 agents" },
      { words: "1 working" },
      { words: "1 asks", tone: "asks" },
      { words: "3 done" },
      { words: "1 failed", tone: "failed" },
      { words: "1 waiting" },
    ],
    tokens: "1.4M tokens",
  })
  // Once ended, as the card's foot says it.
  const done = { ...at_work, state: "done" as const, ended: 5 * MINUTE }
  expect(summaryOf(done).counts.map((count) => count.words)).toEqual([
    "7 agents",
    "3 phases",
    "1 failed",
  ])
  expect([812, 48_210, 999_949, 1_000_000].map(tokenWords)).toEqual([
    "812",
    "48.2k",
    "999.9k",
    "1M",
  ])
})

test("one clock: it ticks while the Crew works, stops at its end, and a Lost one has none", () => {
  expect(clockOf(at_work, 9 * MINUTE + 41_000)).toBe("9m 41s")
  expect(clockOf({ ...at_work, state: "done", ended: 14 * MINUTE }, 1e9)).toBe(
    "14m 00s"
  )
  expect(clockOf({ ...at_work, state: "lost" }, 1e9)).toBeUndefined()
})

test("a row says why it failed, what it gave back, what it does, that it asks or waits; its time does not tick", () => {
  const now = 3 * MINUTE
  const rows = at_work.agents.map((one) => rowOf(one, now))
  expect(rows.map((row) => [row.key, row.look, row.line, row.time])).toEqual([
    ["1.2", "done", "6 routes", "50s"],
    ["1.1", "done", undefined, "1m 10s"],
    // A JSON result is its detail's: the row says what it last did.
    ["2.1", "done", "Edited invoices.ts", "30s"],
    ["2.2", "working", "Editing share.ts", "1m 00s"],
    ["2.3", "failed", "Pairing runs first", "9s"],
    ["2.4", "asks", "Asks", "1m 00s"],
    ["2.5", "queued", "Waiting for a slot", undefined],
  ])
  expect(rows[3]?.attempt).toBe(2)
  expect(rows[0]?.attempt).toBeUndefined()
})

test("wide, each phase is a column of its agents by index, with what it does, the model they share and its count", () => {
  const columns = columnsOf(at_work, "all", 3 * MINUTE)
  expect(columns).toMatchObject([
    {
      index: 1,
      title: "Scan",
      about: "read each route · Haiku",
      count: "2/2",
      waits: false,
    },
    {
      index: 2,
      title: "Fix",
      about: "one agent per route",
      count: "1/5",
      waits: false,
    },
    { index: 3, title: "Verify", about: "run the tests", waits: true },
  ])
  // A pipeline's rows keep their index order, whatever came first.
  expect(columns[0]?.rows.map((row) => row.key)).toEqual(["1.1", "1.2"])
  expect(columns[2]?.rows).toEqual([])
  // The filter keeps its own.
  const failed = columnsOf(at_work, "failed", 0)
  expect(failed.flatMap((column) => column.rows.map((row) => row.key))).toEqual(
    ["2.3"]
  )
})

test("narrow, a band shows who asks, then failed, then at work; the done fold and the waiting count", () => {
  const [scan, fix, verify] = bandsOf(at_work, "all", 0)
  expect(scan?.rows).toEqual([])
  expect(scan?.done.map((row) => row.key)).toEqual(["1.1", "1.2"])
  expect(fix?.rows.map((row) => row.key)).toEqual(["2.4", "2.3", "2.2"])
  expect(fix?.done.map((row) => row.key)).toEqual(["2.1"])
  expect(fix?.waiting).toBe(1)
  expect(verify?.waits).toBe(true)
  // A filter folds nothing: its rows alone.
  const [, working] = bandsOf(at_work, "working", 0)
  expect(working?.rows.map((row) => row.key)).toEqual(["2.2"])
  expect(working?.done).toEqual([])
  expect(working?.waiting).toBe(0)
})

test("fifty agents, 20 waiting, fold to a few lines in their band", () => {
  const many = crew(
    Array.from({ length: 50 }, (_, at) =>
      agent(
        2,
        at + 1,
        at < 22 ? "done" : at < 27 ? "running" : at < 30 ? "failed" : "queued"
      )
    )
  )
  const [, fix] = bandsOf(many, "all", 0)
  expect(fix?.rows).toHaveLength(8)
  expect(fix?.done).toHaveLength(22)
  expect(fix?.waiting).toBe(20)
  expect(fix?.count).toBe("22/50")
})

test("the Timeline lays each started agent on one axis, which ends a step past now and stays as now moves", () => {
  const now = 10 * MINUTE
  const line = timelineOf(at_work, "all", now)
  // Ten minutes in: marks every 2m, to 12m; now at 10 of 12.
  expect(line.ticks.map((tick) => tick.words)).toEqual([
    "0",
    "2m",
    "4m",
    "6m",
    "8m",
    "10m",
    "12m",
  ])
  expect(line.now).toBeCloseTo(10 / 12)
  // A minute later, the same axis.
  const later = timelineOf(at_work, "all", now + MINUTE)
  expect(later.ticks).toEqual(line.ticks)
  expect(later.now).toBeCloseTo(11 / 12)
  const span = 12 * MINUTE
  const [scan, fix, verify] = line.phases
  // From its start to its start and what it took.
  expect(scan?.lanes[0]).toMatchObject({
    key: "1.1",
    from: MINUTE / span,
    to: (MINUTE + 70_000) / span,
  })
  // One at work, or asking, runs to now; one waiting has no lane.
  expect(fix?.lanes.map((lane) => lane.key)).toEqual([
    "2.1",
    "2.2",
    "2.3",
    "2.4",
  ])
  expect(fix?.lanes[1]?.to).toBeCloseTo(10 / 12)
  expect(fix?.lanes[3]?.to).toBeCloseTo(10 / 12)
  expect(fix?.lanes[2]?.to).toBeCloseTo((2 * MINUTE + 9000) / span)
  expect(verify?.lanes).toEqual([])
  // Ended, the axis is its time, and there is no now.
  const ended = timelineOf(
    { ...at_work, state: "done", ended: now },
    "all",
    1e12
  )
  expect(ended.now).toBeUndefined()
  expect(ended.ticks.at(-1)?.words).toBe("10m")
})

test("an agent's detail: where it is, its facts, brief, last tool and result, its JSON written out", () => {
  const one = agent(2, 1, "done", {
    model: "Opus 5.5",
    took: 130_000,
    tokens: 48_200,
    prompt: "Add the access check",
    last: "Edited billing/invoices.ts",
    result: '{"route":"billing/invoices.ts","fixed":true}',
  })
  const detail = detailOf(crew([one, agent(2, 2, "running")]), one, 0)
  expect(detail.crumbs).toEqual(["audit-routes", "Fix", "route-2.1.ts"])
  expect(detail.facts).toEqual([
    { name: "Phase", value: "Fix · 1 of 2" },
    { name: "State", value: "Done", look: "done" },
    { name: "Time", value: "2m 10s" },
    { name: "Model", value: "Opus 5.5" },
    { name: "Attempt", value: "1" },
    { name: "Tokens", value: "48.2k" },
  ])
  expect(detail.brief).toBe("Add the access check")
  expect(detail.last).toBe("Edited billing/invoices.ts")
  expect(detail.result).toEqual({
    text: '{\n  "route": "billing/invoices.ts",\n  "fixed": true\n}',
    json: true,
  })
  expect(resultOf("{ not json")).toEqual({ text: "{ not json", json: false })
  expect(agentOf(at_work, "2.3")?.why).toMatch(/^Pairing/)
  expect(agentOf(at_work, "9.9")).toBeUndefined()
})

test("once ended: its Result with when it went back, why it failed, or Lost with Ask Claude to go on", () => {
  expect(endingOf(at_work, "Claude")).toBeUndefined()
  const done = {
    ...at_work,
    state: "done" as const,
    ended: 0,
    result: "7 of 12 fixed",
  }
  expect(endingOf(done, "Claude")).toMatchObject({
    kind: "result",
    result: { text: "7 of 12 fixed", json: false },
  })
  expect(endingOf({ ...done, result: undefined }, "Claude")).toBeUndefined()
  expect(
    endingOf(
      { ...at_work, state: "failed", why: "Error: threw\n  at x" },
      "Claude"
    )
  ).toEqual({ kind: "failed", why: "Error: threw" })
  expect(
    endingOf(
      { ...at_work, state: "lost", why: "Stopped when Banda restarted." },
      "Claude"
    )
  ).toEqual({
    kind: "lost",
    words: "Stopped when Banda restarted · 3 of 7 done",
    then: "Claude can go on from here, with the 3 done kept.",
    goOn: true,
  })
})

test("the filter keeps those at work, asking or failed", () => {
  const states = at_work.agents.map((one) => one.state)
  for (const [filter, kept] of [
    ["working", ["running"]],
    ["asks", ["asks"]],
    ["failed", ["failed"]],
  ] as const)
    expect(
      states.filter((_, at) => keeps(filter, at_work.agents[at]!))
    ).toEqual(kept)
})

test("it opens by itself once a Crew: one at work it never opened for", () => {
  const second = { ...at_work, id: "x" }
  const ended = { ...at_work, id: "y", state: "done" as const }
  expect(
    toOpen([at_work, second, ended], new Set()).map((one) => one.id)
  ).toEqual(["w", "x"])
  expect(
    toOpen([at_work, second], new Set(["w"])).map((one) => one.id)
  ).toEqual(["x"])
})
