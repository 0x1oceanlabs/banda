import { beforeEach, expect, test, vi } from "vitest"
import { type Engine, type ProjectId, Refused } from "@banda/contract"
import { Unreachable } from "@banda/core/react"
import type { Args, WindowApi } from "@banda/ui/module"
import type { PaneState } from "@banda/ui/pane"

const said = vi.hoisted(() => ({ errors: [] as string[] }))
vi.mock("@banda/ui/components/sonner", () => ({
  toast: Object.assign(() => undefined, {
    error: (words: string) => said.errors.push(words),
  }),
}))
const { answering } = await import("./answering")
const { ANSWER, RETRY, SHOW } = await import("./rows")

/** This machine's Project, arc's, and one no machine the Window knows
 * has. */
const P = "p1" as ProjectId
const R = "r1" as ProjectId
const D = "d1" as ProjectId

/** What the Window says of a Project no machine it knows has
 * (`KeptHosts.sessionOf`). */
const UNKNOWN = "This window does not reach that machine"

/**
 * A Window with this machine's engine and arc's, each keeping what it was
 * sent, and arc reached while `reached` says so. Its `sessionOf` goes by
 * the Project, as the Window's directory places it (`KeptHosts.sessionOf`,
 * ADR 0106, decision 1): arc out of reach refuses at once, in its pill's
 * words, and a Project no machine has fails closed.
 */
function fake() {
  const sent: [string, string, unknown, ProjectId | undefined][] = []
  const opened: [PaneState, ProjectId | undefined][] = []
  const state = { reached: true, refuse: undefined as Refused | undefined }
  const engineOf = (machine: string) =>
    ({
      command: (method: string, params: unknown, project?: ProjectId) => {
        sent.push([machine, method, params, project])
        return state.refuse ? Promise.reject(state.refuse) : Promise.resolve()
      },
    }) as unknown as Engine
  const engines = { here: engineOf("here"), arc: engineOf("arc") }
  const window = {
    sessionOf: (project: ProjectId, pane?: { args: Args }) => {
      // A toast's args name no host: the Project alone places it.
      if (pane !== undefined) throw new Error("placed by its args")
      if (project === P) return engines.here
      if (project !== R) throw new Unreachable("", UNKNOWN, { machine: "" })
      if (!state.reached) throw new Unreachable("arc", "arc is away")
      return engines.arc
    },
    open: (pane: PaneState, project?: ProjectId) =>
      void opened.push([pane, project]),
  } as unknown as WindowApi
  return { window, sent, opened, state }
}

const run = (window: WindowApi, id: string, args: Args) => {
  const action = answering.find((one) => one.id === id)
  if (!action) throw new Error(`no ${id}`)
  action.run(window, args)
}

beforeEach(() => {
  said.errors = []
})

test("a toast's Allow on another machine's Thread answers it on that machine, and this machine's on its own", () => {
  const { window, sent } = fake()
  const allow = { item: "q1", choice: "allow" }
  run(window, ANSWER, { ...allow, project: R })
  run(window, ANSWER, { ...allow, project: P })
  expect(sent).toEqual([
    ["arc", "agents.answer", allow, R],
    ["here", "agents.answer", allow, P],
  ])
  expect(said.errors).toEqual([])
})

test("Try again on another machine's failed turn tries it there", () => {
  const { window, sent } = fake()
  run(window, RETRY, { project: R, turn: "u1" })
  expect(sent).toEqual([["arc", "agents.retry", { turn: "u1" }, R]])
})

test("with that machine out of reach, an answer and a retry are refused at once, in its words, and sent nowhere", () => {
  const { window, sent, state } = fake()
  state.reached = false
  run(window, ANSWER, { project: R, item: "q1", choice: "allow" })
  run(window, RETRY, { project: R, turn: "u1" })
  // A Project no machine the Window knows has is never this machine's.
  run(window, ANSWER, { project: D, item: "q1", choice: "allow" })
  expect(sent).toEqual([])
  expect(said.errors).toEqual([
    "arc is away: your answer was not sent.",
    "arc is away: Try again was not sent.",
    `${UNKNOWN}: your answer was not sent.`,
  ])
})

test("what that machine's engine refuses, a toast says", async () => {
  const { window, state } = fake()
  state.refuse = new Refused({ code: "not_found", message: "No such Question" })
  run(window, ANSWER, { project: R, item: "q1", choice: "allow" })
  await vi.waitFor(() => expect(said.errors).toEqual(["No such Question"]))
})

test("Sign in shows the Thread in its Project, naming no host: the directory places it on the machine it is on", () => {
  const { window, opened } = fake()
  // Even a host its args name goes unsaid: its Project alone places it.
  run(window, SHOW, { project: R, thread: "t1", harness: "fake", host: "arc" })
  run(window, SHOW, { project: P, thread: "t2", harness: "fake" })
  expect(opened.map(([pane, project]) => [pane.args, project])).toEqual([
    [{ thread: "t1", harness: "fake", title: "" }, R],
    [{ thread: "t2", harness: "fake", title: "" }, P],
  ])
})
