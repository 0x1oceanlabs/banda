import type { ProjectId } from "@banda/contract"
import { HOUR } from "@banda/ui/lib/words"
import type { Listed } from "@banda/ui/pane"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import {
  keep,
  KEPT_FOR,
  putBack,
  toldArchived,
  UNDO_TOAST,
  undoLast,
  undoOf,
  type Undoable,
} from "./undo"

// Each step runs its Thread's App's item action, found by what it does.
vi.mock("./items", () => ({
  itemActionOf: (_listed: Listed, does: string) => ({ id: `agents.${does}` }),
}))

const toasts = vi.hoisted(() => ({ shown: vi.fn(), dismiss: vi.fn() }))
vi.mock("@banda/ui/components/sonner", () => ({
  toast: Object.assign(toasts.shown, { dismiss: toasts.dismiss }),
}))

const NOW = 1_000_000_000
const S1 = "s1" as ProjectId

const thread = (more: Partial<Listed> = {}): Listed => ({
  id: "t1",
  title: "Fix the list",
  mark: "done",
  changed: NOW - HOUR,
  pane: { kind: "agents.thread", args: { thread: "t1" } },
  ...more,
})

test("an archive is taken back by bringing the Thread back", () => {
  expect(undoOf("archive", thread(), NOW)).toEqual([
    { does: "archive", args: { archived: false } },
  ])
})

test("an archive of a Thread that slept puts it back to sleep as it slept, as archiving ended its Later", () => {
  const until = NOW + 2 * HOUR
  const asleep = (later: Listed["later"]) =>
    undoOf("archive", thread({ mark: "idle", later }), NOW)
  expect(asleep({ at: NOW - HOUR, until })).toEqual([
    { does: "archive", args: { archived: false } },
    { does: "later", args: { until } },
  ])
  expect(asleep({ at: NOW - HOUR, someday: true })).toEqual([
    { does: "archive", args: { archived: false } },
    { does: "later", args: { someday: true } },
  ])
  // Till its turn's end: a Later with no time.
  expect(asleep({ at: NOW - HOUR })).toEqual([
    { does: "archive", args: { archived: false } },
    { does: "later", args: { done: true } },
  ])
  // One that woke already sleeps no more: it is only brought back.
  expect(
    asleep({
      at: NOW - HOUR,
      until: NOW - 1,
      woke: { at: NOW - 1, by: "time" },
    })
  ).toEqual([{ does: "archive", args: { archived: false } }])
  expect(asleep({ at: NOW - 2 * HOUR, until: NOW - HOUR })).toEqual([
    { does: "archive", args: { archived: false } },
  ])
})

test("an Unarchive is taken back by archiving it again", () => {
  expect(undoOf("unarchive", thread({ archived: true }), NOW)).toEqual([
    { does: "archive", args: { archived: true } },
  ])
})

test("a Later wakes it again; a Later or a Wake of one that slept puts its Later back as it was", () => {
  expect(undoOf("later", thread(), NOW)).toEqual([{ does: "wake", args: {} }])
  const until = NOW + HOUR
  const slept = thread({ mark: "idle", later: { at: NOW - HOUR, until } })
  expect(undoOf("wake", slept, NOW)).toEqual([
    { does: "later", args: { until } },
  ])
  // Put off again to another time, it goes back to its first.
  expect(undoOf("later", slept, NOW)).toEqual([
    { does: "later", args: { until } },
  ])
  expect(
    undoOf("wake", thread({ later: { at: NOW, someday: true } }), NOW)
  ).toEqual([{ does: "later", args: { someday: true } }])
})

test("a mark as unread, or as read, is taken back by marking it the other way", () => {
  expect(undoOf("unread", thread(), NOW)).toEqual([
    { does: "unread", args: {} },
  ])
})

/** What takes back an archive of the Thread `id`. */
const archived = (id: string): Undoable => ({
  project: S1,
  listed: thread({ id }),
  steps: undoOf("archive", thread({ id }), NOW),
})

/** The options of the toast shown last. */
const lastToast = () => toasts.shown.mock.lastCall?.[1]

beforeEach(() => {
  toasts.shown.mockClear()
  toasts.dismiss.mockClear()
})
afterEach(() => {
  // The toast goes: it tells of none any more.
  lastToast()?.onAutoClose?.()
})

test("an archive is told in the one toast, which more archives add to; its Undo takes them all back (spec §2.6)", () => {
  const run = vi.fn()
  toldArchived(run, [archived("t1")])
  expect(toasts.shown).toHaveBeenLastCalledWith(
    "Archived",
    expect.objectContaining({ id: UNDO_TOAST, duration: 6000 })
  )
  expect(lastToast().action.label).toBe("Undo")
  toldArchived(run, [archived("t2")])
  toldArchived(run, [archived("t3")])
  expect(toasts.shown).toHaveBeenLastCalledWith(
    "Archived 3",
    expect.objectContaining({ id: UNDO_TOAST })
  )
  lastToast().action.onClick()
  expect(run.mock.calls).toEqual(
    ["t1", "t2", "t3"].map((item) => [
      "agents.archive",
      { project: S1, item, archived: false },
    ])
  )
  // Taken back, the next archive starts a toast of its own.
  toldArchived(run, [archived("t4")])
  expect(toasts.shown).toHaveBeenLastCalledWith("Archived", expect.anything())
})

test("a toast that went tells of no archive: the next one starts again at one", () => {
  const run = vi.fn()
  toldArchived(run, [archived("t1")])
  toldArchived(run, [archived("t2")])
  lastToast().onAutoClose()
  toldArchived(run, [archived("t3")])
  expect(toasts.shown).toHaveBeenLastCalledWith("Archived", expect.anything())
})

test("a ghost line's Undo takes back its own act, and the toast no longer tells of it", () => {
  const run = vi.fn()
  const one = archived("t1")
  const two = archived("t2")
  toldArchived(run, [one])
  toldArchived(run, [two])
  putBack(run, two)
  expect(run).toHaveBeenCalledWith("agents.archive", {
    project: S1,
    item: "t2",
    archived: false,
  })
  expect(toasts.shown).toHaveBeenLastCalledWith("Archived", expect.anything())
  // Its Undo then takes back only what it tells of.
  run.mockClear()
  lastToast().action.onClick()
  expect(run).toHaveBeenCalledTimes(1)
  expect(run).toHaveBeenCalledWith("agents.archive", {
    project: S1,
    item: "t1",
    archived: false,
  })
  // The last one taken back by its ghost line takes the toast away.
  toldArchived(run, [one])
  putBack(run, one)
  expect(toasts.dismiss).toHaveBeenCalledWith(UNDO_TOAST)
})

test("an act that was never told, as a Wake, is put back without a toast", () => {
  const run = vi.fn()
  const slept = thread({ later: { at: NOW, until: NOW + HOUR } })
  putBack(run, {
    project: S1,
    listed: slept,
    steps: undoOf("wake", slept, NOW),
  })
  expect(run).toHaveBeenCalledWith("agents.later", {
    project: S1,
    item: "t1",
    until: NOW + HOUR,
  })
  expect(toasts.shown).not.toHaveBeenCalled()
  expect(toasts.dismiss).not.toHaveBeenCalled()
})

/** What `run` was asked to bring back, by its items. */
const brought = (run: ReturnType<typeof vi.fn>) =>
  run.mock.calls.map(([, args]) => (args as { item: string }).item)

test("Ctrl+Z takes back the newest act kept, then the one before: 20 of them, each for 10 minutes, and no more (spec §2.7)", () => {
  const run = vi.fn()
  const acts = Array.from({ length: 21 }, (_, at) => archived(`t${at + 1}`))
  acts.forEach((done, at) => keep([done], NOW + at))
  // The newest first; the first of 21 was not kept.
  while (undoLast(run, NOW + 100));
  expect(brought(run)).toEqual(
    acts
      .slice(1)
      .reverse()
      .map((done) => done.listed.id)
  )
  expect(undoLast(run, NOW + 100)).toBeUndefined()

  // Ten minutes after it, an act is kept no more.
  run.mockClear()
  keep([archived("old")], NOW)
  keep([archived("new")], NOW + 1000)
  expect(undoLast(run, NOW + KEPT_FOR)?.[0]?.listed.id).toBe("new")
  expect(undoLast(run, NOW + KEPT_FOR)).toBeUndefined()
  expect(brought(run)).toEqual(["new"])
})

test("an act taken back by its toast or its ghost line is kept no more, and one Ctrl+Z took back the toast no longer tells of", () => {
  const run = vi.fn()
  const [one, two, three] = ["t1", "t2", "t3"].map(archived)
  for (const done of [one!, two!, three!]) {
    keep([done], NOW)
    toldArchived(run, [done])
  }
  // Ctrl+Z: the newest, and the toast tells of the other two.
  expect(undoLast(run, NOW)).toEqual([three])
  expect(toasts.shown).toHaveBeenLastCalledWith("Archived 2", expect.anything())
  // The ghost line's Undo takes back the second; the toast's the first.
  putBack(run, two!)
  lastToast().action.onClick()
  expect(brought(run)).toEqual(["t3", "t2", "t1"])
  expect(undoLast(run, NOW)).toBeUndefined()
})

test("an act on several cards at once is one: one Ctrl+Z takes it all back, and its toast says what it left, still selected (spec S10b)", () => {
  const run = vi.fn()
  const set = ["t1", "t2", "t3"].map(archived)
  keep([archived("before")], NOW)
  keep(set, NOW)
  toldArchived(run, set, "1 asks you, still selected")
  expect(toasts.shown).toHaveBeenLastCalledWith(
    "Archived 3 · 1 asks you, still selected",
    expect.objectContaining({ id: UNDO_TOAST })
  )
  // One Ctrl+Z, the whole set, and the toast goes with it.
  expect(undoLast(run, NOW)).toEqual(set)
  expect(brought(run)).toEqual(["t1", "t2", "t3"])
  expect(toasts.dismiss).toHaveBeenCalledWith(UNDO_TOAST)
  // The next takes back the act before it.
  run.mockClear()
  expect(undoLast(run, NOW)?.map((one) => one.listed.id)).toEqual(["before"])

  // A ghost line's Undo takes one card of the set back; Ctrl+Z, the rest.
  run.mockClear()
  const again = ["t4", "t5"].map(archived)
  keep(again, NOW)
  putBack(run, again[0]!)
  expect(undoLast(run, NOW)).toEqual([again[1]])
  expect(brought(run)).toEqual(["t4", "t5"])
  expect(undoLast(run, NOW)).toBeUndefined()
  // Nothing done is nothing kept.
  keep([], NOW)
  expect(undoLast(run, NOW)).toBeUndefined()
})
