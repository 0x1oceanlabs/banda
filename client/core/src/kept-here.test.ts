import { expect, test, vi } from "vitest"
import type { Here } from "./here"
import { KeptHere, keptHere } from "./kept-here"

const A = "project-a"

/** Here on Thread `subject`'s Pane in Project A, built anew each time, as
 * the Window folds it from its sources. */
const on = (subject: string, front = true): Here => ({
  front,
  sidebar: true,
  workspace: { id: "w1", project: A },
  pane: { id: `pane-${subject}`, project: A, subject },
  project: A,
})

test("what says the same is kept: all of Here, else each part of it", () => {
  const was = on("t1")
  expect(keptHere(was, on("t1"))).toBe(was)
  // The Window behind: a reader of the Pane or the workspace is not
  // drawn again, as their objects stay.
  const behind = keptHere(was, on("t1", false))
  expect(behind).not.toBe(was)
  expect(behind.front).toBe(false)
  expect(behind.pane).toBe(was.pane)
  expect(behind.workspace).toBe(was.workspace)
  // The focus on another Thread: a new Pane, the same workspace.
  const next = keptHere(was, on("t2"))
  expect(next.pane).toEqual({ id: "pane-t2", project: A, subject: "t2" })
  expect(next.workspace).toBe(was.workspace)
})

test("a kept Here reads its sources as they are now, the same object while it says the same", () => {
  let subject = "t1"
  let front = true
  const kept = new KeptHere(() => on(subject, front))
  const first = kept.get()
  expect(kept.get()).toBe(first)
  // A change the Tiling made is in it before the Window draws it.
  subject = "t2"
  expect(kept.get().pane?.subject).toBe("t2")
  const second = kept.get()
  expect(kept.get()).toBe(second)
  front = false
  expect(kept.get().front).toBe(false)
})

test("a kept Here tells its readers once for each change, and of none when nothing changed", () => {
  let subject = "t1"
  const kept = new KeptHere(() => on(subject))
  const heard = vi.fn()
  const stop = kept.subscribe(heard)
  kept.tell()
  expect(heard).not.toHaveBeenCalled()
  subject = "t2"
  // An act read it first: its readers are still told once.
  const read: Here = kept.get()
  expect(read.pane?.subject).toBe("t2")
  kept.tell()
  kept.tell()
  expect(heard).toHaveBeenCalledTimes(1)
  stop()
  subject = "t3"
  kept.tell()
  expect(heard).toHaveBeenCalledTimes(1)
})

test("a kept Here back where its readers were told, before the Window drew, tells them nothing", () => {
  let front = true
  const kept = new KeptHere(() => on("t1", front))
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
