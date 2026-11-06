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
import { Effect, Fiber, Layer } from "effect"
import type { BrowserWindow, Session, WebContents } from "electron"
import { Tabs } from "./tabs"

const work = "0199a3c4-0000-7000-8000-000000000001"
const other = "0199a3c4-0000-7000-8000-000000000002"
const agent: Participant = { kind: "agent", id: "agent-1" }
const person: Participant = { kind: "person", id: "person-1" }

/** A profile of the browser's. */
const profile = () => ({}) as Session

/** A tab's page in `session`. */
function pageIn(id: number, session: Session) {
  const page = Object.assign(new EventEmitter(), {
    id,
    session,
    isDestroyed: () => false,
    getType: () => "webview",
  }) as unknown as WebContents
  known.set(id, page)
  return page
}

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

      expect(tabs.agentsOf(mine)).toBeNull()
      expect(tabs.agentsOf(ours)).toBe(work)
      expect(tabs.agentsOf(stray)).toBeUndefined()
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
            tabs.create("https://a.test/", "agent-1", agents)
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
