import type { Engine, ProjectId, ProjectSummary, Status } from "@banda/contract"
import type { ImportMarks, ListedThread } from "@banda/contract/agents"
import { works } from "@banda/ui/components/banda-mark"
import { DAY } from "@banda/ui/lib/words"
import type { Listed } from "@banda/ui/pane"
import { expect, test, vi } from "vitest"
import {
  holdCutoff,
  marksOf,
  Move,
  MOVE_WAIT,
  moveMarks,
  type OldMarks,
  oldMarks,
  unreadOf,
} from "./marks-moved"
import { listedOf } from "./rows"

/**
 * The window's rule as it stood before the flip (`isArchived` of
 * `client/web/src/sidebar/archived.ts`), word for word over a row: what
 * the frozen copy is held to, as that rule is gone from the window.
 */
function wasArchived(
  listed: Listed,
  say: { archived: boolean; at: number } | undefined,
  before: number
): boolean {
  if (works(listed.mark) || listed.mark === "asking") return false
  if ((listed.snooze?.at ?? -Infinity) > (say?.at ?? before)) return false
  if (say && listed.changed <= say.at) return say.archived
  return listed.changed <= before
}

const NOW = 1_000_000_000_000

/** IDs as Banda makes them. */
const id = (n: number) =>
  `0196f000-0000-7000-8000-${String(n).padStart(12, "0")}`
const [T1, T2, T3, T4, T5, T6] = [1, 2, 3, 4, 5, 6].map(id)
const [U1, U2] = [11, 12].map(id)
const [P1, P2, P3] = [21, 22, 23].map(id)

/** A Storage held in memory, as a window's. */
function storage(items: Record<string, unknown> = {}): Storage {
  const held = new Map(
    Object.entries(items).map(([key, value]) => [
      key,
      typeof value === "string" ? value : JSON.stringify(value),
    ])
  )
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

const thread = (
  id: string,
  changed: number,
  more: Partial<ListedThread> = {}
): ListedThread => ({
  id,
  agent: "a",
  harness: "fake",
  title: id,
  updated_at: changed,
  asking: [],
  latest: { turn: U1, state: "done", began: changed - 1 },
  ...more,
})

test("a Project sends its Threads' seen, and what the old rules show archived", () => {
  const held = storage({
    "banda.agents.seen": { [T1]: U1, [T6]: U2 },
    "banda.sidebar.archived": {
      [T1]: { archived: true, at: NOW - DAY },
      [T2]: { archived: true, at: NOW - DAY },
      [T3]: { archived: false, at: NOW - DAY },
      [T5]: { archived: true, at: NOW - 3 * DAY },
    },
    "banda.sidebar.archived-before": String(NOW - 10 * DAY),
  })
  const threads = [
    // Archived, and nothing new since.
    thread(T1, NOW - 2 * DAY),
    // Archived, but a turn ended after: back.
    thread(T2, NOW - 1),
    // Brought back, though the cutoff alone would archive it.
    thread(T3, NOW - 20 * DAY),
    // Nothing said: the three quiet days had archived it.
    thread(T4, NOW - 20 * DAY),
    // Snoozed after it was archived: out of Archive (ADR 0074).
    thread(T5, NOW - 4 * DAY, {
      snooze: { at: NOW - 2 * DAY, by: { kind: "person", id: "p" } },
    }),
  ]
  expect(marksOf(threads, oldMarks(held))).toEqual({
    // T6 is in no list of this machine: another machine's, it stays.
    seen: { [T1]: U1 },
    archived: [T1, T4],
  })
})

test("a Thread at work, or one that asks, is never sent archived", () => {
  const held = storage({
    "banda.sidebar.archived": {
      [T1]: { archived: true, at: NOW },
      [T2]: { archived: true, at: NOW },
    },
  })
  const threads = [
    thread(T1, NOW - DAY, {
      latest: { turn: U1, state: "running", began: NOW - DAY },
    }),
    thread(T2, NOW - DAY, { asking: [{ item: "q", title: "Which?" }] }),
  ]
  expect(marksOf(threads, oldMarks(held)).archived).toEqual([])
})

test("the frozen rule archives what the window's showed archived, and no more", () => {
  const latests: (ListedThread["latest"] | undefined)[] = [
    undefined,
    ...(
      ["running", "queued", "done", "failed", "interrupted", "stopped"] as const
    ).map((state) => ({ turn: U1, state, began: NOW - 5 * DAY })),
  ]
  // The cutoff among them, so a Thread changed just then is a case.
  const times = [NOW - 4 * DAY, NOW - 3 * DAY, NOW - 2 * DAY, NOW]
  const says = [
    undefined,
    ...times.flatMap((at) => [
      { archived: true, at },
      { archived: false, at },
    ]),
  ]
  const snoozes = [undefined, ...times]
  let n = 0
  const cases: { thread: ListedThread; old: OldMarks }[] = []
  for (const latest of latests)
    for (const asking of [[], [{ item: "q", title: "Which?" }]])
      for (const changed of times)
        for (const say of says)
          for (const snoozed of snoozes)
            for (const before of [0, NOW - 3 * DAY])
              for (const seen of [undefined, U1]) {
                const one = id(100 + n++)
                const snooze =
                  snoozed === undefined
                    ? undefined
                    : { at: snoozed, by: { kind: "person", id: "p" } as const }
                cases.push({
                  thread: thread(one, changed, { latest, asking, snooze }),
                  old: {
                    seen: seen ? { [one]: seen } : {},
                    seenKept: true,
                    says: say ? { [one]: say } : {},
                    before,
                  },
                })
              }
  const live = ({ thread, old }: (typeof cases)[number]) =>
    wasArchived(
      listedOf({ ...thread, seen: old.seen[thread.id] }, "fake"),
      old.says[thread.id],
      old.before
    )
  const frozen = ({ thread, old }: (typeof cases)[number]) =>
    marksOf([thread], old).archived.includes(thread.id)
  expect(cases.filter((one) => frozen(one) !== live(one))).toEqual([])
  // Both ways come up, so the cases tell the rules apart.
  expect(new Set(cases.map(live))).toEqual(new Set([true, false]))
})

test("a window that never had the three days, or kept nothing, sends nothing", () => {
  expect(marksOf([thread(T1, NOW - 40 * DAY)], oldMarks(storage()))).toEqual({
    seen: {},
    archived: [],
  })
})

test("an ID the engine could not read is dropped, not sent", () => {
  const held = storage({
    "banda.agents.seen": {
      [T1]: "not a turn",
      [T2]: U1.replaceAll("-", ""),
      [T3]: 7,
      "not a thread": U1,
      [T4]: U2,
    },
    "banda.sidebar.archived": {
      "not a thread": { archived: true, at: NOW },
      [T4]: { archived: "yes", at: NOW },
      [T5]: { archived: true, at: NOW },
    },
  })
  const threads = [T1, T2, T3, T4, T5].map((one) => thread(one, NOW - DAY))
  expect(marksOf(threads, oldMarks(held))).toEqual({
    seen: { [T4]: U2 },
    archived: [T5],
  })
  // Storage that is not JSON at all is nothing kept.
  const broken = storage({
    "banda.agents.seen": "{",
    "banda.sidebar.archived": "[",
  })
  expect(marksOf(threads, oldMarks(broken))).toEqual({ seen: {}, archived: [] })
})

/** An engine with `projects`, each listing its Threads, and what it was asked. */
function engineOf(
  projects: Record<string, ListedThread[] | Error | "missing">,
  refuses: string[] = []
) {
  const imported: { project: string; marks: ImportMarks }[] = []
  const engine = {
    call: async (
      method: string,
      _: unknown,
      options?: { project?: string }
    ) => {
      if (method === "projects.list")
        return Object.entries(projects).map(
          ([id, threads]) =>
            ({ id, missing: threads === "missing" }) as ProjectSummary
        )
      const threads = projects[options!.project!]
      if (threads === "missing") throw new Error("its folder is gone")
      if (threads instanceof Error) throw threads
      return { at: 0, threads }
    },
    command: async (method: string, marks: ImportMarks, project: string) => {
      expect(method).toBe("agents.import_marks")
      if (refuses.includes(project)) throw new Error("refused")
      imported.push({ project, marks })
      return {
        count:
          Object.keys(marks.seen ?? {}).length + (marks.archived ?? []).length,
      }
    },
  } as unknown as Engine
  return { engine, imported }
}

/** A window that never had the three days, as its cutoff says. */
const NO_DAYS = { "banda.sidebar.archived-before": "0" }

test("each Project of this machine moves once, and one that failed goes again", async () => {
  const held = storage({
    "banda.agents.seen": { [T1]: U1, [T2]: U2 },
    "banda.sidebar.archived": { [T3]: { archived: true, at: NOW } },
    ...NO_DAYS,
  })
  const p1 = [thread(T1, NOW - DAY), thread(T3, NOW - DAY)]
  const p2 = [thread(T2, NOW - DAY)]
  // P2's folder is gone: it waits until the Person locates it.
  const first = engineOf({ [P1]: p1, [P2]: "missing" })
  expect(await moveMarks(first.engine, held)).toBe(2)
  expect(first.imported).toEqual([
    { project: P1, marks: { seen: { [T1]: U1 }, archived: [T3] } },
  ])
  expect(JSON.parse(held.getItem("banda.marks.moved")!)).toEqual([P1])

  // The next start: P1 moved, so only P2 goes.
  const next = engineOf({ [P1]: p1, [P2]: p2 })
  expect(await moveMarks(next.engine, held)).toBe(1)
  expect(next.imported).toEqual([
    { project: P2, marks: { seen: { [T2]: U2 }, archived: [] } },
  ])
  expect(JSON.parse(held.getItem("banda.marks.moved")!)).toEqual([P1, P2])

  // Then nothing is sent again.
  const after = engineOf({ [P1]: p1, [P2]: p2 })
  expect(await moveMarks(after.engine, held)).toBe(0)
  expect(after.imported).toEqual([])
})

test("a Project with nothing to move sends nothing and is done; a refusal, or a list that fails, is not", async () => {
  const held = storage({ "banda.agents.seen": { [T2]: U2 }, ...NO_DAYS })
  const { engine, imported } = engineOf(
    {
      [P1]: [thread(T1, NOW)],
      [P2]: [thread(T2, NOW)],
      [P3]: new Error("the engine broke off"),
    },
    [P2]
  )
  expect(await moveMarks(engine, held)).toBe(0)
  expect(imported).toEqual([])
  expect(JSON.parse(held.getItem("banda.marks.moved")!)).toEqual([P1])
})

test("a Project list that fails moves nothing, and flags nothing", async () => {
  const held = storage({ "banda.agents.seen": { [T1]: U1 } })
  const engine = {
    call: async () => {
      throw new Error("the engine broke off")
    },
    command: async () => {
      throw new Error("never asked")
    },
  } as unknown as Engine
  expect(await moveMarks(engine, held)).toBe(0)
  expect(held.getItem("banda.marks.moved")).toBeNull()
})

test("a window that kept no marks asks its engine nothing", async () => {
  const asked: string[] = []
  const engine = {
    call: async (method: string) => void asked.push(method),
    command: async (method: string) => void asked.push(method),
  } as unknown as Engine
  expect(await moveMarks(engine, storage())).toBe(0)
  expect(asked).toEqual([])
})

test("the cutoff is kept as the window wrote it: three quiet days for one with marks, none for a new one", () => {
  const marked = storage({ "banda.agents.seen": { [T1]: U1 } })
  holdCutoff(marked, NOW)
  expect(oldMarks(marked).before).toBe(NOW - 3 * DAY)
  // Days later, at the next start, it is the same.
  holdCutoff(marked, NOW + 10 * DAY)
  expect(oldMarks(marked).before).toBe(NOW - 3 * DAY)
  // One kept already stays.
  const kept = storage({ "banda.sidebar.archived-before": String(NOW - DAY) })
  holdCutoff(kept, NOW)
  expect(oldMarks(kept).before).toBe(NOW - DAY)
  // A window of keys of its own, but no marks, had no three days.
  const fresh = storage({
    "banda.sidebar.width": "16",
    "banda.marks.moved": [],
  })
  holdCutoff(fresh, NOW)
  expect(oldMarks(fresh).before).toBe(0)
})

test("a window from before the cutoff moves what the three days had archived", async () => {
  const held = storage({ "banda.sidebar.archived": {} })
  const quiet = thread(T1, Date.now() - 4 * DAY)
  const lately = thread(T2, Date.now() - DAY)
  const { engine, imported } = engineOf({ [P1]: [quiet, lately] })
  expect(await moveMarks(engine, held)).toBe(1)
  expect(imported).toEqual([
    { project: P1, marks: { seen: {}, archived: [T1] } },
  ])
})

/** An engine of this machine's whose Project P1 holds one Thread, and
 * what it was asked by name; its import waits for `go`. */
function slowEngine() {
  const asked: string[] = []
  let go = () => {}
  const going = new Promise<void>((done) => (go = done))
  const engine = {
    call: async (method: string) => {
      asked.push(method)
      if (method === "projects.list")
        return [{ id: P1, missing: false } as ProjectSummary]
      return { at: 0, threads: [thread(T1, NOW)] }
    },
    command: async (method: string) => {
      asked.push(method)
      await going
      return { count: 1 }
    },
  } as unknown as Engine
  return { engine, asked, go }
}

const P = P1 as ProjectId

test("the move starts once, on the engine it is given, and its lists read once it is over", async () => {
  const held = storage({ "banda.agents.seen": { [T1]: U1 } })
  const move = new Move(() => held)
  const here = slowEngine()
  const arc = slowEngine()
  // A list asks before the window's module started.
  let read = false
  const reading = move.over(here.engine, P).then(() => (read = true))
  move.start(here.engine)
  move.start(arc.engine)
  // Another host's list waits for nothing.
  await move.over(arc.engine, P)
  await vi.waitFor(() => expect(here.asked).toContain("agents.import_marks"))
  expect(read).toBe(false)
  here.go()
  await reading
  expect(here.asked).toEqual([
    "projects.list",
    "agents.threads",
    "agents.import_marks",
  ])
  expect(arc.asked).toEqual([])
  // Moved, a Project's list reads at once from then on.
  expect(JSON.parse(held.getItem("banda.marks.moved")!)).toEqual([P1])
  await move.over(here.engine, P)
})

test("a move that fails holds no list up, and one moved already holds none", async () => {
  const held = storage({ "banda.agents.seen": { [T1]: U1 } })
  const move = new Move(() => held)
  const broken = {
    call: async () => {
      throw new Error("the engine broke off")
    },
  } as unknown as Engine
  move.start(broken)
  await move.over(broken, P)
  expect(held.getItem("banda.marks.moved")).toBeNull()

  // A Project moved before reads at once, the move started or not.
  const done = new Move(() => storage({ "banda.marks.moved": [P1] }))
  await done.over(slowEngine().engine, P)
})

test("a list waits a while at most: for a move that never starts, or one that never ends", async () => {
  vi.useFakeTimers()
  try {
    const held = storage({ "banda.agents.seen": { [T1]: U1 } })
    // Where the module never starts, as one this machine's engine does
    // not run: the first read waits the while once, then none waits.
    const never = new Move(() => held)
    let read = false
    const first = never.over(slowEngine().engine, P).then(() => (read = true))
    await vi.advanceTimersByTimeAsync(MOVE_WAIT - 1)
    expect(read).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await first
    await never.over(slowEngine().engine, P)

    // A move whose host never answers.
    const stuck = new Move(() => held)
    const { engine } = slowEngine()
    stuck.start(engine)
    let over = false
    const waiting = stuck.over(engine, P).then(() => (over = true))
    await vi.advanceTimersByTimeAsync(MOVE_WAIT)
    await waiting
    expect(over).toBe(true)
  } finally {
    vi.useRealTimers()
  }
})

test("a Thread marked unread here, seen on its host, is taken back there; one never seen here is not", () => {
  // T1 seen here, T2 marked unread here after the host kept its seen, T3
  // seen on the host at an older turn, T4 at work, T5 seen on no host.
  const held = storage({ "banda.agents.seen": { [T1]: U1 } })
  const threads = [
    thread(T1, NOW, { seen: U1 }),
    thread(T2, NOW, { seen: U1 }),
    thread(T3, NOW, {
      seen: U1,
      latest: { turn: U2, state: "done", began: NOW },
    }),
    thread(T4, NOW, {
      seen: U1,
      latest: { turn: U2, state: "running", began: NOW },
    }),
    thread(T5, NOW),
  ]
  // Only T2 shows settled on the host though this window shows it Done.
  expect(unreadOf(threads, oldMarks(held))).toEqual([T2])
  // A window that never kept a seen takes none back: the host's came from
  // another machine.
  const none = storage({ "banda.sidebar.archived": {} })
  expect(unreadOf(threads, oldMarks(none))).toEqual([])
  // One whose Person took back every seen it kept still has the key.
  const emptied = storage({ "banda.agents.seen": {} })
  expect(unreadOf(threads, oldMarks(emptied))).toEqual([T1, T2])
})

/** An engine of this machine's, open, whose Project P1 lists `threads`,
 * and every command it was sent, by method; it refuses `refuses`. */
function markingEngine(threads: ListedThread[], refuses: string[] = []) {
  const sent: { method: string; params: unknown }[] = []
  const status = { state: "open" } as Status
  const engine = {
    status,
    watch: (watcher: (status: Status) => void) => {
      watcher(status)
      return () => undefined
    },
    call: async (method: string) =>
      method === "projects.list"
        ? [{ id: P1, missing: false } as ProjectSummary]
        : { at: 0, threads },
    command: async (method: string, params: unknown) => {
      sent.push({ method, params })
      return { count: 1 }
    },
    commandAt: async (method: string, params: unknown) => {
      sent.push({ method, params })
      if (refuses.includes(method)) throw new Error("refused")
      return { answer: null, at: 9 }
    },
  } as unknown as Engine
  return { engine, sent }
}

test("the move takes back on the host what this window marked unread, after the import, once", async () => {
  const held = storage({
    "banda.agents.seen": { [T1]: U1 },
    "banda.sidebar.archived": { [T2]: { archived: true, at: NOW } },
    ...NO_DAYS,
  })
  const threads = [thread(T1, NOW - DAY), thread(T2, NOW - DAY, { seen: U1 })]
  const { engine, sent } = markingEngine(threads)
  expect(await moveMarks(engine, held)).toBe(2)
  // The import first: an unread would keep the host from taking T2's
  // archive (#898).
  expect(sent).toEqual([
    {
      method: "agents.import_marks",
      params: { seen: { [T1]: U1 }, archived: [T2] },
    },
    { method: "agents.unread", params: { thread: T2 } },
  ])
  expect(JSON.parse(held.getItem("banda.marks.moved")!)).toEqual([P1])
})

test("a take-back the host refuses leaves the Project to move again", async () => {
  const held = storage({ "banda.agents.seen": {}, ...NO_DAYS })
  const { engine, sent } = markingEngine(
    [thread(T1, NOW - DAY, { seen: U1 })],
    ["agents.unread"]
  )
  expect(await moveMarks(engine, held)).toBe(0)
  expect(sent).toEqual([{ method: "agents.unread", params: { thread: T1 } }])
  expect(held.getItem("banda.marks.moved")).toBeNull()
})
