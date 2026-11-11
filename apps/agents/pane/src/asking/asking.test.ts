import type { Choice, Item } from "@banda/contract/agents"
import { expect, test } from "vitest"
import {
  aboutOf,
  answersOf,
  choiceAt,
  foldedOf,
  keyAnswer,
  plain,
  type Press,
  wordsOf,
} from "./asking"
import { agent, subagent } from "../testing"
import { askerOf } from "../thread/subagents"
import type { Asked, QuestionBody } from "../thread/state"

const choice = (id: string, allows: boolean, always = false): Choice => ({
  id,
  name: id,
  allows,
  always,
})

/** As Claude Code asks before it runs a command. */
const PERMISSION: Choice[] = [
  choice("allow", true),
  choice("always", true, true),
  choice("deny", false),
]

const question = (over: Partial<QuestionBody> = {}): QuestionBody => ({
  kind: "question",
  title: "`pnpm test --filter look`",
  choices: PERMISSION,
  state: "open",
  ...over,
})

const item = (id: string, body: Item["body"], turn = "t"): Item => ({
  id,
  turn,
  author: agent,
  at: 0,
  body,
})

const call = (
  id: string,
  title: string,
  tool = "execute",
  status = "pending"
) =>
  item(id, { kind: "tool", title, tool, status, content: [] } as Item["body"])

test("a title loses markdown's code marks", () => {
  expect(plain("`pnpm test`")).toBe("pnpm test")
  expect(plain("Run ``a`b`` now")).toBe("Run ab now")
})

test("a permission says in words what it allows, the command apart", () => {
  expect(wordsOf(question(), "execute", "Claude Code")).toEqual({
    words: "Allow Claude Code to run a command?",
    detail: "pnpm test --filter look",
  })
  expect(wordsOf(question({ title: "Edit `a.ts`" }), "edit", "Codex")).toEqual({
    words: "Allow Codex to edit a file?",
    detail: "a.ts",
  })
  // A title in words around the command keeps only the command apart.
  expect(
    wordsOf(
      question({
        title: "Allow Claude Code to run `pnpm test --filter look`?",
      }),
      "execute",
      "Claude Code"
    ).detail
  ).toBe("pnpm test --filter look")
})

test("a Question about no known tool, a form or a plan asks in its words", () => {
  expect(wordsOf(question(), undefined, "Claude Code")).toEqual({
    words: "pnpm test --filter look",
  })
  expect(wordsOf(question(), "think", "Claude Code").detail).toBeUndefined()
  const form = question({ title: "Which branch?", form: [] })
  expect(wordsOf(form, "execute", "Codex")).toEqual({ words: "Which branch?" })
  const plan = question({ title: "Approve Plan", plan: "# Plan" })
  expect(wordsOf(plan, "other", "Claude Code")).toEqual({
    words: "Approve Plan",
  })
})

test("a Question is about the call of its turn with its title, or the last that waits", () => {
  const asked = (title: string, turn = "t") =>
    item("q", question({ title }), turn) as Asked
  const items = [
    call("a", "`pnpm test`", "execute", "done"),
    call("b", "Edit a.ts", "edit"),
    call("c", "Read b.ts", "read", "done"),
  ]
  expect(aboutOf([...items, asked("pnpm test")], asked("pnpm test"))).toBe(
    "execute"
  )
  expect(aboutOf([...items, asked("Write it")], asked("Write it"))).toBe("edit")
  // Not a call of another turn, nor one after it.
  const other = asked("pnpm test", "u")
  expect(aboutOf([...items, other], other)).toBeUndefined()
  const later = asked("Later")
  expect(aboutOf([later, call("d", "Later", "fetch")], later)).toBeUndefined()
})

test("a sub-agent's question names who asks and what its call would do", () => {
  const reviewer = subagent("l", { title: "Review", role: "Reviewer" })
  expect(askerOf("l", [reviewer])).toBe("Reviewer")
  // An Agent's own, or one the Thread has not heard of, names no one.
  expect(askerOf(undefined, [reviewer])).toBeUndefined()
  expect(askerOf("m", [reviewer])).toBeUndefined()
  // Its title in mono, whatever the Agent would have said of a call: a
  // lone command is both, so the drawer draws it once.
  const asked = question({ title: "pnpm vitest", sub: "l" })
  expect(wordsOf(asked, undefined, "Claude")).toEqual({
    words: "pnpm vitest",
    detail: "pnpm vitest",
  })
  expect(
    wordsOf(
      question({ title: "May I run `pnpm vitest`?", sub: "l" }),
      undefined,
      "Claude"
    )
  ).toEqual({ words: "May I run pnpm vitest?", detail: "pnpm vitest" })
  // A form or a plan asks in its own words, as the Agent's do.
  const form = question({ title: "Which colour?", sub: "l", form: [] })
  expect(wordsOf(form, undefined, "Claude")).toEqual({ words: "Which colour?" })
})

test("a sub-agent's Question is about none of the Agent's calls", () => {
  // Its own calls are in its lane, which the Thread does not hold.
  const lanes = item("q", question({ title: "Edit a.ts", sub: "l" })) as Asked
  const items = [call("a", "Edit a.ts", "edit"), lanes]
  expect(aboutOf(items, lanes)).toBeUndefined()
  const pending = item("q", question({ sub: "l" })) as Asked
  expect(aboutOf([call("b", "Read b.ts", "read"), pending], pending)).toBe(
    undefined
  )
})

test("the answers: no once with Esc, the first that allows once the main, the kept under More", () => {
  expect(answersOf(PERMISSION)).toEqual({
    decline: PERMISSION[2],
    main: PERMISSION[0],
    others: [],
    kept: [PERMISSION[1]],
  })
  const more = [
    choice("a", true),
    choice("e", true),
    choice("s", true, true),
    choice("d", false),
  ]
  expect(answersOf(more)).toMatchObject({
    decline: more[3],
    main: more[0],
    others: [more[1]],
    kept: [more[2]],
  })
  expect(answersOf([choice("x", true, true)])).toMatchObject({
    decline: undefined,
    main: undefined,
  })
})

test("keys 1 to 9 pick the choices in the Harness's order", () => {
  expect(choiceAt(PERMISSION, "2")).toBe(PERMISSION[1])
  expect(choiceAt(PERMISSION, "4")).toBeUndefined()
  expect(choiceAt(PERMISSION, "0")).toBeUndefined()
  expect(choiceAt(PERMISSION, "Enter")).toBeUndefined()
})

test("an answered permission folds to what was allowed or declined", () => {
  const answered = (answer: string) =>
    foldedOf(question({ state: "answered", answer })).text
  expect(answered("allow")).toBe("Allowed: pnpm test --filter look")
  expect(answered("always")).toBe("Always allowed: pnpm test --filter look")
  expect(answered("deny")).toBe("Declined: pnpm test --filter look")
  expect(foldedOf(question({ state: "closed" }))).toEqual({
    kind: "closed",
    text: "No longer asked: pnpm test --filter look",
  })
})

test("a choice among more, or a plan's, folds to the choice", () => {
  const branches = question({
    title: "Which branch?",
    choices: [
      choice("main", true),
      choice("release", true),
      choice("no", false),
    ],
    state: "answered",
    answer: "release",
  })
  expect(foldedOf(branches).text).toBe("You chose: release")
  const plan = question({
    title: "Approve Plan",
    plan: "# Plan",
    choices: [choice("Yes", true), choice("No", false)],
    state: "answered",
    answer: "Yes",
  })
  expect(foldedOf(plan).text).toBe("You chose: Yes")
})

test("an answered form folds to its title, its answers opening from it", () => {
  const form = question({
    title: "How should the PR be opened?",
    choices: [choice("submit", true), choice("skip", false)],
    form: [
      {
        id: "base",
        title: "Base branch",
        required: true,
        secret: false,
        input: {
          kind: "choice",
          choices: [{ value: "main", name: "main" }],
        },
      },
    ],
    state: "answered",
    answer: "submit",
  })
  expect(foldedOf({ ...form, values: { base: "main" } })).toEqual({
    kind: "answered",
    text: "Answered: How should the PR be opened?",
    values: [{ id: "base", title: "Base branch", value: "main" }],
  })
  expect(foldedOf({ ...form, values: {} }).text).toBe(
    "Answered: How should the PR be opened? · nothing filled in"
  )
  expect(foldedOf({ ...form, answer: "skip" })).toEqual({
    kind: "skipped",
    text: "Skipped: How should the PR be opened?",
  })
})

const press = (over: Partial<Press>): Press => ({
  key: "Enter",
  mods: false,
  composing: false,
  taken: false,
  on: "other",
  written: false,
  ...over,
})

test("Enter gives the main answer from the empty composer or a place that takes no keys", () => {
  // The composer takes every Enter, sending nothing when nothing is
  // written.
  expect(keyAnswer(press({ on: "composer", taken: true }))).toBe("main")
  expect(keyAnswer(press({ on: "other" }))).toBe("main")
})

test("Enter stays with a message written, a field, a control, or what took it", () => {
  expect(
    keyAnswer(press({ on: "composer", taken: true, written: true }))
  ).toBeUndefined()
  expect(keyAnswer(press({ on: "field" }))).toBeUndefined()
  expect(keyAnswer(press({ on: "control" }))).toBeUndefined()
  expect(keyAnswer(press({ taken: true }))).toBeUndefined()
  expect(keyAnswer(press({ mods: true }))).toBeUndefined()
  expect(keyAnswer(press({ composing: true }))).toBeUndefined()
})

test("Esc says no from anywhere in the Pane but what took it", () => {
  const esc = (over: Partial<Press>) =>
    keyAnswer(press({ key: "Escape", ...over }))
  expect(esc({ on: "composer", written: true, taken: true })).toBe("decline")
  expect(esc({ on: "field" })).toBe("decline")
  expect(esc({ on: "control" })).toBe("decline")
  expect(esc({ on: "other" })).toBe("decline")
  // A menu, the find bar, a queued message being edited.
  expect(esc({ on: "field", taken: true })).toBeUndefined()
  expect(esc({ mods: true })).toBeUndefined()
  expect(esc({ composing: true })).toBeUndefined()
})

test("other keys answer nothing from the Pane", () => {
  expect(keyAnswer(press({ key: "1" }))).toBeUndefined()
  expect(keyAnswer(press({ key: "a", on: "composer" }))).toBeUndefined()
})
