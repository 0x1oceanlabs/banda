import {
  type CommandOptions,
  type Engine,
  Lost,
  type ProjectId,
  Refused,
  type Status,
} from "@banda/contract"
import type { ListedThread, ThreadList } from "@banda/contract/agents"
import { Unreachable } from "@banda/core/react"
import { beforeEach, expect, test, vi } from "vitest"
import { attentionOf } from "@banda/ui/status"
import { applyThreads } from "./list"
import { listedOf } from "./rows"
import { event, person } from "../testing"

const said = vi.hoisted(() => ({ errors: [] as string[] }))
vi.mock("@banda/ui/components/sonner", () => ({
  toast: { error: (words: string) => void said.errors.push(words) },
}))

const { mark, sendingTo, settle, shown } = await import("./sent")

beforeEach(() => void (said.errors = []))

const PROJECT = "p1" as ProjectId

/** A Thread whose latest turn, `u1`, is done, changed at 5. */
const thread = (more: Partial<ListedThread> = {}): ListedThread => ({
  id: "t1",
  agent: "a1",
  harness: "fake",
  title: "One",
  updated_at: 5,
  asking: [],
  latest: { turn: "u1", state: "done", began: 4 },
  ...more,
})

const list = (at: number, ...threads: ListedThread[]): ThreadList => ({
  at,
  threads,
})

/** A command's answer, held until the test gives it. */
type Held = {
  method: string
  params: unknown
  command: string
  /** How it goes: each mark is sent `once`. */
  options: CommandOptions | undefined
  answer: (at: number | null) => void
  refuse: (error: Error) => void
}

/** What an engine that said goodbye says. */
const OLDER = { code: "protocol", message: "This window is older." } as const

/** Why arc is out of reach, as its engine says it while away. */
const ARC_AWAY = new Unreachable("arc", "arc is away")

/**
 * An engine in `state`, whose commands wait for the test to answer them;
 * `go` changes its state, as a connection that breaks. As the engine
 * sends a command `once`: refused at once while it is not open, never
 * sent, and failed as the connection breaks, or as its machine goes,
 * where it may have run.
 */
function engineIn(state: Status["state"] = "open") {
  const asked: Held[] = []
  const watchers = new Set<(status: Status) => void>()
  const statusOf = (state: Status["state"]) =>
    (state === "refused" ? { state, refusal: OLDER } : { state }) as Status
  let status = statusOf(state)
  const engine = {
    get status() {
      return status
    },
    watch: (watcher: (status: Status) => void) => {
      watchers.add(watcher)
      watcher(status)
      return () => watchers.delete(watcher)
    },
    commandAt: (
      method: string,
      params: unknown,
      _: ProjectId,
      command: string,
      options?: CommandOptions
    ) => {
      if (status.state === "away") return Promise.reject(ARC_AWAY)
      if (status.state === "refused") return Promise.reject(new Refused(OLDER))
      if (options?.once && status.state !== "open")
        return Promise.reject(new Lost())
      return new Promise((resolve, reject) =>
        asked.push({
          method,
          params,
          command,
          options,
          answer: (at) => resolve({ answer: null, at }),
          refuse: reject,
        })
      )
    },
  } as unknown as Engine
  const go = (state: Status["state"]) => {
    status = statusOf(state)
    if (state !== "open")
      for (const { options, refuse } of asked)
        if (options?.once)
          refuse(state === "away" ? ARC_AWAY.sent() : new Lost())
    for (const watcher of [...watchers]) watcher(status)
  }
  return { engine, asked, go }
}

/** What the list shows of Thread t1 with what is on its way to `engine`. */
const shownOf = (engine: Engine, listed: ThreadList) =>
  shown(listed.threads, sendingTo(engine))[0]

test("each mark goes to its host as its command, sent once", () => {
  const { engine, asked } = engineIn()
  void mark(engine, PROJECT, "t1", { seen: "u1" })
  void mark(engine, PROJECT, "t2", { seen: "latest" })
  void mark(engine, PROJECT, "t3", { seen: null })
  void mark(engine, PROJECT, "t4", { archived: true })
  void mark(engine, PROJECT, "t5", { archived: false })
  void mark(engine, PROJECT, "t6", { woke: "seen" })
  expect(asked.map(({ method, params }) => [method, params])).toEqual([
    ["agents.read", { thread: "t1", turn: "u1" }],
    ["agents.read", { thread: "t2" }],
    ["agents.unread", { thread: "t3" }],
    ["agents.archive", { thread: "t4" }],
    ["agents.unarchive", { thread: "t5" }],
    ["agents.see_woke", { thread: "t6", seen: "seen" }],
  ])
  // None goes again after a break, to land once its toast said it failed
  // (decision 8).
  expect(asked.map(({ options }) => options)).toEqual(
    asked.map(() => ({ once: true }))
  )
})

test("what was sent shows at once, and marks only the turn it names while it is the latest", () => {
  const { engine } = engineIn()
  void mark(engine, PROJECT, "t1", { seen: "u1" })
  expect(shownOf(engine, list(1, thread()))).toMatchObject({ seen: "u1" })
  // A Pane heard the turn end before the list did: it shows as it works.
  const running = thread({ latest: { turn: "u1", state: "running", began: 4 } })
  expect(shownOf(engine, list(1, running)).seen).toBe("u1")
  // A turn that began since is not the one seen.
  const later = thread({ latest: { turn: "u2", state: "done", began: 6 } })
  expect(shownOf(engine, list(1, later)).seen).toBeUndefined()

  void mark(engine, PROJECT, "t1", { seen: null })
  expect(shownOf(engine, list(1, thread({ seen: "u1" }))).seen).toBeUndefined()
})

test("an archive shows from when the Thread last changed, and moves nothing", () => {
  const { engine } = engineIn()
  const two = [thread(), thread({ id: "t2", updated_at: 9 })]
  void mark(engine, PROJECT, "t1", { archived: true })
  const archived = shown(two, sendingTo(engine))
  expect(archived.map(({ id }) => id)).toEqual(["t1", "t2"])
  expect(archived[0]).toEqual({ ...thread(), archived: { at: 5 } })
  // The other is the same Thread, untouched.
  expect(archived[1]).toBe(two[1])
  // One whose archive holds already stays the same.
  const held = thread({ archived: { at: 7 } })
  expect(shownOf(engine, list(1, held))).toBe(held)
  void mark(engine, PROJECT, "t1", { archived: false })
  expect(shownOf(engine, list(1, held)).archived).toBeUndefined()
})

test("where nothing is on its way, the list is the host's, the same one", () => {
  const { engine } = engineIn()
  const threads = [thread()]
  expect(shown(threads, sendingTo(engine))).toBe(threads)
  void mark(engine, PROJECT, "t2", { seen: null })
  expect(shown(threads, sendingTo(engine))).toBe(threads)
})

test("a mark shows until the list heard its command, whether the answer or the fact comes first", async () => {
  const { engine, asked } = engineIn()
  // The answer first: the list still stands before it.
  const first = mark(engine, PROJECT, "t1", { seen: null })
  asked[0]!.answer(10)
  expect(await first).toBe(true)
  const before = list(9, thread({ seen: "u1" }))
  settle(engine, before)
  expect(shownOf(engine, before).seen).toBeUndefined()
  // Its fact: the list holds it, and the mark has nothing more to say.
  const fact = event(
    "thread.unseen",
    { thread: "t1" },
    { author: person, subject: "t1" }
  )
  const unseen = applyThreads(before, fact)
  expect(unseen.at).toBe(fact.seq)
  // As the host has it: the fact at 10.
  const heard = { ...unseen, at: 10 }
  settle(engine, heard)
  expect(sendingTo(engine)).toEqual({})

  // The fact first: the mark stays until its answer says where it wrote.
  const second = mark(engine, PROJECT, "t1", { archived: true })
  const archived = list(20, thread({ archived: { at: 5 } }))
  settle(engine, archived)
  expect(sendingTo(engine).t1?.archived?.to).toBe(true)
  asked[1]!.answer(20)
  await second
  settle(engine, archived)
  expect(sendingTo(engine)).toEqual({})
})

test("a command that wrote nothing has nothing to wait for", async () => {
  const { engine, asked } = engineIn()
  // An older turn than the one seen, as another window marked it since.
  const sent = mark(engine, PROJECT, "t1", { seen: "u0" })
  asked[0]!.answer(null)
  expect(await sent).toBe(true)
  expect(sendingTo(engine)).toEqual({})
})

test("a fresh read of the list, as after a rewind, stands where the log does", async () => {
  const { engine, asked } = engineIn()
  const sent = mark(engine, PROJECT, "t1", { archived: false })
  asked[0]!.answer(7)
  await sent
  settle(engine, list(6, thread()))
  expect(sendingTo(engine).t1).toBeDefined()
  settle(engine, list(30, thread()))
  expect(sendingTo(engine)).toEqual({})
})

test("only a list the fact changed moves where it stands", () => {
  const one = list(3, thread())
  // A fact of a Thread the list does not hold changes nothing.
  const other = event(
    "thread.renamed",
    { thread: "t9", title: "x", was: "" },
    {
      subject: "t9",
    }
  )
  expect(applyThreads(one, other)).toBe(one)
  const renamed = event(
    "thread.renamed",
    { thread: "t1", title: "Two", was: "One" },
    {
      subject: "t1",
    }
  )
  expect(applyThreads(one, renamed).at).toBe(renamed.seq)
})

test("Mark as read marks the turn the list shows, not one that begins and ends after", async () => {
  const { engine, asked } = engineIn()
  void mark(engine, PROJECT, "t1", { seen: "latest" })
  settle(engine, list(1, thread()))
  expect(sendingTo(engine).t1?.seen?.to).toBe("u1")
  // A turn began and ended before the mark's fact came: it is not seen.
  const later = list(
    2,
    thread({ latest: { turn: "u2", state: "done", began: 6 } })
  )
  expect(shownOf(engine, later).seen).toBeUndefined()
  asked[0]!.answer(3)

  // One the Thread works on already marks nothing here.
  const { engine: other } = engineIn()
  void mark(other, PROJECT, "t1", { seen: "latest" })
  const working = list(
    1,
    thread({ latest: { turn: "u2", state: "running", began: 6 } })
  )
  settle(other, working)
  expect(sendingTo(other)).toEqual({})
})

test("a host away is sent nothing and keeps nothing: a menu's mark says so, the window's own is quiet", async () => {
  for (const state of ["connecting", "lost", "refused"] as const) {
    const { engine, asked } = engineIn(state)
    expect(await mark(engine, PROJECT, "t1", { archived: true })).toBe(false)
    expect(
      await mark(engine, PROJECT, "t1", { seen: "u1" }, { quiet: true })
    ).toBe(false)
    expect(asked).toEqual([])
    expect(sendingTo(engine)).toEqual({})
  }
  expect(said.errors).toEqual([
    "Banda lost its engine for a moment. Try again.",
    "Banda lost its engine for a moment. Try again.",
    "This window is older.",
  ])
})

test("a mark to a machine out of reach is sent nothing, and its toast names the machine and the mark; one on its way as the machine went may have gone through", async () => {
  const { engine, asked, go } = engineIn("away")
  expect(await mark(engine, PROJECT, "t1", { archived: true })).toBe(false)
  expect(await mark(engine, PROJECT, "t1", { seen: null })).toBe(false)
  expect(
    await mark(engine, PROJECT, "t1", { seen: "u1" }, { quiet: true })
  ).toBe(false)
  expect(asked).toEqual([])
  expect(sendingTo(engine)).toEqual({})
  // Back, and gone again before it answers: taken back, and said so.
  go("open")
  const sent = mark(engine, PROJECT, "t1", { archived: false })
  expect(sendingTo(engine).t1).toBeDefined()
  go("away")
  expect(await sent).toBe(false)
  expect(sendingTo(engine)).toEqual({})
  expect(said.errors).toEqual([
    "arc is away: Archive was not sent.",
    "arc is away: Mark as unread was not sent.",
    "arc went away; Unarchive may have gone through.",
  ])
})

test("a host that goes before it answers takes the mark back, and says so once", async () => {
  const { engine, asked, go } = engineIn()
  const sent = mark(engine, PROJECT, "t1", { seen: null })
  expect(sendingTo(engine).t1).toBeDefined()
  go("lost")
  expect(await sent).toBe(false)
  expect(sendingTo(engine)).toEqual({})
  expect(said.errors).toEqual([
    "Banda lost its engine for a moment. Try again.",
  ])
  // Sent once, its command fails too, as the engine does not send it
  // again once the host is back: the mark the toast called failed does
  // not land later (decision 8). That Lost changes nothing here.
  asked[0]!.refuse(new Lost())
  go("open")
  await Promise.resolve()
  expect(sendingTo(engine)).toEqual({})
  expect(said.errors).toHaveLength(1)

  // The window's own seen goes as quietly.
  const quiet = engineIn()
  const seen = mark(
    quiet.engine,
    PROJECT,
    "t1",
    { seen: "u1" },
    { quiet: true }
  )
  quiet.go("lost")
  expect(await seen).toBe(false)
  expect(said.errors).toHaveLength(1)
})

test("a refusal takes back its own mark alone, and says why; a quiet one says nothing", async () => {
  const { engine, asked } = engineIn()
  const first = mark(engine, PROJECT, "t1", { archived: true })
  // Brought back before the host answered: the later mark is the one shown.
  const second = mark(engine, PROJECT, "t1", { archived: false })
  asked[0]!.refuse(new Error("at work"))
  expect(await first).toBe(false)
  expect(said.errors).toEqual(["Something went wrong. Try again."])
  expect(sendingTo(engine).t1?.archived?.to).toBe(false)
  asked[1]!.refuse(new Error("no"))
  expect(await second).toBe(false)
  expect(sendingTo(engine)).toEqual({})

  const seen = mark(engine, PROJECT, "t1", { seen: "u1" }, { quiet: true })
  asked[2]!.refuse(new Error("unknown method"))
  expect(await seen).toBe(false)
  expect(said.errors).toHaveLength(2)
})

test("a mark refused at once leaves an earlier one of its kind, answered and waiting for its fact, as it was", async () => {
  const { engine, asked, go } = engineIn()
  const unread = mark(engine, PROJECT, "t1", { seen: null })
  asked[0]!.answer(12)
  expect(await unread).toBe(true)
  const waiting = sendingTo(engine).t1
  expect(waiting?.seen).toMatchObject({ to: null, at: 12 })
  // The connection breaks before its fact comes: Mark as read, and the
  // window's own seen, are refused at once, and the Thread stays unread.
  go("lost")
  expect(await mark(engine, PROJECT, "t1", { seen: "latest" })).toBe(false)
  expect(
    await mark(engine, PROJECT, "t1", { seen: "u1" }, { quiet: true })
  ).toBe(false)
  expect(sendingTo(engine).t1).toBe(waiting)
  expect(shownOf(engine, list(11, thread({ seen: "u1" }))).seen).toBeUndefined()
})

test("an earlier mark's answer never stands for a later one's", async () => {
  const { engine, asked } = engineIn()
  // The window marks the turn seen; the Person marks it unread at once.
  const seen = mark(engine, PROJECT, "t1", { seen: "u1" }, { quiet: true })
  const unread = mark(engine, PROJECT, "t1", { seen: null })
  asked[0]!.answer(5)
  await seen
  expect(sendingTo(engine).t1?.seen).toMatchObject({ to: null })
  expect(sendingTo(engine).t1?.seen?.at).toBeUndefined()
  // The list hears the seen: unread still shows, until its own fact.
  const heardSeen = list(5, thread({ seen: "u1" }))
  settle(engine, heardSeen)
  expect(shownOf(engine, heardSeen).seen).toBeUndefined()
  asked[1]!.answer(6)
  await unread
  settle(engine, heardSeen)
  expect(shownOf(engine, heardSeen).seen).toBeUndefined()
  settle(engine, list(6, thread()))
  expect(sendingTo(engine)).toEqual({})
})

test("each host's marks are its own, though two hosts have a Thread of one ID", () => {
  const here = engineIn()
  const arc = engineIn()
  void mark(arc.engine, PROJECT, "t1", { archived: true })
  expect(sendingTo(here.engine)).toEqual({})
  expect(shownOf(here.engine, list(1, thread())).archived).toBeUndefined()
  expect(shownOf(arc.engine, list(1, thread())).archived).toEqual({ at: 5 })
  // Settling this machine's list leaves arc's mark as it is.
  settle(here.engine, list(99, thread()))
  expect(sendingTo(arc.engine).t1).toBeDefined()
})

test("settling what holds nothing new changes nothing", () => {
  const { engine } = engineIn()
  void mark(engine, PROJECT, "t1", { archived: true })
  const before = sendingTo(engine)
  settle(engine, list(99, thread()))
  settle(engine, list(99, thread({ id: "t2" })))
  expect(sendingTo(engine)).toBe(before)
})

test("the bar's Mark, the waiting count and the rows follow what was sent, as the Watch reports them", () => {
  const { engine } = engineIn()
  const failed = thread({
    id: "t2",
    latest: { turn: "u2", state: "failed", began: 4 },
    seen: "u2",
  })
  const threads = [thread({ seen: "u1" }), failed]
  const report = () => {
    const listed = shown(threads, sendingTo(engine)).map((one) =>
      listedOf(one, "Fake AI")
    )
    return {
      ...attentionOf({ [PROJECT]: listed }, 0),
      marks: listed.map((one) => one.mark),
    }
  }
  expect(report()).toEqual({
    mark: "rest",
    waiting: 0,
    marks: ["rest", "rest"],
  })
  // Marked unread: both are the Person's turn again.
  void mark(engine, PROJECT, "t1", { seen: null })
  void mark(engine, PROJECT, "t2", { seen: null })
  expect(report()).toEqual({
    mark: "failed",
    waiting: 2,
    marks: ["done", "failed"],
  })
})

test("what its Person saw of a Thread waking shows at once, forward only", async () => {
  const { engine, asked } = engineIn()
  const person = { kind: "person", id: "p1" } as const
  const later = { at: 1, by: person, until: 2 }
  void mark(engine, PROJECT, "t1", { woke: "seen" })
  expect(shownOf(engine, list(1, thread({ later }))).later).toEqual({
    ...later,
    woke_seen: "seen",
  })
  // Nothing to see without a Later, and a dismissal is never taken back.
  const quiet = thread()
  expect(shownOf(engine, list(1, quiet))).toBe(quiet)
  const dismissed = thread({ later: { ...later, woke_seen: "dismissed" } })
  expect(shownOf(engine, list(1, dismissed))).toBe(dismissed)
  // Once the list heard its command, the host's mark is all there is.
  asked[0].answer(7)
  await vi.waitFor(() => expect(sendingTo(engine).t1?.woke?.at).toBe(7))
  settle(engine, list(7, thread({ later })))
  expect(sendingTo(engine).t1).toBeUndefined()
})
