import type { MarkState } from "@banda/ui/components/banda-mark"
import type { Listed } from "@banda/ui/pane"
import { expect, test } from "vitest"
import { DAY } from "@banda/ui/lib/words"
import { archivable, cutoff, isArchived } from "./archived"

const NOW = 1_000_000_000_000

const listed = (mark: MarkState, changed: number): Listed => ({
  id: "t",
  title: "t",
  mark,
  changed,
  pane: { kind: "agents.thread", args: { thread: "t" } },
})

/** A Storage held in memory, as a window's. */
function storage(items: Record<string, string> = {}): Storage {
  const held = new Map(Object.entries(items))
  return {
    get length() {
      return held.size
    },
    clear: () => held.clear(),
    getItem: (key) => held.get(key) ?? null,
    key: (n) => [...held.keys()][n] ?? null,
    removeItem: (key) => void held.delete(key),
    setItem: (key, value) => void held.set(key, value),
  }
}

test("quiet days archive nothing by themselves", () => {
  expect(isArchived(listed("rest", NOW - 40 * DAY), undefined, 0)).toBe(false)
  expect(isArchived(listed("done", NOW - 4 * DAY), undefined, 0)).toBe(false)
})

test("what the Person said holds until something new happens", () => {
  const put = { archived: true, at: NOW - DAY }
  expect(isArchived(listed("rest", NOW - 2 * DAY), put, 0)).toBe(true)
  // A new message, a turn that ended: it is back.
  expect(isArchived(listed("done", NOW - 1), put, 0)).toBe(false)

  const back = { archived: false, at: NOW - DAY }
  expect(isArchived(listed("rest", NOW - 5 * DAY), back, NOW)).toBe(false)
})

test("work going on is never archived, nor can be", () => {
  const put = { archived: true, at: NOW }
  expect(isArchived(listed("running", NOW - 5 * DAY), put, 0)).toBe(false)
  expect(archivable(listed("running", NOW))).toBe(false)
  expect(archivable(listed("asking", NOW))).toBe(false)
  expect(archivable(listed("done", NOW))).toBe(true)
})

test("what the three days had archived stays archived, once", () => {
  const held = storage({ "banda.sidebar.width": "16" })
  const before = cutoff(held, NOW)
  expect(before).toBe(NOW - 3 * DAY)
  // Quiet since before the change: archived still; newer: in the list.
  expect(isArchived(listed("rest", NOW - 4 * DAY), undefined, before)).toBe(
    true
  )
  expect(isArchived(listed("rest", NOW - 2 * DAY), undefined, before)).toBe(
    false
  )
  // Something new in it brings it back, as before.
  expect(isArchived(listed("done", NOW + DAY), undefined, before)).toBe(false)
  // The moment is kept: days later, it is the same.
  expect(cutoff(held, NOW + 10 * DAY)).toBe(before)
})

test("a window that never had the three days archives nothing by them", () => {
  const held = storage()
  expect(cutoff(held, NOW)).toBe(0)
  expect(cutoff(held, NOW + DAY)).toBe(0)
})
