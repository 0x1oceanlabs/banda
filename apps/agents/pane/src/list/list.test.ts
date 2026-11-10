import type { Engine, ProjectId, Refusal } from "@banda/contract"
import type {
  ListedThread,
  ThreadList,
  ThreadsDoing,
} from "@banda/contract/agents"
import { expect, test, vi } from "vitest"
import {
  applyThreads,
  type Doings,
  hearDoing,
  readsAgain,
  THREADS_FILTER,
  threadsSource,
  withDoing,
} from "./list"
import { listedOf } from "./rows"
import { agent, event, person } from "../testing"

const empty: ThreadList = { at: 0, threads: [] }

test("a new Thread joins the list once, with its Harness and Agent", () => {
  const started = event(
    "thread.started",
    { thread: "t1", title: "Hello", harness: "claude", agent: "a1" },
    { subject: "t1" }
  )
  const state = [started, started].reduce(applyThreads, empty)
  expect(state.threads).toEqual([
    {
      id: "t1",
      harness: "claude",
      agent: "a1",
      title: "Hello",
      updated_at: started.at,
      asking: [],
    },
  ])
})

test("a Thread from an older log names no Harness", () => {
  const started = event(
    "thread.started",
    { thread: "t1", agent: "a1", title: "Hello" },
    { subject: "t1" }
  )
  expect(applyThreads(empty, started).threads[0].harness).toBe("")
})

test("a Thread another Agent started names its parent, as it starts (ADR 0098, decision 24)", () => {
  const started = event(
    "thread.started",
    { thread: "t2", title: "Look around", agent: "a2", parent: "t1" },
    { author: agent, subject: "t2" }
  )
  expect(applyThreads(empty, started).threads[0].parent).toBe("t1")
  // One its Person started, or an older log's, names none.
  const own = event(
    "thread.started",
    { thread: "t3", title: "Hello", agent: "a3" },
    { subject: "t3" }
  )
  expect(applyThreads(empty, own).threads[0]).not.toHaveProperty("parent")
})

test("a child whose parent its Person deleted still names it, and lists as before (ADR 0098, decisions 14 and 24)", () => {
  const parent = event(
    "thread.started",
    { thread: "t1", title: "Plan", agent: "a1" },
    { subject: "t1" }
  )
  const child = event(
    "thread.started",
    { thread: "t2", title: "Look around", agent: "a2", parent: "t1" },
    { author: agent, subject: "t2" }
  )
  const deleted = event(
    "thread.deleted",
    { thread: "t1" },
    { author: person, subject: "t1" }
  )
  const left = [parent, child, deleted].reduce(applyThreads, empty)
  expect(left.threads.map((t) => t.id)).toEqual(["t2"])
  // A parent no list has now: the row carries its id as it came.
  expect(left.threads[0].parent).toBe("t1")
  expect(listedOf(left.threads[0], "Claude")).toMatchObject({
    id: "t2",
    parent: "t1",
  })
})

test("a Thread that hears a message moves to the top", () => {
  const state: ThreadList = {
    at: 2,
    threads: [
      {
        id: "t2",
        agent: "a2",
        harness: "fake",
        title: "Two",
        updated_at: 2,
        asking: [],
      },
      {
        id: "t1",
        agent: "a1",
        harness: "fake",
        title: "One",
        updated_at: 1,
        asking: [],
      },
    ],
  }
  const posted = event(
    "message.posted",
    { item: "m", turn: "u", text: "again" },
    { author: person, subject: "t1" }
  )
  const moved = applyThreads(state, posted)
  expect(moved.threads.map((t) => t.id)).toEqual(["t1", "t2"])
  expect(moved.threads[0].message).toBe("again")
  const growing = event(
    "reply.grew",
    { item: "r", turn: "u", text: "…" },
    { subject: "t1" }
  )
  expect(applyThreads(moved, growing)).toBe(moved)
})

const one: ThreadList = {
  at: 1,
  threads: [
    {
      id: "t1",
      agent: "a1",
      harness: "fake",
      title: "One",
      updated_at: 1,
      asking: [],
    },
  ],
}

/** `one`, below a newer Thread. */
const two: ThreadList = {
  at: 2,
  threads: [
    {
      id: "t2",
      agent: "a2",
      harness: "",
      title: "Two",
      updated_at: 2,
      asking: [],
    },
    ...one.threads,
  ],
}

test("a Thread keeps its latest turn that began, and how it ended", () => {
  const started = event("turn.started", { turn: "u1" }, { subject: "t1" })
  const running = applyThreads(one, started)
  expect(running.threads[0].latest).toEqual({
    turn: "u1",
    state: "running",
    began: started.at,
  })
  expect(running.threads[0].updated_at).toBe(1)

  const withdrawn = event(
    "turn.ended",
    { turn: "u2", state: "withdrawn" },
    { author: person, subject: "t1" }
  )
  expect(applyThreads(running, withdrawn)).toBe(running)

  const ended = event(
    "turn.ended",
    { turn: "u1", state: "failed", reason: "It broke.", note: "Tried twice." },
    { subject: "t1" }
  )
  const failed = applyThreads(running, ended)
  expect(failed.threads[0].latest).toEqual({
    turn: "u1",
    state: "failed",
    began: started.at,
    reason: "It broke.",
    note: "Tried twice.",
  })
  expect(failed.threads[0].updated_at).toBe(ended.at)
})

test("a Thread keeps how many lines its latest turn that ended changed, as that turn says it (ADR 0098, decision 8)", () => {
  const ended = (turn: string, more = {}) =>
    event("turn.ended", { turn, state: "done", ...more }, { subject: "t1" })
  const lines = { added: 38, removed: 9 }
  const edited = applyThreads(one, ended("u1", { changed_lines: lines }))
  expect(edited.threads[0].changed_lines).toEqual(lines)

  // A new turn running keeps the one before's; one taken back changes
  // nothing.
  const started = event("turn.started", { turn: "u2" }, { subject: "t1" })
  const running = applyThreads(edited, started)
  expect(running.threads[0].changed_lines).toEqual(lines)
  const withdrawn = ended("u3", { state: "withdrawn" })
  expect(applyThreads(running, withdrawn)).toBe(running)

  // A turn that changed no line says none, not the one before's.
  const answered = applyThreads(running, ended("u2"))
  expect(answered.threads[0]).not.toHaveProperty("changed_lines")
})

test("a Thread's Questions ask until they are answered or closed", () => {
  const asked = (item: string) =>
    event(
      "question.asked",
      { item, turn: "u1", title: "Which?", choices: [] },
      { subject: "t1" }
    )
  const asking = [asked("q1"), asked("q2"), asked("q1")].reduce(
    applyThreads,
    one
  )
  expect(asking.threads[0].asking).toEqual([
    { item: "q1", title: "Which?" },
    { item: "q2", title: "Which?" },
  ])

  const answered = event(
    "question.answered",
    { item: "q1", choice: "allow" },
    { author: person, subject: "t1" }
  )
  const closed = event("question.closed", { item: "q2" }, { subject: "t1" })
  const settled = [answered, closed].reduce(applyThreads, asking)
  expect(settled.threads[0].asking).toEqual([])
  expect(applyThreads(settled, closed)).toBe(settled)

  // A click answers one with choices and no form: the list keeps them.
  const allow = { id: "allow", name: "Allow", allows: true, always: false }
  const choosing = event(
    "question.asked",
    { item: "q3", turn: "u1", title: "Run it?", choices: [allow] },
    { subject: "t1" }
  )
  const form = event(
    "question.asked",
    { item: "q4", turn: "u1", title: "Which?", choices: [allow], form: [] },
    { subject: "t1" }
  )
  expect([choosing, form].reduce(applyThreads, one).threads[0].asking).toEqual([
    { item: "q3", title: "Run it?", choices: [allow] },
    { item: "q4", title: "Which?" },
  ])
})

test("a fact about a Thread the list does not have changes nothing", () => {
  const started = event("turn.started", { turn: "u" }, { subject: "t9" })
  expect(applyThreads(one, started)).toBe(one)
})

test("a Thread that goes back to before a message has the list read again", () => {
  const back = (thread: string) =>
    event("thread.rewound", { thread, turn: "u2" }, { subject: thread })
  expect(readsAgain(one, back("t1"))).toBe(true)
  expect(readsAgain(one, back("t2"))).toBe(false)
  // Only the engine knows the message before; the list alone keeps it.
  expect(applyThreads(one, back("t1"))).toBe(one)
})

test("a Thread its Person deleted leaves the list, wherever it stood (ADR 0098, decision 14)", () => {
  const deleted = (thread: string) =>
    event("thread.deleted", { thread }, { author: person, subject: thread })
  const gone = deleted("t2")
  const left = applyThreads(two, gone)
  expect(left.threads.map((t) => t.id)).toEqual(["t1"])
  expect(left.at).toBe(gone.seq)
  // The list drops it by itself, with nothing to read again; one it does
  // not have changes nothing.
  expect(readsAgain(two, gone)).toBe(false)
  expect(applyThreads(left, deleted("t2"))).toBe(left)
  expect(applyThreads(one, deleted("t9"))).toBe(one)
  expect(THREADS_FILTER.kinds).toContain("thread.deleted")
})

test("the Person's marks follow their facts, and move no Thread (ADR 0096)", () => {
  const mark = (kind: string, payload: object = {}) =>
    event(kind, { thread: "t1", ...payload }, { author: person, subject: "t1" })
  const seen = applyThreads(two, mark("thread.seen", { turn: "u1" }))
  expect(seen.threads.map((t) => t.id)).toEqual(["t2", "t1"])
  expect(seen.threads[1]).toMatchObject({ seen: "u1", updated_at: 1 })
  const later = applyThreads(seen, mark("thread.seen", { turn: "u2" }))
  expect(later.threads[1].seen).toBe("u2")
  const unseen = applyThreads(later, mark("thread.unseen"))
  expect(unseen.threads[1]).not.toHaveProperty("seen")
  // Nothing to take off: the same list.
  expect(applyThreads(unseen, mark("thread.unseen"))).toBe(unseen)

  // Archived in the host's time, the event's own.
  const put = mark("thread.archived")
  const archived = applyThreads(two, put)
  expect(archived.threads.map((t) => t.id)).toEqual(["t2", "t1"])
  expect(archived.threads[1]).toMatchObject({
    archived: { at: put.at },
    updated_at: 1,
  })
  const back = applyThreads(archived, mark("thread.unarchived"))
  expect(back.threads[1]).not.toHaveProperty("archived")
  expect(applyThreads(back, mark("thread.unarchived"))).toBe(back)

  // The list hears each of them.
  expect(THREADS_FILTER.kinds).toEqual(
    expect.arrayContaining([
      "thread.seen",
      "thread.unseen",
      "thread.archived",
      "thread.unarchived",
      "marks.moved",
    ])
  )
})

test("a window that moved its marks has every list read again", () => {
  const moved = event("marks.moved", {}, { author: person, subject: "p1" })
  expect(readsAgain(one, moved)).toBe(true)
  expect(readsAgain({ at: 0, threads: [] }, moved)).toBe(true)
  expect(applyThreads(one, moved)).toBe(one)
})

test("a Thread moved to another Project leaves this list, and the other reads itself again (ADR 0098)", () => {
  const left = (thread: string) =>
    event(
      "thread.left",
      { thread, to: "p2" },
      { author: person, subject: thread }
    )
  const out = left("t1")
  const gone = applyThreads(two, out)
  expect(gone.threads.map((t) => t.id)).toEqual(["t2"])
  expect(gone.at).toBe(out.seq)
  // One this list does not have changes nothing.
  expect(applyThreads(gone, left("t1"))).toBe(gone)
  const came = event(
    "thread.arrived",
    { thread: "t3", from: "p1" },
    { author: person, subject: "t3" }
  )
  expect(readsAgain(two, came)).toBe(true)
  expect(readsAgain(empty, came)).toBe(true)
  expect(THREADS_FILTER.kinds).toEqual(
    expect.arrayContaining(["thread.left", "thread.arrived"])
  )
})

test("a Thread keeps its latest Later, and what woke it", () => {
  const later = event(
    "thread.later",
    { thread: "t1", until: 5000 },
    { author: person, subject: "t1" }
  )
  const asleep = applyThreads(one, later)
  expect(asleep.threads[0].later).toEqual({
    at: later.at,
    by: person,
    until: 5000,
  })
  expect(asleep.threads[0].updated_at).toBe(one.threads[0].updated_at)

  const woke = event(
    "thread.woke",
    { thread: "t1", by: "question" },
    { subject: "t1" }
  )
  const awake = applyThreads(asleep, woke)
  expect(awake.threads[0].later?.woke).toEqual({
    at: woke.at,
    by: "question",
  })

  // Until done, it names no time; a new Later leaves the old waking.
  const again = event(
    "thread.later",
    { thread: "t1" },
    { author: agent, subject: "t1" }
  )
  expect(applyThreads(awake, again).threads[0].later).toEqual({
    at: again.at,
    by: agent,
  })

  // What its Person saw of it waking is its host's mark, and moves nothing.
  const seen = event(
    "thread.woke_seen",
    { thread: "t1", seen: "seen" },
    { author: person, subject: "t1" }
  )
  const looked = applyThreads(awake, seen)
  expect(looked.threads[0].later?.woke_seen).toBe("seen")
  expect(looked.threads[0].updated_at).toBe(awake.threads[0].updated_at)
  expect(
    applyThreads(one, seen).threads[0].later,
    "no Later, nothing to see"
  ).toBeUndefined()
})

test("a renamed Thread takes its new title and keeps the one before, where it stands", () => {
  const renamed = event(
    "thread.renamed",
    { thread: "t1", title: "Fix the list", was: "One" },
    { author: person, subject: "t1" }
  )
  const state = applyThreads(two, renamed)
  expect(state.threads.map((t) => t.id)).toEqual(["t2", "t1"])
  expect(state.threads[1]).toMatchObject({
    title: "Fix the list",
    was: "One",
    updated_at: one.threads[0].updated_at,
  })
})

test("a Thread that moves to another account lists it, and keeps its place", () => {
  const started = event(
    "thread.started",
    { thread: "t1", title: "a", harness: "claude-a" },
    { subject: "t1" }
  )
  const other = event(
    "thread.started",
    { thread: "t2", title: "b", harness: "codex" },
    { subject: "t2" }
  )
  const moved = event(
    "thread.switched",
    { thread: "t1", harness: "claude-b", was: "claude-a" },
    { subject: "t1" }
  )
  const list = [started, other, moved].reduce(applyThreads, {
    at: 0,
    threads: [],
  })
  expect(list.threads.map((t) => [t.id, t.harness])).toEqual([
    ["t2", "codex"],
    ["t1", "claude-b"],
  ])
})

test("the list's own read waits for no move of old marks: a Thread's writers and a popped-out window read at once", async () => {
  // A window with old marks whose move never started.
  vi.stubGlobal("localStorage", {
    getItem: (key: string) =>
      key === "banda.agents.seen" ? '{"t1":"u1"}' : null,
  })
  try {
    const asked: string[] = []
    const engine = {
      call: async (method: string) => {
        asked.push(method)
        return { at: 0, threads: [] }
      },
    } as unknown as Engine
    await threadsSource(engine, "p1" as ProjectId).read()
    expect(asked).toEqual(["agents.threads"])
  } finally {
    vi.unstubAllGlobals()
  }
})

/**
 * An engine whose `agents.threads` lists `list` and counts each read, and
 * whose `agents.doing` says what a test gives it: a reconnect hears the
 * stream again, so its first piece then names all at work anew.
 */
function doingEngine(list: ThreadList) {
  const reads: string[] = []
  const heard: { project: string; method: string }[] = []
  let say: (piece: ThreadsDoing) => void = () => {}
  let end: (refusal?: Refusal) => void = () => {}
  const engine = {
    call: async (method: string) => {
      reads.push(method)
      return list
    },
    stream: (
      project: string,
      method: string,
      _params: object,
      onPiece: (piece: ThreadsDoing) => void,
      onEnd: (refusal?: Refusal) => void
    ) => {
      heard.push({ project, method })
      say = onPiece
      end = onEnd
      return () => {}
    },
  } as unknown as Engine
  return {
    engine,
    reads,
    heard,
    say: (piece: ThreadsDoing) => say(piece),
    end: (refusal?: Refusal) => end(refusal),
  }
}

/** Two Threads at work, and one whose turn ended. */
const atWork: ThreadList = {
  at: 3,
  threads: (["t1", "t2", "t3"] as const).map((id): ListedThread => ({
    id,
    agent: `a-${id}`,
    harness: "fake",
    title: id,
    updated_at: 1,
    asking: [],
    latest: {
      turn: `u-${id}`,
      state: id === "t3" ? "done" : "running",
      began: 1,
    },
  })),
}

/** What `list`'s Threads do as the window lists them, by Thread. */
const doingOf = (threads: readonly ListedThread[]) =>
  Object.fromEntries(
    threads.map(({ id, doing, stepped, compacting, limit_until }) => [
      id,
      { doing, stepped, compacting, limit_until },
    ])
  )

test("what a Thread at work does merges into the list as agents.doing says it, and the list is not read again (ADR 0099, decision 11)", async () => {
  const project = "p1" as ProjectId
  const { engine, reads, heard, say } = doingEngine(atWork)
  const list = await threadsSource(engine, project).read()
  let doings: Doings | undefined
  hearDoing(engine, project, (now) => (doings = now))
  expect(heard).toEqual([{ project, method: "agents.doing" }])
  // Nothing said yet: the list stands as it was read.
  expect(withDoing(list.threads, doings)).toBe(list.threads)

  const execute = { what: "execute" as const, title: "pnpm test", since: 4 }
  say({
    all: true,
    threads: [
      { thread: "t1", doing: execute, stepped: 4 },
      { thread: "t2", stepped: 2 },
    ],
  })
  const first = withDoing(list.threads, doings)
  expect(doingOf(first)).toEqual({
    t1: { doing: execute, stepped: 4 },
    t2: { stepped: 2 },
    t3: {},
  })

  // A delta names only the Thread that changed; the others keep theirs.
  const think = { what: "think" as const, since: 6 }
  say({
    all: false,
    threads: [{ thread: "t1", doing: think, stepped: 6, compacting: true }],
  })
  const second = withDoing(list.threads, doings)
  expect(doingOf(second)).toEqual({
    t1: { doing: think, stepped: 6, compacting: true },
    t2: { stepped: 2 },
    t3: {},
  })
  expect(withDoing(second, doings), "said already: the same list").toBe(second)

  // Its turn ended: it does nothing, and nothing of before stays.
  say({ all: false, threads: [{ thread: "t1" }] })
  const ended = withDoing(second, doings)
  expect(doingOf(ended).t1).toEqual({})
  expect(ended[0]).not.toHaveProperty("compacting")

  expect(reads, "the stream never reads the list again").toEqual([
    "agents.threads",
  ])
})

test("a reconnect takes what agents.doing says anew: a Thread it no longer names does nothing", () => {
  const { engine, say, end } = doingEngine(atWork)
  let doings: Doings | undefined
  hearDoing(engine, "p1" as ProjectId, (now) => (doings = now))
  const limit = { what: "other" as const, since: 2 }
  say({
    all: true,
    threads: [
      { thread: "t1", doing: limit, stepped: 2, limit_until: 9000 },
      { thread: "t2", stepped: 2 },
    ],
  })
  // The connection broke and came back: the stream is heard from its
  // start, which names every Thread at work.
  say({ all: true, threads: [{ thread: "t2", stepped: 8 }] })
  expect(doingOf(withDoing(atWork.threads, doings))).toEqual({
    t1: {},
    t2: { stepped: 8 },
    t3: {},
  })

  // A Thread whose latest turn ended does nothing, whichever the window
  // hears first: the stream's end of it or the list's.
  say({ all: false, threads: [{ thread: "t3", stepped: 9 }] })
  expect(doingOf(withDoing(atWork.threads, doings)).t3).toEqual({})

  // An engine that ends the stream, or refuses it as an older one does,
  // leaves no Thread known to do anything: not even what the list read.
  const read = atWork.threads.map((thread) =>
    thread.latest?.state === "running" ? { ...thread, stepped: 1 } : thread
  )
  end({ code: "invalid", message: 'There is no method "agents.doing".' })
  expect(doingOf(withDoing(read, doings))).toEqual({ t1: {}, t2: {}, t3: {} })
  expect(withDoing(read, undefined), "before the stream says anything").toBe(
    read
  )
})
