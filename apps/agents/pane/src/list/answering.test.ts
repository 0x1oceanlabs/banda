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

const P = "p1" as ProjectId

/**
 * A Window with this machine's engine and arc's, each keeping what it was
 * sent, and arc reached while `reached` says so. Its `sessionOf` goes by
 * the host the args name, as the Window's does (`KeptHosts.sessionOf`):
 * arc out of reach refuses at once, in its pill's words.
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
    sessionOf: (_: ProjectId, pane?: { args: Args }) => {
      const host = pane?.args.host
      if (host === undefined) return engines.here
      if (host !== "arc" || !state.reached)
        throw new Unreachable(String(host), `${String(host)} is away`)
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
  const allow = { project: P, item: "q1", choice: "allow" }
  run(window, ANSWER, { ...allow, host: "arc" })
  run(window, ANSWER, allow)
  expect(sent).toEqual([
    ["arc", "agents.answer", { item: "q1", choice: "allow" }, P],
    ["here", "agents.answer", { item: "q1", choice: "allow" }, P],
  ])
  expect(said.errors).toEqual([])
})

test("Try again on another machine's failed turn tries it there", () => {
  const { window, sent } = fake()
  run(window, RETRY, { project: P, turn: "u1", host: "arc" })
  expect(sent).toEqual([["arc", "agents.retry", { turn: "u1" }, P]])
})

test("with that machine out of reach, an answer and a retry are refused at once, in its words, and sent nowhere", () => {
  const { window, sent, state } = fake()
  state.reached = false
  run(window, ANSWER, { project: P, item: "q1", choice: "allow", host: "arc" })
  run(window, RETRY, { project: P, turn: "u1", host: "arc" })
  // A host the Window does not know is never this machine.
  run(window, ANSWER, {
    project: P,
    item: "q1",
    choice: "allow",
    host: "devbox",
  })
  expect(sent).toEqual([])
  expect(said.errors).toEqual([
    "arc is away: your answer was not sent.",
    "arc is away: Try again was not sent.",
    "devbox is away: your answer was not sent.",
  ])
})

test("what that machine's engine refuses, a toast says", async () => {
  const { window, state } = fake()
  state.refuse = new Refused({ code: "not_found", message: "No such Question" })
  run(window, ANSWER, { project: P, item: "q1", choice: "allow", host: "arc" })
  await vi.waitFor(() => expect(said.errors).toEqual(["No such Question"]))
})

test("Sign in shows the Thread on the machine it is on", () => {
  const { window, opened } = fake()
  run(window, SHOW, { project: P, thread: "t1", harness: "fake", host: "arc" })
  run(window, SHOW, { project: P, thread: "t2", harness: "fake" })
  expect(opened.map(([pane, project]) => [pane.args, project])).toEqual([
    [{ thread: "t1", harness: "fake", title: "", host: "arc" }, P],
    [{ thread: "t2", harness: "fake", title: "" }, P],
  ])
})
