import type { ProjectId } from "@banda/contract"
import { HOUR } from "@banda/ui/lib/words"
import type { Listed } from "@banda/ui/pane"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { archivedOf, toldArchived, UNDO_TOAST } from "./undo"

// Each step runs its Thread's App's item action, found by what it does.
vi.mock("../../window/items", () => ({
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

/** What takes back the archive of `listed`, its steps alone. */
const stepsOf = (listed: Listed) => archivedOf(S1, listed, NOW).steps

test("an archive is taken back by bringing the Thread back", () => {
  expect(stepsOf(thread())).toEqual([
    { does: "archive", args: { archived: false } },
  ])
})

test("an archive of a Thread that slept puts it back to sleep as it slept, as archiving ended its Later", () => {
  const until = NOW + 2 * HOUR
  const asleep = (later: Listed["later"]) =>
    stepsOf(thread({ mark: "idle", later }))
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

/** What takes back an archive of the Thread `id`. */
const archived = (id: string) => archivedOf(S1, thread({ id }), NOW)

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

test("Archive N done is one act: one Undo takes it all back, and its toast says what it left (ADR 0098, decision 15)", () => {
  const run = vi.fn()
  const set = ["t1", "t2", "t3"].map(archived)
  toldArchived(run, set, "1 not reached (mac is away)")
  expect(toasts.shown).toHaveBeenLastCalledWith(
    "Archived 3 · 1 not reached (mac is away)",
    expect.objectContaining({ id: UNDO_TOAST })
  )
  lastToast().action.onClick()
  expect(run.mock.calls.map(([, args]) => args.item)).toEqual([
    "t1",
    "t2",
    "t3",
  ])
})
