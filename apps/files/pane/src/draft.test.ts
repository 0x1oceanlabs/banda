import { Refused, Unreachable } from "@banda/contract"
import type { Written } from "@banda/contract/files"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import {
  Draft,
  draftKey,
  draftOf,
  holdDraft,
  textOf,
  WAIT,
  type Write,
} from "./draft"

/** A disk the draft writes to, as `files.write` does: over its hash
 * only, each write waiting until it is let through. */
function disk(text: string) {
  const hashOf = (text: string) => `#${text}`
  const state = { text, writes: [] as { text: string; base: string | null }[] }
  const waiting: (() => void)[] = []
  const write: Write = (text, base) => {
    state.writes.push({ text, base })
    return new Promise<Written>((done) =>
      waiting.push(() => {
        if (hashOf(state.text) === hashOf(text))
          return done({ kind: "written", hash: hashOf(text) })
        if (hashOf(state.text) !== base)
          return done({ kind: "moved", hash: hashOf(state.text) })
        state.text = text
        done({ kind: "written", hash: hashOf(text) })
      })
    )
  }
  return {
    state,
    write,
    /** Lets the oldest write waiting through. */
    async land() {
      waiting.shift()?.()
      await vi.advanceTimersByTimeAsync(0)
    },
    read: () => ({ text: state.text, hash: hashOf(state.text) }),
    hashOf,
  }
}

function draftOn(text: string) {
  const on = disk(text)
  const draft = new Draft({ write: on.write, changed: () => {} })
  draft.read(on.read())
  return { on, draft }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

test("a save goes once typing rests, over the hash read", async () => {
  const { on, draft } = draftOn("one\n")
  draft.type("one\nt")
  draft.type("one\ntwo")
  expect(draft.state.mine).toBe("one\ntwo")
  await vi.advanceTimersByTimeAsync(WAIT - 1)
  expect(on.state.writes).toEqual([])
  await vi.advanceTimersByTimeAsync(1)
  expect(on.state.writes).toEqual([{ text: "one\ntwo", base: "#one\n" }])
  expect(draft.state.saving).toBe(true)
  await on.land()
  expect(on.state.text).toBe("one\ntwo")
  expect(draft.state).toMatchObject({
    saving: false,
    mine: null,
    held: "one\ntwo",
    base: "#one\ntwo",
    reads: 1,
  })
  expect(draft.state.saved).not.toBeNull()
})

test("saves go one at a time and in order, each over the last one's hash", async () => {
  const { on, draft } = draftOn("a")
  draft.type("ab")
  draft.flush()
  // Typed while the first is under way, and asked for at once.
  draft.type("abc")
  draft.flush()
  draft.type("abcd")
  expect(on.state.writes).toHaveLength(1)
  await on.land()
  // The newest text goes next, once: not each step.
  expect(on.state.writes).toEqual([
    { text: "ab", base: "#a" },
    { text: "abcd", base: "#ab" },
  ])
  expect(draft.state.mine).toBe("abcd")
  await on.land()
  expect(on.state.text).toBe("abcd")
  expect(draft.state.mine).toBeNull()
  await vi.advanceTimersByTimeAsync(WAIT)
  expect(on.state.writes).toHaveLength(2)
})

test("text typed back to what is on disk needs no save, unless one is under way", async () => {
  const { on, draft } = draftOn("a")
  draft.type("ab")
  draft.type("a")
  expect(draft.state.mine).toBeNull()
  await vi.advanceTimersByTimeAsync(WAIT)
  expect(on.state.writes).toEqual([])
  draft.type("ab")
  draft.flush()
  draft.type("a")
  expect(draft.state.mine).toBe("a")
  await on.land()
  await vi.advanceTimersByTimeAsync(WAIT)
  await on.land()
  expect(on.state.text).toBe("a")
})

test("the last Pane to let go saves at once, and the draft is forgotten once saved", async () => {
  const on = disk("x")
  const key = draftKey("project", "/work/x.ts")
  const [draft, release] = holdDraft(key, on.write)
  const [again, releaseAgain] = holdDraft(key, on.write)
  expect(again).toBe(draft)
  draft.read(on.read())
  draft.type("xy")
  release()
  expect(on.state.writes).toEqual([])
  releaseAgain()
  expect(on.state.writes).toEqual([{ text: "xy", base: "#x" }])
  expect(draftOf(key)).toBe(draft)
  await on.land()
  expect(on.state.text).toBe("xy")
  expect(draftOf(key)).toBeUndefined()
})

test("a change on disk under no unsaved text is taken as it is", () => {
  const { on, draft } = draftOn("one")
  on.state.text = "theirs"
  draft.read(on.read())
  expect(draft.state).toMatchObject({
    held: "theirs",
    base: "#theirs",
    taken: 1,
    moved: null,
  })
})

test("a change on disk under unsaved text keeps it, and says the disk moved", async () => {
  const { on, draft } = draftOn("one")
  draft.type("mine")
  on.state.text = "theirs"
  draft.read(on.read())
  expect(draft.state.moved).toMatchObject({ hash: "#theirs" })
  expect(textOf(draft.state)).toBe("mine")
  // Nothing goes over theirs, typed or asked.
  draft.type("mine, more")
  draft.flush()
  await vi.advanceTimersByTimeAsync(WAIT)
  expect(on.state.writes).toEqual([])
  expect(on.state.text).toBe("theirs")
})

test("a save the disk moved under is refused, and keeps the Person's text", async () => {
  const { on, draft } = draftOn("one")
  draft.type("mine")
  on.state.text = "theirs"
  draft.flush()
  await on.land()
  expect(on.state.text).toBe("theirs")
  expect(draft.state.moved).toMatchObject({ hash: "#theirs" })
  expect(draft.state.mine).toBe("mine")
  expect(draft.state.reads).toBe(1)
})

test("keep mine writes the Person's text over the disk's new hash", async () => {
  const { on, draft } = draftOn("one")
  draft.type("mine")
  on.state.text = "theirs"
  draft.read(on.read())
  draft.keepMine()
  expect(on.state.writes).toEqual([{ text: "mine", base: "#theirs" }])
  await on.land()
  expect(on.state.text).toBe("mine")
  expect(draft.state).toMatchObject({ moved: null, mine: null })
})

test("take theirs drops the Person's text for the disk's", async () => {
  const { on, draft } = draftOn("one")
  draft.type("mine")
  on.state.text = "theirs"
  draft.read(on.read())
  draft.takeTheirs()
  expect(draft.state).toMatchObject({
    moved: null,
    mine: null,
    held: "theirs",
    base: "#theirs",
    taken: 1,
  })
  await vi.advanceTimersByTimeAsync(WAIT)
  expect(on.state.writes).toEqual([])
})

test("a read that comes while a save is under way waits for the read after it", async () => {
  const { on, draft } = draftOn("one")
  draft.type("two")
  draft.flush()
  // From before the save: no move.
  draft.read({ text: "one", hash: "#one" })
  expect(draft.state.moved).toBeNull()
  await on.land()
  draft.read(on.read())
  expect(draft.state).toMatchObject({ moved: null, mine: null, held: "two" })
})

test("a failed save says why, and goes again when asked", async () => {
  const on = disk("one")
  let fail = true
  const draft = new Draft({
    write: (text, base) =>
      fail
        ? Promise.reject(new Refused({ code: "conflict", message: "No room." }))
        : on.write(text, base),
    changed: () => {},
  })
  draft.read(on.read())
  draft.type("two")
  draft.flush()
  await vi.advanceTimersByTimeAsync(0)
  expect(draft.state).toMatchObject({ failed: "No room.", mine: "two" })
  fail = false
  draft.flush()
  await on.land()
  expect(on.state.text).toBe("two")
  expect(draft.state.failed).toBeNull()
})

test("a save that never left, as its machine is away, says so in the pill's words and keeps the text", async () => {
  const write: Write = () =>
    Promise.reject(new Unreachable("arc", "arc is away"))
  const draft = new Draft({ write, changed: () => {} })
  draft.read({ text: "one\n", hash: "#one\n" })
  draft.type("one\ntwo")
  await vi.advanceTimersByTimeAsync(WAIT)
  expect(draft.state.failed).toBe("arc is away")
  expect(draft.state.mine).toBe("one\ntwo")
})

test("a save that may have landed before its machine went does not say it stayed here", async () => {
  const write: Write = () =>
    Promise.reject(new Unreachable("arc", "arc is away").sent())
  const draft = new Draft({ write, changed: () => {} })
  draft.read({ text: "one\n", hash: "#one\n" })
  draft.type("one\ntwo")
  await vi.advanceTimersByTimeAsync(WAIT)
  expect(draft.state.failed).not.toBe("arc is away")
  expect(draft.state.mine).toBe("one\ntwo")
})
