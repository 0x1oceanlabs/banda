import type { Event, ProjectId, ProjectSummary } from "@banda/contract"
import { expect, test } from "vitest"
import { type Kinds, placingOf, showsThreadOf } from "./asked"
import type { Workspaces } from "./model"

const ARC = "arc-machine" as ProjectId
const BANDA = "arc-banda" as ProjectId
const theirs = new Map([
  [BANDA, { id: BANDA, scratch: false } as ProjectSummary],
  ["arc-draft" as ProjectId, { scratch: true } as ProjectSummary],
])

const kinds: Kinds = {
  leads: (kind) => kind === "t.thread",
  elsewhere: (kind) => kind !== "b.browser",
}

const asked = (
  over: Partial<Event> = {},
  project: string = BANDA,
  kind = "git.diff"
): Event =>
  ({
    seq: 12,
    module: "workspaces",
    kind: "pane.asked",
    version: 1,
    author: { kind: "agent", id: "agent-1" },
    payload: {
      thread: "thread-1",
      project,
      kind,
      args: { scope: { kind: "changes" } },
      beside: { pane: "arcs-own", side: "right" },
    },
    ...over,
  }) as unknown as Event

test("what an Agent asked for on another machine is asked of this one's engine, by where its log said it", () => {
  expect(placingOf(asked(), ARC, theirs, kinds)).toEqual({
    from: ARC,
    at: 12,
    by: "agent-1",
    thread: "thread-1",
    project: BANDA,
    kind: "git.diff",
    args: { scope: { kind: "changes" } },
    scratch: false,
  })
  // A Thread of no Project there is said so: this engine knows none of
  // that machine's Projects.
  expect(placingOf(asked({}, "arc-draft"), ARC, theirs, kinds)?.scratch).toBe(
    true
  )
})

test("nothing is asked for a Project the machine does not list, a kind not shown for another machine, what no Agent wrote, or another event or version", () => {
  const none = (event: Event) =>
    expect(placingOf(event, ARC, theirs, kinds)).toBeNull()
  none(asked({}, "someone-elses"))
  none(asked({}, BANDA, "b.browser"))
  none(asked({ author: { kind: "person", id: "me" } as Event["author"] }))
  none(asked({ kind: "opened" }))
  none(asked({ module: "agents" }))
  none(asked({ version: 2 }))
})

test("a machine is followed only while a Thread of its Projects shows", () => {
  const shows = (kind: string, project: string) =>
    ({
      list: [{ columns: [{ entries: [{ project, pane: { kind } }] }] }],
    }) as unknown as Workspaces
  expect(showsThreadOf(shows("t.thread", BANDA), theirs, kinds)).toBe(true)
  // Its Diff alone, or a Thread of this machine's, is no reason to.
  expect(showsThreadOf(shows("git.diff", BANDA), theirs, kinds)).toBe(false)
  expect(showsThreadOf(shows("t.thread", "mine"), theirs, kinds)).toBe(false)
  expect(showsThreadOf({ list: [], current: 0 }, theirs, kinds)).toBe(false)
})
