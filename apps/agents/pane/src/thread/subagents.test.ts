import type { Item, Subagent, ToolKind } from "@banda/contract/agents"
import { expect, test } from "vitest"
import { agent, subagent } from "../testing"
import {
  byId,
  childrenOf,
  direct,
  groupOf,
  afterWords,
  duringWords,
  groupWords,
  labelOf,
  lanesOf,
  nowOf,
  nowWords,
  plus,
  roleOf,
  rowOf,
  wordsOf,
} from "./subagents"

/** A sub-agent of turn `u` at work, started at 1 s. */
const lane = (id: string, more: Partial<Subagent> = {}): Subagent =>
  subagent(id, { started: 1000, ...more })

/** A call as the Pane heard it. */
const call = (title: string, tool: ToolKind, status = "running"): Item =>
  ({
    id: `c-${title}`,
    turn: "u",
    author: agent,
    at: 0,
    body: { kind: "tool", title, tool, status, content: [] },
  }) as Item

const thought: Item = {
  id: "t",
  turn: "u",
  author: agent,
  at: 0,
  body: { kind: "thought", text: "Hm" },
}

/** The Thread's open Question that sub-agent `sub` asks. */
const question = (sub: string, title: string, state = "open"): Item =>
  ({
    id: `q-${sub}`,
    turn: "u",
    author: agent,
    at: 0,
    body: { kind: "question", title, choices: [], state, sub },
  }) as Item

const now = (one: Subagent, heard?: Item, items: Item[] = []) =>
  nowWords(nowOf(one, heard && new Map([[one.id, heard]]), items))

test("a sub-agent's label is its role unless it is general-purpose; then, and for Codex, its title", () => {
  const explore = lane("a", { title: "Map the keys", role: "Explore" })
  const general = lane("b", { title: "Read a.txt", role: "general-purpose" })
  const codex = lane("c", { title: "Read a" })
  const all = [explore, general, codex]
  expect(all.map((one) => labelOf(one, all))).toEqual([
    "Explore",
    "Read a.txt",
    "Read a",
  ])
})

test("a Codex fallback title is Agent N, by its number among its siblings in the order they started", () => {
  const named = lane("a", { title: "Read a" })
  const bare = lane("b", { title: "Agent" })
  const hashed = lane("c", { title: "Agent 1a2b3c4d" })
  // Another turn's are not its siblings, nor a sub-agent's own.
  const later = lane("d", { title: "Agent", turn: "v" })
  const nested = lane("e", { title: "Agent", parent: "a" })
  const all = [named, bare, hashed, later, nested]
  const siblings = all.filter((one) => one.turn === "u" && !one.parent)
  expect(labelOf(bare, siblings)).toBe("Agent 2")
  expect(labelOf(hashed, siblings)).toBe("Agent 3")
  expect(rowOf(later, { lanes: all, items: [] }).label).toBe("Agent 1")
  expect(rowOf(nested, { lanes: all, items: [] }).label).toBe("Agent 1")
  // A title that only starts with the word is the Harness's own, and so
  // is a name its parent gave, which Codex words "Agent research".
  const meant = lane("f", { title: "Agent of change" })
  expect(labelOf(meant, [meant])).toBe("Agent of change")
  const research = lane("g", { title: "Agent research" })
  expect(labelOf(research, [research])).toBe("Agent research")
})

test("its role reads general for general-purpose, with the model only where it differs from its parent's", () => {
  const explore = lane("a", { role: "Explore", model: "Haiku 5.5" })
  expect(roleOf(explore, "Opus 5.5")).toBe("Explore · Haiku 5.5")
  expect(roleOf(explore, "Haiku 5.5")).toBe("Explore")
  expect(roleOf(lane("b", { role: "general-purpose" }))).toBe("general")
  expect(roleOf(lane("c", { model: "GPT-5.5" }), "GPT-5.5")).toBeUndefined()
})

test("a row says its title first, its role after, and is named by its label", () => {
  const explore = lane("a", {
    title: "Map where [row] keys are read",
    role: "Explore",
    model: "Haiku 5.5",
  })
  const row = rowOf(explore, {
    lanes: [explore],
    items: [],
    parentModel: "Opus 5.5",
  })
  expect(row).toMatchObject({
    look: "working",
    title: "Map where [row] keys are read",
    label: "Explore",
    role: "Explore · Haiku 5.5",
  })
})

test("nowOf says the call it runs, Thinking, or the state's word when nothing was heard", () => {
  const working = lane("a")
  expect(now(working, call("Read settings.ts", "read"))).toBe(
    "Reading settings.ts"
  )
  expect(
    nowOf(working, new Map([["a", call("pnpm vitest", "execute")]]), [])
  ).toEqual({
    text: ">_ pnpm vitest",
    mono: true,
  })
  expect(now(working, thought)).toBe("Thinking")
  // A call that ended says what it did.
  expect(now(working, call("Read settings.ts", "read", "done"))).toBe(
    "Read settings.ts"
  )
  // Just after a read, nothing was heard yet.
  expect(now(working)).toBe("Working")
  // What another sub-agent did is not its.
  expect(nowWords(nowOf(working, new Map([["b", thought]]), []))).toBe(
    "Working"
  )
})

test("nowOf says the open Question's title for Asks", () => {
  const asks = lane("a", { state: "asks" })
  const items = [
    question("b", "Allow rm -rf?"),
    question("a", "Allow pnpm vitest sidebar?"),
  ]
  expect(nowOf(asks, undefined, items)).toEqual({
    lead: "Asks:",
    text: "Allow pnpm vitest sidebar?",
  })
  // A Harness's code marks go, as the Thread says a Question.
  expect(
    nowOf(asks, undefined, [
      question("a", "Allow Claude to run `pnpm vitest`?"),
    ])
  ).toEqual({ lead: "Asks:", text: "Allow Claude to run pnpm vitest?" })
  // Answered, it no longer asks it.
  const answered = [question("a", "Allow pnpm vitest?", "answered")]
  expect(now(asks, thought, answered)).toBe("Thinking")
  expect(now(asks, undefined, answered)).toBe("Asks")
})

test("nowOf says the report's first line for Done, why for Failed and Stopped, and the state's word without one", () => {
  const report = "\n**Read in 3 places**: `settings.ts`\nand more"
  expect(now(lane("a", { state: "done", report }))).toBe(
    "Read in 3 places: settings.ts"
  )
  expect(now(lane("a", { state: "done" }))).toBe("Done")
  const why = "2 tests fail in settings.test.ts"
  expect(now(lane("a", { state: "failed", why }))).toBe(why)
  expect(now(lane("a", { state: "failed" }))).toBe("Failed")
  expect(now(lane("a", { state: "stopped" }), thought)).toBe("Stopped")
  expect(now(lane("a", { state: "stopped", why: "Rate limited" }))).toBe(
    "Rate limited"
  )
  const lost = "Stopped when Banda restarted."
  expect(now(lane("a", { state: "lost", why: lost }))).toBe(lost)
})

test("a row's time is still: the minutes since it started while it works, its duration once it ended", () => {
  const facts = { lanes: [], items: [], now: 1000 + 40_000 }
  expect(rowOf(lane("a"), facts).time).toBe("now")
  expect(rowOf(lane("a"), { ...facts, now: 1000 + 200_000 }).time).toBe("3m")
  const done = lane("a", { state: "done", ended: 1000 + 72_000 })
  expect(rowOf(done, facts).time).toBe("1m 12s")
  expect(rowOf(lane("a", { state: "asks" }), facts)).toMatchObject({
    asks: true,
    failed: false,
  })
  expect(
    rowOf(lane("a", { state: "failed", ended: 2000 }), facts)
  ).toMatchObject({
    look: "failed",
    failed: true,
  })
})

test("a sub-agent with its own shows (+N), whatever their state; the Thread shows one level", () => {
  const parent = lane("a")
  const lanes = [
    parent,
    lane("b", { parent: "a" }),
    lane("c", { parent: "a", state: "done" }),
    lane("d", { parent: "b" }),
    lane("e"),
  ]
  expect(plus(parent, lanes)).toBe("(+2)")
  expect(plus(lanes[4], lanes)).toBeUndefined()
  expect(childrenOf(parent, lanes).map((one) => one.id)).toEqual(["b", "c"])
  expect(direct(lanes).map((one) => one.id)).toEqual(["a", "e"])
})

test("a group counts its working, asking and failed members, and settles into one line", () => {
  const live = [
    lane("a"),
    lane("b", { state: "failed", ended: 5000 }),
    lane("c", { state: "asks" }),
    lane("d"),
  ]
  const group = groupOf(live)
  expect(groupWords(group)).toBe("4 sub-agents · 2 working · 1 asks · 1 failed")
  expect(group.settled).toBe(false)
  // Only the asks and the failed take colour.
  expect(group.counts.filter((count) => count.tone)).toEqual([
    { words: "1 asks", tone: "asks" },
    { words: "1 failed", tone: "failed" },
  ])
  expect(group.looks).toEqual(["working", "failed", "asks"])

  const settled = groupOf([
    lane("a", { state: "done", started: 1000, ended: 61_000 }),
    lane("b", { state: "done", started: 2000, ended: 161_000 }),
    lane("c", { state: "stopped", started: 3000, ended: 40_000 }),
  ])
  expect(settled.settled).toBe(true)
  expect(groupWords(settled)).toBe("Ran 3 sub-agents · 2m 40s")
})

test("a group's anchors name its sub-agents, in its order", () => {
  const lanes = [lane("a"), lane("b")]
  const anchor = (sub: string): Item => ({
    id: `s-${sub}`,
    turn: "u",
    author: agent,
    at: 0,
    body: { kind: "subagent", subagent: sub },
  })
  const named = lanesOf([anchor("b"), anchor("x"), anchor("a")], byId(lanes))
  expect(named.map((one) => one.id)).toEqual(["b", "a"])
})

test("Find's words are a row's title, label, role and how it ended, never what it does now", () => {
  const done = lane("a", {
    title: "Map the keys",
    role: "Explore",
    state: "done",
    report: "Read in 3 places\nsettings.ts",
  })
  expect(wordsOf(done, [done])).toBe("Map the keys\nExplore\nRead in 3 places")
  const failed = lane("b", { state: "failed", why: "2 tests fail" })
  expect(wordsOf(failed, [failed])).toBe("Lane b\n2 tests fail")
  // At work, a report or a why it may hold is not how it ended.
  const working = lane("c", { report: "half", why: "old" })
  expect(wordsOf(working, [working])).toBe("Lane c")
  // Its model, as its row shows it: only when its parent's is another.
  const haiku = lane("d", { role: "Explore", model: "Haiku 5.5" })
  expect(wordsOf(haiku, [haiku], "Haiku 5.5")).toBe("Lane d\nExplore")
  expect(wordsOf(haiku, [haiku], "Opus 5.5")).toBe(
    "Lane d\nExplore\nExplore · Haiku 5.5"
  )
})

test("the live line counts the direct sub-agents at work, asking ones too", () => {
  expect(
    duringWords([lane("a"), lane("b", { state: "asks" }), lane("c")])
  ).toBe("3 sub-agents at work")
})

test("the live line names the one at work by what names it", () => {
  expect(duringWords([lane("a", { role: "Explore" })])).toBe(
    "Waiting on Explore"
  )
  expect(
    duringWords([lane("a", { role: "general-purpose", title: "Read a.txt" })])
  ).toBe("Waiting on Read a.txt")
  // Codex's own fallback title gives way to its number among its siblings.
  expect(
    duringWords([
      lane("a", { title: "Agent", state: "done" }),
      lane("b", { title: "Agent" }),
    ])
  ).toBe("Waiting on Agent 2")
})

test("the live line ignores nested and ended sub-agents", () => {
  const live = lane("a", { role: "Explore" })
  const nested = lane("n", { parent: "a" })
  expect(duringWords([live, nested])).toBe("Waiting on Explore")
  for (const state of ["done", "failed", "stopped", "lost"] as const)
    expect(duringWords([live, lane("x", { state })])).toBe("Waiting on Explore")
  // Waiting to start is not at work.
  expect(duringWords([lane("q", { state: "queued" })])).toBeUndefined()
  expect(afterWords([lane("q", { state: "queued" })], "Claude")).toBeUndefined()
  expect(duringWords([nested])).toBeUndefined()
  expect(afterWords([nested], "Claude")).toBeUndefined()
})

test("after the turn one named only by its title is counted, not put in a sentence", () => {
  const titled = lane("a", { title: "Read a.txt one line" })
  expect(afterWords([titled], "Claude")?.words).toBe("1 sub-agent at work")
  const general = { ...titled, role: "general-purpose" }
  expect(afterWords([general], "Claude")?.words).toBe("1 sub-agent at work")
  const fallback = lane("a", { title: "Agent 12345678" })
  expect(afterWords([fallback], "Codex")?.words).toBe("Agent 1 is at work")
})

test("after the turn it says who goes on, for one and for several", () => {
  expect(afterWords([lane("a", { role: "Reviewer" })], "Claude")).toEqual({
    words: "Reviewer is at work",
    then: "Claude goes on when it ends",
  })
  expect(afterWords([lane("a"), lane("b")], "Codex")).toEqual({
    words: "2 sub-agents at work",
    then: "Codex goes on when they end",
  })
})
