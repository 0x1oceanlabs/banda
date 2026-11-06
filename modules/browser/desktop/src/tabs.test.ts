import { vi } from "vitest"
/** The pages Electron knows, by their IDs. */
const known = vi.hoisted(() => new Map<number, unknown>())
vi.mock("electron", () => ({
  webContents: { fromId: (id: number) => known.get(id) },
}))
import { EventEmitter } from "node:events"
import { expect, it } from "@effect/vitest"
import type { Participant } from "@banda/contract"
import { Window } from "@banda/desktop-kit"
import { Effect, Fiber, Layer, Stream } from "effect"
import type { BrowserWindow, Session, WebContents } from "electron"
import { type LendChange, Tabs } from "./tabs"

const work = "0199a3c4-0000-7000-8000-000000000001"
const other = "0199a3c4-0000-7000-8000-000000000002"
const agent: Participant = { kind: "agent", id: "agent-1" }
const person: Participant = { kind: "person", id: "person-1" }

/** A profile of the browser's. */
const profile = () => ({}) as Session

/** A tab's page in `session`, until it is destroyed. */
function pageIn(id: number, session: Session) {
  let gone = false
  const page = Object.assign(new EventEmitter(), {
    id,
    session,
    isDestroyed: () => gone,
    getType: () => "webview",
    getTitle: () => `Tab ${id}`,
  }) as unknown as WebContents
  page.once("destroyed", () => (gone = true))
  known.set(id, page)
  return page
}

/** Each lend that begins or ends, as `count` of them come. */
const lendsOf = (tabs: Tabs["Service"], count: number) =>
  Effect.gen(function* () {
    const heard = yield* Effect.forkChild(
      tabs.lends.pipe(Stream.take(count), Stream.runCollect)
    )
    // It hears from when it runs.
    yield* Effect.yieldNow
    return Effect.map(Fiber.join(heard), (changes) =>
      changes.map(({ page, lend, lending, tab }: LendChange) => [
        page.id,
        lend.agent,
        lending,
        tab,
      ])
    )
  })

/** Tabs over a window whose page hears what main tells it. */
function tabsTelling(told: unknown[]) {
  const shown = {
    webContents: { send: (_: string, news: unknown) => told.push(news) },
  } as unknown as BrowserWindow
  return Tabs.layer.pipe(Layer.provide(Window.layer(() => shown)))
}

it.effect(
  "a call reaches the tabs its Project's Agents opened, and no other",
  () =>
    Effect.gen(function* () {
      const tabs = yield* Tabs
      const persons = profile()
      const works = profile()
      const others = profile()
      tabs.profiled(persons, null)
      tabs.profiled(works, work)
      tabs.profiled(others, other)
      const mine = pageIn(1, persons)
      const ours = pageIn(2, works)
      const theirs = pageIn(3, others)
      const stray = pageIn(4, profile())
      for (const page of [mine, ours, theirs, stray]) tabs.attached(page)

      expect(tabs.whose(mine)).toBeNull()
      expect(tabs.whose(ours)).toBe(work)
      expect(tabs.whose(stray)).toBeUndefined()
      // The Person's tabs, another Project's Agents' and a page of no
      // profile are out of reach; no tab is lent yet.
      expect(tabs.seen(work, agent)).toEqual([ours])
      expect(tabs.seen(other, agent)).toEqual([theirs])
      expect(tabs.seen(work, person)).toEqual([ours])
      // A tab that went is out of reach too.
      ;(ours as unknown as EventEmitter).emit("destroyed")
      expect(tabs.seen(work, agent)).toEqual([])
    }).pipe(Effect.provide(tabsTelling([])))
)

it.effect(
  "a tab asked for is made in the profile asked for, or refused",
  () => {
    const told: { kind: string; request: string; agents?: string }[] = []
    return Effect.gen(function* () {
      const tabs = yield* Tabs
      const persons = profile()
      const works = profile()
      tabs.profiled(persons, null)
      tabs.profiled(works, work)
      const ours = pageIn(10, works)
      const mine = pageIn(11, persons)

      /** Asks for a tab, and the window makes `page` for it. */
      const made = (page: WebContents, agents?: string) =>
        Effect.gen(function* () {
          const asking = yield* Effect.forkChild(
            tabs.create({ url: "https://a.test/", agent: "agent-1", agents })
          )
          yield* Effect.yieldNow
          const asked = told.at(-1)!
          expect(asked.kind).toBe("create")
          expect(asked.agents).toBe(agents)
          yield* tabs.created(asked.request, page.id)
          return yield* Fiber.join(asking).pipe(Effect.result)
        })

      const agents = yield* made(ours, work)
      expect(agents._tag === "Success" && agents.success).toBe(ours)
      // A page of the Person's profile is not the Agents' tab.
      const wrong = yield* made(mine, work)
      expect(wrong._tag).toBe("Failure")
      // Nor is a page of the Agents' an extension's tab, which is the
      // Person's.
      const extension = yield* made(ours)
      expect(extension._tag).toBe("Failure")
    }).pipe(Effect.provide(tabsTelling(told)))
  }
)

const lendTo = (id: string, project = work) => ({
  agent: id,
  thread: `thread of ${id}`,
  project,
})

it.effect(
  "a tab the Person lends one Thread is in its Agent's reach alone, until they take it back",
  () => {
    const told: unknown[] = []
    return Effect.gen(function* () {
      const tabs = yield* Tabs
      const persons = profile()
      const works = profile()
      tabs.profiled(persons, null)
      tabs.profiled(works, work)
      const mine = pageIn(20, persons)
      const ours = pageIn(21, works)
      const loose = pageIn(22, persons)
      tabs.attached(mine)
      tabs.attached(ours)
      const heard = yield* lendsOf(tabs, 4)

      yield* tabs.lend(mine, lendTo("agent-1"))
      expect(tabs.lentTo(mine)?.agent).toBe("agent-1")
      expect(tabs.seen(work, agent)).toEqual([mine, ours])
      // No other Agent, no Person's call, and no call of its Agent from
      // another Project reaches it.
      expect(tabs.seen(work, { kind: "agent", id: "agent-2" })).toEqual([ours])
      expect(tabs.seen(work, person)).toEqual([ours])
      expect(tabs.seen(other, agent)).toEqual([])
      expect(told.at(-1)).toEqual({ kind: "lent", from: 20, agent: "agent-1" })

      // Only a tab of the Person's is lent: not an Agents' tab, nor a
      // page no Pane holds.
      for (const page of [ours, loose]) {
        const refused = yield* Effect.result(tabs.lend(page, lendTo("agent-1")))
        expect(refused._tag).toBe("Failure")
      }
      expect(tabs.lentTo(ours)).toBeUndefined()

      // Lent to another Thread, it is the first's no more.
      yield* tabs.lend(mine, lendTo("agent-2"))
      expect(tabs.seen(work, agent)).toEqual([ours])
      expect(tabs.seen(work, { kind: "agent", id: "agent-2" })).toEqual([
        mine,
        ours,
      ])
      // Taken back, it is no Thread's.
      yield* tabs.lend(mine, null)
      expect(tabs.lentTo(mine)).toBeUndefined()
      expect(tabs.seen(work, { kind: "agent", id: "agent-2" })).toEqual([ours])
      expect(told.at(-1)).toEqual({ kind: "lent", from: 20, agent: null })
      // Taken back again, nothing more happens.
      yield* tabs.lend(mine, null)

      expect(yield* heard).toEqual([
        [20, "agent-1", "lent", "Tab 20"],
        [20, "agent-1", "back", "Tab 20"],
        [20, "agent-2", "lent", "Tab 20"],
        [20, "agent-2", "back", "Tab 20"],
      ])
    }).pipe(Effect.provide(tabsTelling(told)))
  }
)

it.effect("a lend ends as its tab closes, and as every session ends", () =>
  Effect.gen(function* () {
    const tabs = yield* Tabs
    const persons = profile()
    tabs.profiled(persons, null)
    const [closing, kept, other] = [30, 31, 32].map((id) => pageIn(id, persons))
    for (const page of [closing, kept, other]) tabs.attached(page)
    const heard = yield* lendsOf(tabs, 6)

    yield* tabs.lend(closing, lendTo("agent-1"))
    ;(closing as unknown as EventEmitter).emit("destroyed")
    expect(tabs.seen(work, agent)).toEqual([])

    yield* tabs.lend(kept, lendTo("agent-1"))
    yield* tabs.lend(other, lendTo("agent-2"))
    tabs.ended()
    expect(tabs.lentTo(kept)).toBeUndefined()
    expect(tabs.lentTo(other)).toBeUndefined()

    expect(yield* heard).toEqual([
      [30, "agent-1", "lent", "Tab 30"],
      // A tab that went has no title to say.
      [30, "agent-1", "closed", ""],
      [31, "agent-1", "lent", "Tab 31"],
      [32, "agent-2", "lent", "Tab 32"],
      [31, "agent-1", "session", "Tab 31"],
      [32, "agent-2", "session", "Tab 32"],
    ])
  }).pipe(Effect.provide(tabsTelling([])))
)
