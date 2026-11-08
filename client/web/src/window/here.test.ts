import type { Here } from "@banda/ui/here"
import type { PaneState } from "@banda/ui/pane"
import { expect, test, vi } from "vitest"
import { close, focused, open, start, type Workspaces } from "../tiling/model"
import { type Around, hereOf, KeptHere, keptHere } from "./here"

const A = "project-a"
const B = "project-b"
const HOME = "home"

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
const around: Around = { sidebar: true, front: true, home: HOME }

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

test("what says the same is kept: all of Here, else each part of it", () => {
  const state = open(start(), A, thread("t1"))
  const was = hereOf(state, around, shows)
  expect(keptHere(was, hereOf(state, around, shows))).toBe(was)
  // The Window behind: a reader of the Pane or the workspace is not
  // drawn again, as their objects stay.
  const behind = keptHere(
    was,
    hereOf(state, { ...around, front: false }, shows)
  )
  expect(behind).not.toBe(was)
  expect(behind.front).toBe(false)
  expect(behind.pane).toBe(was.pane)
  expect(behind.workspace).toBe(was.workspace)
  // The focus on another Thread: a new Pane, the same workspace.
  const moved = open(state, A, thread("t2"), { place: "right" })
  const next = keptHere(was, hereOf(moved, around, shows))
  expect(next.pane).toEqual({
    id: focused(moved)!.id,
    project: A,
    subject: "t2",
  })
  expect(next.workspace).toBe(was.workspace)
})

test("a kept Here reads its sources as they are now, the same object while it says the same", () => {
  let state = open(start(), A, thread("t1"))
  let front = true
  const kept = new KeptHere(() => hereOf(state, { ...around, front }, shows))
  const first = kept.get()
  expect(kept.get()).toBe(first)
  // A change the Tiling made is in it before the Window draws it.
  state = open(state, A, thread("t2"), { place: "right" })
  expect(kept.get().pane?.subject).toBe("t2")
  const second = kept.get()
  expect(kept.get()).toBe(second)
  front = false
  expect(kept.get().front).toBe(false)
})

test("a kept Here tells its readers once for each change, and of none when nothing changed", () => {
  let state = open(start(), A, thread("t1"))
  const kept = new KeptHere(() => hereOf(state, around, shows))
  const heard = vi.fn()
  const stop = kept.subscribe(heard)
  kept.tell()
  expect(heard).not.toHaveBeenCalled()
  state = open(state, A, thread("t2"), { place: "right" })
  // An act read it first: its readers are still told once.
  const read: Here = kept.get()
  expect(read.pane?.subject).toBe("t2")
  kept.tell()
  kept.tell()
  expect(heard).toHaveBeenCalledTimes(1)
  stop()
  state = open(state, A, thread("t3"), { place: "right" })
  kept.tell()
  expect(heard).toHaveBeenCalledTimes(1)
})

test("a kept Here back where its readers were told, before the Window drew, tells them nothing", () => {
  let front = true
  const state = open(start(), A, thread("t1"))
  const kept = new KeptHere(() => hereOf(state, { ...around, front }, shows))
  const told = kept.get()
  const heard = vi.fn()
  kept.subscribe(heard)
  // Behind and in front again, an act reading it in between.
  front = false
  expect(kept.get().front).toBe(false)
  front = true
  kept.tell()
  expect(heard).not.toHaveBeenCalled()
  expect(kept.get()).toBe(told)
})
