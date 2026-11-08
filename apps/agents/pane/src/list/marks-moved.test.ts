import type { Engine, ProjectSummary } from "@banda/contract"
import type { ImportMarks, ListedThread } from "@banda/contract/agents"
import { DAY } from "@banda/ui/lib/words"
import { expect, test } from "vitest"
// The live rule, the window's, read here only to hold the copy to it
// while both are: this leaves with step 2b, which changes that rule.
import { isArchived } from "../../../../../client/web/src/sidebar/archived"
import { marksOf, moveMarks, type OldMarks, oldMarks } from "./marks-moved"
import { listedOf } from "./rows"

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

test("the frozen rule archives what the live one shows archived, and no more", () => {
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
                    says: say ? { [one]: say } : {},
                    before,
                  },
                })
              }
  const live = ({ thread, old }: (typeof cases)[number]) =>
    isArchived(
      listedOf(thread, old.seen, "fake"),
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

test("each Project of this machine moves once, and one that failed goes again", async () => {
  const held = storage({
    "banda.agents.seen": { [T1]: U1, [T2]: U2 },
    "banda.sidebar.archived": { [T3]: { archived: true, at: NOW } },
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
  const held = storage({ "banda.agents.seen": { [T2]: U2 } })
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
