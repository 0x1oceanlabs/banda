import type { ProjectSummary } from "@banda/contract"
import type { Shown } from "@banda/core"
import type { PaneState } from "@banda/ui/pane"
import { expect, test } from "vitest"
import { close, focused, open, start, type Workspaces } from "../tiling/model"
import { type Around, hereOf } from "./here"

const A = "project-a"
const B = "project-b"
const HOME = "home"
/** This machine's No Project, and a scratch Project a Thread of none made
 * (ADR 0046). */
const MACHINE = "machine"
const SCRATCH = "scratch-1"
/** A Project whose folder is missing. */
const GONE = "project-gone"
/** Host arc's No Project, one of its Projects and a scratch one there. */
const ARC = "arc-machine"
const C = "project-c"
const ARC_SCRATCH = "scratch-arc"

const project = (id: string, more?: Partial<ProjectSummary>) =>
  ({
    id,
    name: id,
    folder: `/${id}`,
    pinned: false,
    archived: false,
    sees_others: false,
    sign: { kind: "letters", text: id, picked: false },
    trusted: true,
    scratch: false,
    missing: false,
    ...more,
  }) satisfies ProjectSummary
const arc: Shown = {
  name: "arc",
  named: { name: "arc", icon: "server" },
  state: { name: "arc", ssh: "arc", state: "connecting" },
  projects: [project(C), project(ARC_SCRATCH, { scratch: true })],
  machine: ARC,
}

const thread = (id: string): PaneState => ({
  kind: "agents.thread",
  args: { thread: id },
})
const terminal = (id: string): PaneState => ({
  kind: "terminal.terminal",
  args: { id },
})
const shows = (pane: PaneState) =>
  pane.kind === "agents.thread" ? String(pane.args.thread) : null
const around: Around = {
  sidebar: true,
  front: true,
  home: HOME,
  machine: MACHINE,
  flow: "row",
  projects: [
    project(A),
    project(B),
    project(SCRATCH, { scratch: true }),
    project(GONE, { missing: true }),
  ],
  hosts: [arc],
}

/** The first workspace made a Project's. */
const of = (state: Workspaces, project: string): Workspaces => ({
  ...state,
  list: state.list.map((one, i) => (i === 0 ? { ...one, project } : one)),
})

test("Here is the Pane in focus, its Project and the thing it shows", () => {
  const state = of(open(start(), A, thread("t1")), A)
  const here = hereOf(state, around, shows)
  expect(here).toEqual({
    front: true,
    sidebar: true,
    workspace: { id: state.list[0]!.id, project: A },
    pane: { id: focused(state)!.id, project: A, subject: "t1" },
    project: A,
    starts: A,
  })
  // A Pane of no one thing names none, and its Project is the Person's.
  const beside = open(state, B, terminal("x"), { place: "right" })
  expect(hereOf(beside, around, shows).pane).toEqual({
    id: focused(beside)!.id,
    project: B,
  })
  expect(hereOf(beside, around, shows).project).toBe(B)
})

test("a Pane of another host's Project names that host on Here", () => {
  // As its args keep it (ADR 0081): an act that would go to this
  // machine's engine reads it and stays off.
  const there = { ...thread("t2"), args: { thread: "t2", host: "arc" } }
  const state = open(start(), B, there)
  expect(hereOf(state, around, shows).pane).toEqual({
    id: focused(state)!.id,
    project: B,
    subject: "t2",
    host: "arc",
  })
  // The host its frame reaches it on, as the Window's hosts say: one
  // that lists its Project where its args name none, and none where this
  // machine's Project wins a clash.
  const listed = open(start(), B, thread("t3"))
  expect(hereOf(listed, around, shows, () => "arc").pane?.host).toBe("arc")
  expect(hereOf(state, around, shows, () => undefined).pane).not.toHaveProperty(
    "host"
  )
})

test("on a workspace with no Pane, the Project is the workspace's, else home", () => {
  // As when the Person archives a Project's last Thread: New Thread
  // starts there, not in home (ADR 0087, decision 4).
  const project = of(open(start(), A, thread("t1")), A)
  const emptied = close(project, focused(project)!.id)
  expect(hereOf(emptied, around, shows)).toMatchObject({
    pane: null,
    project: A,
  })
  expect(hereOf(start(), around, shows)).toMatchObject({
    pane: null,
    workspace: { id: expect.any(String) },
    project: HOME,
  })
  // While the Tiling reads the arrangement, no workspace is on screen.
  const waiting = { list: [{ id: "", columns: [], focus: 0 }], current: 0 }
  expect(hereOf(waiting, around, shows)).toMatchObject({
    workspace: null,
    pane: null,
    project: HOME,
  })
})

test("a New Thread starts in the Project in front, else in No Project on a free workspace, else in home", () => {
  // On a Project's workspace, in its Project, though the Pane in focus
  // is another's, as one its Agent opened (ADR 0102, decision 3).
  const project = of(open(start(), A, thread("t1")), A)
  expect(hereOf(project, around, shows).starts).toBe(A)
  const foreign = open(project, B, terminal("x"), { place: "right" })
  expect(hereOf(foreign, around, shows)).toMatchObject({
    project: B,
    starts: A,
  })
  // Emptied, it is still that Project's.
  const emptied = close(project, focused(project)!.id)
  expect(hereOf(emptied, around, shows).starts).toBe(A)
  // On a free workspace, in the focused Pane's Project.
  const free = open(start(), B, terminal("y"))
  expect(hereOf(free, around, shows).starts).toBe(B)
  // Beside a Thread of no Project, in No Project: never in its scratch
  // Space, nor on a workspace one claimed.
  for (const none of [MACHINE, SCRATCH]) {
    const loose = open(start(), none, thread("t2"))
    expect(hereOf(loose, around, shows).starts).toBe(MACHINE)
    expect(hereOf(of(loose, none), around, shows).starts).toBe(MACHINE)
  }
  // Before the engine names No Project, in home.
  const unnamed = { ...around, machine: undefined }
  const scratch = open(start(), SCRATCH, thread("t3"))
  expect(hereOf(scratch, unnamed, shows).starts).toBe(HOME)
  // With no Pane on screen, in home: on the empty workspace at the
  // bottom, and while the Tiling reads the arrangement.
  expect(hereOf(start(), around, shows).starts).toBe(HOME)
  const waiting = { list: [{ id: "", columns: [], focus: 0 }], current: 0 }
  expect(hereOf(waiting, around, shows).starts).toBe(HOME)
})

test("a New Thread never starts in a Project no Thread starts in, nor in another machine's No Project", () => {
  // A Project whose folder is missing, or one archived, which the
  // Window no longer lists, starts none: in home, as its draft could
  // not send.
  for (const none of [GONE, "project-archived"]) {
    const left = of(open(start(), none, thread("t1")), none)
    expect(hereOf(left, around, shows).starts).toBe(HOME)
  }
  // Another machine's Project, as the Window lists it, is one.
  const there = of(open(start(), C, thread("t2")), C)
  expect(hereOf(there, around, shows).starts).toBe(C)
  // Beside a Thread of arc's No Project, in this machine's: a New
  // Thread names no host, nor shares that Thread's scratch Space.
  for (const none of [ARC, ARC_SCRATCH]) {
    const loose = open(start(), none, thread("t3"))
    expect(hereOf(loose, around, shows).starts).toBe(MACHINE)
    expect(hereOf(of(loose, none), around, shows).starts).toBe(MACHINE)
  }
  // Before arc lists its Projects, its own is none the Window knows.
  const early = { ...around, hosts: [] }
  expect(hereOf(there, early, shows).starts).toBe(HOME)
})

test("in the Flow free, a New Thread starts in the focused Pane's Project, whoever claimed the workspace in the row", () => {
  // The engine keeps the workspace A's from the row, but in `free` every
  // workspace is free (ADR 0102, decision 1).
  const free = { ...around, flow: "free" as const }
  const project = of(open(start(), A, thread("t1")), A)
  const beside = open(project, B, thread("t2"), { place: "right" })
  expect(hereOf(beside, free, shows).starts).toBe(B)
  expect(hereOf(beside, around, shows).starts).toBe(A)
  // Emptied, nothing is on screen: in home.
  expect(hereOf(close(project, focused(project)!.id), free, shows).starts).toBe(
    HOME
  )
})
