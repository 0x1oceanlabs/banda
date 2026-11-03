import type { Event } from "@banda/contract"
import type { TurnView } from "@banda/contract/agents"
import { expect, test } from "vitest"
import { event, person } from "./testing"
import { apply, EMPTY, NOTHING } from "./thread"
import { foldTitle, type Line, summary, timeline } from "./timeline"

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
        return { work: line.items.map((item) => item.id), live: line.live }
      case "fold":
        return { fold: shape(line.lines) }
      case "working":
        return "working"
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
  expect(shape(timeline(state))).toEqual([
    "m",
    "working",
    { work: ["t", "a", "b"], live: false },
    "r",
    // A single tool call shows itself.
    "c",
  ])
})

test("the work at the end of the turn that runs is live", () => {
  const state = play(
    asked(),
    event("turn.started", { turn: "u" }),
    tool("a"),
    tool("b")
  )
  expect(shape(timeline(state))).toEqual([
    "m",
    "working",
    { work: ["a", "b"], live: true },
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
  expect(shape(timeline(state))).toEqual([
    "m",
    { fold: ["a", "r1", { work: ["b", "c"], live: false }] },
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
  expect(shape(timeline(state))).toEqual(["m", { fold: ["a", "b"] }, "v", "r"])
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
  expect(shape(timeline(state))).toEqual([
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
  expect(shape(timeline(replying)).slice(-2)).toEqual(["m3", "r3"])
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
  expect(shape(timeline(state))).toEqual(["m", "q", { fold: ["a"] }, "r"])
})

test("a turn with no work, or one that failed, does not fold", () => {
  const plain = play(
    asked(),
    event("turn.started", { turn: "u" }),
    reply("r"),
    event("turn.ended", { turn: "u", state: "done" })
  )
  expect(shape(timeline(plain))).toEqual(["m", "r"])
  const failed = play(
    asked("v", "n"),
    event("turn.started", { turn: "v" }),
    tool("a", "execute", "v"),
    tool("b", "execute", "v"),
    event("turn.ended", { turn: "v", state: "failed" })
  )
  expect(shape(timeline(failed))).toEqual([
    "n",
    { work: ["a", "b"], live: false },
    "ended failed",
  ])
})

test("a stopped turn folds and still says it stopped", () => {
  const state = play(
    asked(),
    event("turn.started", { turn: "u" }),
    tool("a"),
    tool("b"),
    event("turn.ended", { turn: "u", state: "stopped" })
  )
  expect(shape(timeline(state))).toEqual([
    "m",
    { fold: [{ work: ["a", "b"], live: false }] },
    "ended stopped",
  ])
})

test("a line of work names its two largest kinds", () => {
  const state = play(
    asked(),
    event("turn.started", { turn: "u" }),
    tool("a", "edit"),
    tool("b"),
    tool("c"),
    tool("d", "read"),
    tool("e", "execute")
  )
  const items = state.items.filter((item) => item.body.kind === "tool")
  expect(summary(items)).toBe("Ran 3 commands, edited a file and 1 more")
  expect(summary(items.slice(0, 3))).toBe("Ran 2 commands and edited a file")
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
  expect(shape(timeline(state))).toEqual([
    "m",
    { fold: ["e"] },
    "r",
    { changes: ["/a.md"] },
  ])
})
