import type { ProjectId } from "@banda/contract"
import { HOUR } from "@banda/ui/lib/words"
import type { Listed, Lists } from "@banda/ui/pane"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import {
  arrivals,
  callsSaid,
  GATHER,
  type Heard,
  standingsOf,
  tabSaid,
  teller,
  zeroSaid,
} from "./said"

const NOW = new Date(2026, 10, 11, 12, 0).getTime()
const P = "p1" as ProjectId

const thread = (id: string, more: Partial<Listed> = {}): Listed => ({
  id,
  title: `Thread ${id}`,
  mark: "done",
  changed: NOW - HOUR,
  pane: { kind: "agents.thread", args: { thread: id } },
  ...more,
})

const heard = (key: string, word: Heard["word"] = "Done"): Heard => ({
  key,
  title: `Thread ${key}`,
  word,
})

/** The calls between two lists of the one Project, by their keys, this
 * machine's, and words. */
const between = (before: Listed[], now: Listed[]) =>
  arrivals(
    standingsOf({ [P]: before } as Lists, NOW),
    standingsOf({ [P]: now } as Lists, NOW)
  ).map(({ key, title, word }) => [key, title, word])

/** Thread a's call, in `word`. */
const a = (word: Heard["word"]) => [[`:${P}:a`, "Thread a", word]]

test("each call is said in its card's word, and several in one line", () => {
  expect(callsSaid([heard("a", "Asks")])).toBe("Thread a asks you.")
  expect(callsSaid([heard("a", "Failed")])).toBe("Thread a failed.")
  expect(callsSaid([heard("a", "Done")])).toBe("Thread a is done.")
  expect(callsSaid([heard("a", "Woke")])).toBe("Thread a woke.")
  expect(callsSaid([heard("a"), heard("b"), heard("c")])).toBe(
    "3 new in Your turn."
  )
})

test("inbox zero is said in its own words, its middle dots made stops", () => {
  expect(zeroSaid({ working: 7, next: NOW + 6.5 * HOUR }, NOW)).toBe(
    "Inbox zero. Nothing waits for you. 7 at work. Next wakes at 18:30."
  )
  expect(zeroSaid({ working: 0 }, NOW)).toBe(
    "Inbox zero. Nothing waits for you. No Agent works now."
  )
  expect(zeroSaid({ working: 2, someday: 4 }, NOW)).toBe(
    "Inbox zero. Nothing waits for you. 2 at work. 4 someday."
  )
})

test("a tab shown by its key says how many it holds", () => {
  expect(tabSaid("later", 5)).toBe("Later, 5 Threads")
  expect(tabSaid("inbox", 1)).toBe("Inbox, 1 Thread")
  expect(tabSaid("archive", 0)).toBe("Archive, no Threads")
})

test("a call comes as its work ends, as it asks another way, and as it wakes by itself; not by the Person's Unread or Unarchive, nor from a list just come", () => {
  const working = thread("a", { mark: "working" })
  expect(between([working], [thread("a")])).toEqual(a("Done"))
  expect(between([working], [thread("a", { mark: "asking" })])).toEqual(
    a("Asks")
  )
  // Still done: no news.
  expect(between([thread("a")], [thread("a")])).toEqual([])
  // Asked, then failed in Your turn.
  expect(
    between(
      [thread("a", { mark: "asking" })],
      [thread("a", { mark: "failed" })]
    )
  ).toEqual(a("Failed"))
  // Woke from Later by itself.
  const later = { at: NOW - 2 * HOUR, until: NOW + HOUR }
  const woke = {
    at: NOW - 2 * HOUR,
    until: NOW - 1,
    woke: { at: NOW - 1, by: "time" as const },
  }
  expect(
    between([thread("a", { later })], [thread("a", { later: woke })])
  ).toEqual(a("Woke"))
  // Woken by the Person, it calls as it did: no news.
  expect(between([thread("a", { later })], [thread("a")])).toEqual([])
  // Brought back from the Archive, or marked unread from Open.
  expect(between([thread("a", { archived: true })], [thread("a")])).toEqual([])
  expect(between([thread("a", { mark: "idle" })], [thread("a")])).toEqual([])
  // A machine's list just come says what was there already.
  expect(between([], [thread("a")])).toEqual([])
})

let spoken: string[]
let listening: boolean
let quiet: boolean
const ears = () => ({
  listening: () => listening,
  quiet: () => quiet,
  speak: (line: string) => spoken.push(line),
})

beforeEach(() => {
  vi.useFakeTimers()
  spoken = []
  listening = true
  quiet = false
})
afterEach(() => {
  vi.useRealTimers()
})

test("the calls of 2 s are told in one line, a Thread once by its last word, from the first; the next starts again", () => {
  const told = teller(ears())
  told.calls([heard("a", "Asks")])
  vi.advanceTimersByTime(GATHER - 1)
  expect(spoken).toEqual([])
  vi.advanceTimersByTime(1)
  expect(spoken).toEqual(["Thread a asks you."])

  told.calls([heard("a")])
  vi.advanceTimersByTime(1000)
  told.calls([heard("b"), heard("a", "Failed")])
  vi.advanceTimersByTime(999)
  told.calls([heard("c")])
  vi.advanceTimersByTime(1)
  expect(spoken).toEqual(["Thread a asks you.", "3 new in Your turn."])
  // A Thread heard again is one call.
  told.calls([heard("d")])
  told.calls([heard("d", "Failed")])
  vi.advanceTimersByTime(GATHER)
  expect(spoken.at(-1)).toBe("Thread d failed.")
})

test("silent outside the sidebar: calls heard there are dropped, and so are those gathered once the focus left", () => {
  const told = teller(ears())
  listening = false
  told.calls([heard("a")])
  told.say("Later, 5 Threads")
  vi.advanceTimersByTime(GATHER)
  expect(spoken).toEqual([])

  listening = true
  told.calls([heard("b")])
  listening = false
  vi.advanceTimersByTime(GATHER)
  expect(spoken).toEqual([])

  listening = true
  told.say("Later, 5 Threads")
  expect(spoken).toEqual(["Later, 5 Threads"])
})

test("Quiet silences the call lines, and only them", () => {
  const told = teller(ears())
  quiet = true
  told.calls([heard("a")])
  vi.advanceTimersByTime(GATHER)
  expect(spoken).toEqual([])
  // Quiet comes while they gather.
  quiet = false
  told.calls([heard("b")])
  quiet = true
  vi.advanceTimersByTime(GATHER)
  expect(spoken).toEqual([])
  told.say("Inbox zero. Nothing waits for you. No Agent works now.")
  expect(spoken).toEqual([
    "Inbox zero. Nothing waits for you. No Agent works now.",
  ])
})
