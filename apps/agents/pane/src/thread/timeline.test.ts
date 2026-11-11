import type { Event } from "@banda/contract"
import type { TurnView } from "@banda/contract/agents"
import { expect, test } from "vitest"
import { event, person } from "../testing"
import { apply, EMPTY, NOTHING, steerable } from "./state"
import {
  awaiting,
  did,
  didWords,
  doing,
  foldTitle,
  type Line,
  thoughtTimes,
  timeline,
  workOf,
} from "./timeline"

function play(...events: Event[]) {
  return events.reduce(apply, EMPTY)
}

const asked = (turn = "u", item = "m") =>
  event(
    "message.posted",
    { item, turn, text: "hi", images: [] },
    { author: person }
  )

const tool = (item: string, tool = "execute", turn = "u") =>
  event("tool.started", {
    item,
    turn,
    title: `Tool ${item}`,
    tool,
    status: "running",
    content: [],
  })

const reply = (item: string, turn = "u") =>
  event("reply.grew", { item, turn, text: "Done." })

/** Each line as a short word, a fold or a line of work with what it holds. */
function shape(lines: Line[]): unknown[] {
  return lines.map((line) => {
    switch (line.kind) {
      case "item":
        return line.item.id
      case "work":
        return { work: line.items.map((item) => item.id) }
      case "subagents":
        return { subagents: line.items.map((item) => item.id) }
      case "fold":
        return { fold: shape(line.lines) }
      case "working":
        return line.doing ? `working, ${line.doing.kind}` : "working"
      case "at-work":
        return "at-work"
      case "ended":
        return `ended ${line.turn.state}`
      case "changes":
        return { changes: line.files.map((file) => file.path) }
      case "plan":
        return { plan: line.item.id }
    }
  })
}

test("tool calls and thoughts in a row are one line of work", () => {
  const state = play(
    asked(),
    event("turn.started", { turn: "u" }),
    event("thought.grew", { item: "t", turn: "u", text: "Hm" }),
    tool("a"),
    tool("b", "edit"),
    reply("r"),
    tool("c")
  )
  expect(shape(timeline(state, "Claude"))).toEqual([
    "m",
    { work: ["t", "a", "b"] },
    "r",
    // A single tool call shows itself.
    "c",
    "working, calling",
  ])
})

test("the turn that runs says so at its live edge, after what it did", () => {
  const started = play(asked(), event("turn.started", { turn: "u" }))
  expect(shape(timeline(started, "Claude"))).toEqual(["m", "working"])
  const state = [tool("a"), tool("b")].reduce(apply, started)
  expect(shape(timeline(state, "Claude"))).toEqual([
    "m",
    { work: ["a", "b"] },
    "working, calling",
  ])
})

test("a turn that ended folds its work, and its last reply stays", () => {
  const state = play(
    asked(),
    event("turn.started", { turn: "u" }),
    tool("a"),
    reply("r1"),
    tool("b"),
    tool("c"),
    reply("r2"),
    event("turn.ended", { turn: "u", state: "done" })
  )
  // Opened, it is one list: its lines of work open into their calls.
  expect(shape(timeline(state, "Claude"))).toEqual([
    "m",
    { fold: ["a", "r1", "b", "c"] },
    "r2",
  ])
})

test("a Visual stays out of its turn's fold, where the Agent showed it", () => {
  const visual = (item: string) =>
    event("visual.shown", {
      item,
      turn: "u",
      visual: `v-${item}`,
      title: "A mockup",
      height: 300,
    })
  const state = play(
    asked(),
    event("turn.started", { turn: "u" }),
    tool("a"),
    visual("v"),
    tool("b"),
    reply("r"),
    event("turn.ended", { turn: "u", state: "done" })
  )
  expect(shape(timeline(state, "Claude"))).toEqual([
    "m",
    { fold: ["a", "b"] },
    "v",
    "r",
  ])
})

test("the reply a turn in plan mode ended with is its plan", () => {
  const planning = { ...EMPTY, settings: { ...EMPTY.settings, plan: true } }
  const state = [
    asked(),
    event("turn.started", { turn: "u" }),
    tool("a"),
    reply("r"),
    event("turn.ended", { turn: "u", state: "done" }),
    asked("v", "m2"),
    event("turn.started", { turn: "v" }),
    reply("r2", "v"),
    event("turn.ended", { turn: "v", state: "done" }),
  ].reduce(apply, planning)
  // Every plan stays a card, not only the latest.
  expect(shape(timeline(state, "Claude"))).toEqual([
    "m",
    { fold: ["a"] },
    { plan: "r" },
    "m2",
    { plan: "r2" },
  ])
  // Out of plan mode, a turn's reply is a reply.
  const replying = [
    asked("w", "m3"),
    event("turn.started", { turn: "w" }),
    reply("r3", "w"),
    event("turn.ended", { turn: "w", state: "done" }),
  ].reduce(apply, { ...state, settings: { ...state.settings, plan: false } })
  expect(shape(timeline(replying, "Claude")).slice(-2)).toEqual(["m3", "r3"])
})

test("a plan the Agent asked to carry out is in its Question, not its reply", () => {
  const planning = { ...EMPTY, settings: { ...EMPTY.settings, plan: true } }
  const choices = [{ id: "yes", name: "Yes", allows: true, always: false }]
  const state = [
    asked(),
    event("turn.started", { turn: "u" }),
    event("question.asked", {
      item: "q",
      turn: "u",
      title: "Approve Plan",
      choices,
      plan: "# Plan",
    }),
    event("question.answered", { item: "q", choice: "yes" }),
    tool("a"),
    reply("r"),
    event("turn.ended", { turn: "u", state: "done" }),
  ].reduce(apply, planning)
  // It stays in sight when the work before the reply folds.
  expect(shape(timeline(state, "Claude"))).toEqual([
    "m",
    "q",
    { fold: ["a"] },
    "r",
  ])
})

test("a turn with no work, or one that failed, does not fold", () => {
  const plain = play(
    asked(),
    event("turn.started", { turn: "u" }),
    reply("r"),
    event("turn.ended", { turn: "u", state: "done" })
  )
  expect(shape(timeline(plain, "Claude"))).toEqual(["m", "r"])
  const failed = play(
    asked("v", "n"),
    event("turn.started", { turn: "v" }),
    tool("a", "execute", "v"),
    tool("b", "execute", "v"),
    event("turn.ended", { turn: "v", state: "failed" })
  )
  expect(shape(timeline(failed, "Claude"))).toEqual([
    "n",
    { work: ["a", "b"] },
    "ended failed",
  ])
})

test("a stopped turn says it stopped once: in its fold", () => {
  const state = play(
    asked(),
    event("turn.started", { turn: "u" }),
    tool("a"),
    tool("b"),
    event("turn.ended", { turn: "u", state: "stopped" })
  )
  expect(shape(timeline(state, "Claude"))).toEqual(["m", { fold: ["a", "b"] }])
  // With no work to fold, its own line says it.
  const quiet = play(
    asked("v", "n"),
    event("turn.started", { turn: "v" }),
    event("turn.ended", { turn: "v", state: "stopped" })
  )
  expect(shape(timeline(quiet, "Claude"))).toEqual(["n", "ended stopped"])
})

/** A tool call that ended: done, or with the exit `code` it gives. */
const ran = (item: string, kind = "execute", code?: number, turn = "u") => [
  tool(item, kind, turn),
  event("tool.changed", {
    item,
    status: code ? "failed" : "done",
    ...(code !== undefined && { exit: { code } }),
  }),
]

const edited = (item: string, path: string, old: string | undefined) =>
  event("tool.started", {
    item,
    turn: "u",
    title: `Edit ${path}`,
    tool: "edit",
    status: "done",
    content: [{ kind: "diff", path, old, new: "one\ntwo\n" }],
  })

test("work says every kind it acted by, what failed, and the lines it changed", () => {
  const state = play(
    asked(),
    event("turn.started", { turn: "u" }),
    event("thought.grew", { item: "t", turn: "u", text: "Hm" }),
    ...ran("r", "read"),
    ...ran("a"),
    ...ran("b", "execute", 1),
    edited("e1", "/a.ts", "one\n"),
    edited("e2", "/a.ts", "one\n"),
    edited("e3", "/b.ts", undefined),
    ...ran("c")
  )
  const done = did(state.items, "done")
  // Reads and thoughts go unsaid beside what it changed; a file edited
  // twice is one file.
  expect(didWords(done)).toBe("ran 3 commands (1 failed), edited 2 files")
  expect(done).toMatchObject({ added: 3, removed: 0 })
})

test("work that only looked says the two kinds it did most", () => {
  const state = play(
    asked(),
    event("turn.started", { turn: "u" }),
    ...ran("s", "search"),
    ...ran("a", "read"),
    ...ran("b", "read"),
    ...ran("f", "fetch")
  )
  expect(didWords(did(state.items, "done"))).toBe("read 2 files, searched once")
  const thought = play(
    asked("v", "n"),
    event("turn.started", { turn: "v" }),
    event("thought.grew", { item: "t", turn: "v", text: "Hm" })
  )
  expect(didWords(did(thought.items))).toBe("thought")
})

test("work in the turn that runs counts what has ended; a stop is no failure", () => {
  const state = play(
    asked(),
    event("turn.started", { turn: "u" }),
    ...ran("a", "read"),
    tool("b")
  )
  expect(didWords(did(state.items, "running"))).toBe("read a file")
  // Its Person stopped it while the command ran.
  const stopped = [
    event("tool.changed", {
      item: "b",
      status: "failed",
      exit: { signal: "SIGTERM" },
    }),
    event("turn.ended", { turn: "u", state: "stopped" }),
  ].reduce(apply, state)
  expect(didWords(did(stopped.items, "stopped"))).toBe("ran a command")
})

test("the live line says what the turn does now", () => {
  const state = play(asked(), event("turn.started", { turn: "u" }), tool("a"))
  const turn = state.turns[0]
  expect(doing(state, turn)).toEqual({
    kind: "calling",
    said: { verb: "Running", subject: "Tool a" },
    since: state.items.at(-1)!.at,
  })
  // A call that ended leaves it working, with nothing to name.
  const ended = apply(
    state,
    event("tool.changed", { item: "a", status: "done" })
  )
  expect(doing(ended, turn)).toBeUndefined()
  const thinking = apply(
    ended,
    event("thought.grew", { item: "t", turn: "u", text: "Hm" })
  )
  expect(doing(thinking, turn)).toEqual({ kind: "thinking" })
})

test("a call that waits for its Person's answer waits for you", () => {
  const state = play(
    asked(),
    event("turn.started", { turn: "u" }),
    event("tool.started", {
      item: "a",
      turn: "u",
      title: "pnpm test",
      tool: "execute",
      status: "pending",
      content: [],
    }),
    event("question.asked", {
      item: "q",
      turn: "u",
      title: "Allow pnpm test?",
      choices: [{ id: "yes", name: "Allow", allows: true, always: false }],
    })
  )
  expect(doing(state, state.turns[0])).toEqual({ kind: "asking" })
  expect([...awaiting(state)]).toEqual(["a"])
  const answered = apply(
    state,
    event("question.answered", { item: "q", choice: "yes" })
  )
  expect([...awaiting(answered)]).toEqual([])
})

test("a thought took until the next thing its turn did, or until the turn ended", () => {
  const state = play(
    asked(),
    event("turn.started", { turn: "u" }),
    event("thought.grew", { item: "t1", turn: "u", text: "Hm" }),
    tool("a"),
    event("thought.grew", { item: "t2", turn: "u", text: "So" })
  )
  const at = (id: string) => state.items.find((item) => item.id === id)!.at
  expect(thoughtTimes(state)).toEqual(new Map([["t1", at("a") - at("t1")]]))
  const ended = apply(state, event("turn.ended", { turn: "u", state: "done" }))
  const end = ended.turns[0].ended!
  expect(thoughtTimes(ended).get("t2")).toBe(end - at("t2"))
})

test("a folded turn says how long it took, or that a Person stopped it", () => {
  const turn: TurnView = { id: "u", message: "m", state: "done", can: NOTHING }
  expect(foldTitle({ ...turn, started: 0, ended: 65_000 })).toBe(
    "Worked for 1m 05s"
  )
  expect(foldTitle(turn)).toBe("Worked")
  expect(
    foldTitle({ ...turn, state: "stopped", started: 0, ended: 8000 })
  ).toBe("You stopped after 8s")
})

test("a turn that ended and changed files says which, after its reply", () => {
  const state = play(
    asked(),
    event("turn.started", { turn: "u" }),
    event("tool.started", {
      item: "e",
      turn: "u",
      title: "Edit a.md",
      tool: "edit",
      status: "done",
      content: [{ kind: "diff", path: "/a.md", old: "one\n", new: "two\n" }],
    }),
    reply("r"),
    event("turn.ended", { turn: "u", state: "done" })
  )
  expect(shape(timeline(state, "Claude"))).toEqual([
    "m",
    { fold: ["e"] },
    "r",
    { changes: ["/a.md"] },
  ])
})

test("a sub-agent's Question leaves the Agent's call that waits unmarked", () => {
  const state = play(
    asked(),
    event("turn.started", { turn: "u" }),
    event("tool.started", {
      item: "a",
      turn: "u",
      title: "pnpm test",
      tool: "execute",
      status: "pending",
      content: [],
    }),
    event("question.asked", {
      item: "q",
      turn: "u",
      sub: "l",
      title: "Allow pnpm lint?",
      choices: [{ id: "yes", name: "Allow", allows: true, always: false }],
    })
  )
  // Its call is in its lane; the Agent's waits for something else.
  expect([...awaiting(state)]).toEqual([])
})

test("a turn's changes count its sub-agents' edits; its work says the Agent's own", () => {
  const lane = {
    id: "l",
    turn: "u",
    title: "Explore",
    state: "running",
    can_stop: true,
    started: 1,
  }
  const state = play(
    asked(),
    event("turn.started", { turn: "u" }),
    event("subagent.started", { item: "s", subagent: lane }),
    event("tool.started", {
      item: "le",
      turn: "u",
      sub: "l",
      title: "Edit b.md",
      tool: "edit",
      status: "done",
      content: [{ kind: "diff", path: "/b.md", old: "x\n", new: "y\n" }],
    }),
    edited("e", "/a.md", undefined),
    reply("r"),
    event("turn.ended", { turn: "u", state: "done" })
  )
  expect(state.edits.map((item) => item.id)).toEqual(["le"])
  expect(shape(timeline(state, "Claude"))).toEqual([
    "m",
    "s",
    { fold: ["e"] },
    "r",
    { changes: ["/b.md", "/a.md"] },
    "at-work",
  ])
  expect(didWords(did(state.items, "done"))).toBe("edited a file")
})

/** Sub-agent `id` of turn `turn` starting, its anchor `item`. */
const started = (item: string, id: string, turn = "u") =>
  event("subagent.started", {
    item,
    subagent: {
      id,
      turn,
      title: `Lane ${id}`,
      state: "running",
      can_stop: true,
      started: 1,
    },
  })

/** Sub-agent `sub` asks its Person. */
const subAsks = (item: string, sub: string, turn = "u") =>
  event("question.asked", {
    item,
    turn,
    sub,
    title: `Allow ${sub}?`,
    choices: [{ id: "yes", name: "Allow", allows: true, always: false }],
  })

test("consecutive sub-agents of one turn are one group, and a lone one is its row", () => {
  const state = play(
    asked(),
    event("turn.started", { turn: "u" }),
    started("s1", "a"),
    // A sub-agent's Question between them is no line of the Thread.
    subAsks("q", "a"),
    started("s2", "b"),
    started("s3", "c"),
    reply("r"),
    started("s4", "d"),
    event("thought.grew", { item: "t", turn: "u", text: "Hm" }),
    started("s5", "e")
  )
  expect(shape(timeline(state, "Claude"))).toEqual([
    "m",
    { subagents: ["s1", "s2", "s3"] },
    "r",
    "s4",
    "t",
    "s5",
    "working, subagents",
  ])
  const group = timeline(state, "Claude")[1]
  expect(group).toMatchObject({
    kind: "subagents",
    id: "subagents-s1",
    turn: "u",
  })
})

test("sub-agents of two turns are two lines, and stay out of a finished turn's fold", () => {
  const state = play(
    asked(),
    event("turn.started", { turn: "u" }),
    tool("a"),
    started("s1", "a"),
    started("s2", "b"),
    tool("b"),
    reply("r"),
    event("turn.ended", { turn: "u", state: "done" }),
    asked("v", "n"),
    event("turn.started", { turn: "v" }),
    started("s3", "c", "v")
  )
  expect(shape(timeline(state, "Claude"))).toEqual([
    "m",
    { fold: ["a", "b"] },
    { subagents: ["s1", "s2"] },
    "r",
    "n",
    "s3",
    "working, subagents",
  ])
})

test("a sub-agent's Question is no line of the Thread and no 'Waiting for you'", () => {
  const state = play(
    asked(),
    event("turn.started", { turn: "u" }),
    started("s", "a"),
    tool("c"),
    subAsks("q", "a")
  )
  const lines = timeline(state, "Claude")
  expect(shape(lines)).toEqual(["m", "s", "c", "working, subagents"])
  const turn = state.turns[0]
  expect(doing(state, turn)).toEqual({
    kind: "subagents",
    words: "Waiting on Lane a",
  })
  // The Agent's own Question still waits for you.
  const own = apply(
    state,
    event("question.asked", {
      item: "p",
      turn: "u",
      title: "Allow pnpm c?",
      choices: [],
    })
  )
  expect(doing(own, own.turns[0])).toEqual({ kind: "asking" })
})

test("the work line counts the Agent's own work, not its sub-agents'", () => {
  const laneCall = (item: string) =>
    event("tool.started", {
      item,
      turn: "u",
      sub: "a",
      title: `Read ${item}`,
      tool: "read",
      status: "done",
      content: [],
    })
  const state = play(
    asked(),
    event("turn.started", { turn: "u" }),
    event("thought.grew", { item: "t", turn: "u", text: "Hm" }),
    started("s", "a"),
    laneCall("x"),
    laneCall("y"),
    tool("a"),
    event("tool.changed", { item: "a", status: "done" }),
    tool("b"),
    event("tool.changed", { item: "b", status: "done" }),
    reply("r"),
    event("turn.ended", { turn: "u", state: "done" })
  )
  const lines = timeline(state, "Claude")
  expect(shape(lines)).toEqual([
    "m",
    { fold: ["t", "a", "b"] },
    "s",
    "r",
    "at-work",
  ])
  const fold = lines[1] as Extract<Line, { kind: "fold" }>
  expect(didWords(did(workOf(fold.lines), "done"))).toBe("ran 2 commands")
})

test("the sub-agents' words win over the parent's own calls and thoughts", () => {
  const state = play(
    asked(),
    event("turn.started", { turn: "u" }),
    started("s1", "a"),
    started("s2", "b")
  )
  const turn = state.turns[0]
  const both = { kind: "subagents", words: "2 sub-agents at work" }
  // Codex's parent waits on its children with a `wait` call of its own.
  const waiting = apply(state, tool("wait", "other"))
  expect(doing(waiting, turn)).toEqual(both)
  const thinking = apply(
    state,
    event("thought.grew", { item: "t", turn: "u", text: "Hm" })
  )
  expect(doing(thinking, turn)).toEqual(both)
  // Once they ended, it says what it does itself again.
  const ended = (subagent: string) =>
    event("subagent.ended", { subagent, turn: "u", state: "done", ended: 9 })
  const back = [ended("a"), ended("b")].reduce(apply, waiting)
  expect(doing(back, turn)?.kind).toBe("calling")
})

test("the parent's own Question comes before its sub-agents' words", () => {
  const state = play(
    asked(),
    event("turn.started", { turn: "u" }),
    started("s", "a"),
    event("question.asked", {
      item: "p",
      turn: "u",
      title: "Allow pnpm c?",
      choices: [],
    })
  )
  expect(doing(state, state.turns[0])).toEqual({ kind: "asking" })
})

test("sub-agents at work after the turn keep a live line with no clock at the Thread's end", () => {
  const state = play(
    asked(),
    event("turn.started", { turn: "u" }),
    started("s", "a"),
    tool("c"),
    event("tool.changed", { item: "c", status: "done" }),
    reply("r"),
    event("turn.ended", { turn: "u", state: "done" })
  )
  const lines = timeline(state, "Claude")
  expect(shape(lines)).toEqual(["m", "s", { fold: ["c"] }, "r", "at-work"])
  // No turn in it, so nothing for a clock to count from.
  expect(lines.at(-1)).toEqual({
    kind: "at-work",
    words: "1 sub-agent at work",
    then: "Claude goes on when it ends",
  })
  // No turn runs: the composer is an idle Thread's.
  expect(steerable(state)).toBe(false)

  const over = apply(
    state,
    event("subagent.ended", {
      subagent: "a",
      turn: "u",
      state: "done",
      ended: 9,
    })
  )
  expect(shape(timeline(over, "Claude"))).toEqual([
    "m",
    "s",
    { fold: ["c"] },
    "r",
  ])
})

test("a new turn takes the live line while sub-agents of the last one still work", () => {
  const state = play(
    asked(),
    event("turn.started", { turn: "u" }),
    started("s", "a"),
    reply("r"),
    event("turn.ended", { turn: "u", state: "done" }),
    asked("v", "n"),
    event("turn.started", { turn: "v" })
  )
  const kinds = timeline(state, "Claude").map((line) => line.kind)
  expect(kinds).toContain("working")
  expect(kinds).not.toContain("at-work")
  // The new turn says what it does itself: it is not waiting on them.
  const calling = apply(state, tool("c", "execute", "v"))
  const turn = calling.turns[1]
  expect(doing(state, turn)).toBeUndefined()
  expect(doing(calling, turn)).toMatchObject({
    kind: "calling",
    said: { verb: "Running", subject: "Tool c" },
  })
  // Its own sub-agent's words win again, and count only its own.
  const own = apply(calling, started("s2", "b", "v"))
  expect(doing(own, own.turns[1])).toEqual({
    kind: "subagents",
    words: "Waiting on Lane b",
  })
})
