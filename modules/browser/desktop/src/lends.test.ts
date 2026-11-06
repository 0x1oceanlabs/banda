import { vi } from "vitest"
vi.mock("electron", () => ({ webContents: { fromId: () => undefined } }))
import { EventEmitter } from "node:events"
import { expect, it } from "@effect/vitest"
import type { Engine as Client, Status } from "@banda/contract"
import { Engine, Window } from "@banda/desktop-kit"
import { Effect, Layer } from "effect"
import type { Session, WebContents } from "electron"
import { Drive } from "./drive"
import { lendsLayer } from "./lends"
import { Tabs } from "./tabs"

const work = "0199a3c4-0000-7000-8000-000000000001"
const to = { agent: "agent-1", thread: "t1", project: work }

/** What the engine was told, and what the hands let go. */
const said: unknown[][] = []
const letGo: string[] = []
/** Who hears the engine's status. */
let hear: (status: Status) => void = () => {}

const main = Layer.mergeAll(
  Layer.succeed(Engine)({
    address: Effect.die("unused"),
    client: Effect.succeed({
      command: async (...args: unknown[]) => void said.push(args),
      watch: (watcher: (status: Status) => void) => {
        hear = watcher
        watcher({ state: "connecting" })
        return () => {}
      },
    } as unknown as Client),
    door: Effect.die("unused"),
  }),
  Layer.succeed(Drive)({
    letGo: (tab: number, agent: string) =>
      Effect.sync(() => void letGo.push(`${agent} off ${tab}`)),
  } as unknown as Drive["Service"])
)

const layer = lendsLayer.pipe(
  Layer.provideMerge(Tabs.layer),
  Layer.provideMerge(main),
  Layer.provideMerge(Window.layer(() => null))
)

/** A tab of the Person's. */
function personsTab(tabs: Tabs["Service"], id: number) {
  const session = {} as Session
  tabs.profiled(session, null)
  const page = Object.assign(new EventEmitter(), {
    id,
    session,
    isDestroyed: () => false,
    getTitle: () => "Fix login redirect #598",
  }) as unknown as WebContents
  tabs.attached(page)
  return page
}

/** Lets what follows the lends run. */
const settle = Effect.gen(function* () {
  for (let i = 0; i < 5; i++) yield* Effect.yieldNow
})

it.effect(
  "each lend and its end is said in its Thread, and an end lets the Thread go off the tab",
  () =>
    Effect.gen(function* () {
      said.length = 0
      letGo.length = 0
      const tabs = yield* Tabs
      yield* settle
      const page = personsTab(tabs, 5)

      yield* tabs.lend(page, to)
      yield* settle
      expect(said).toEqual([
        [
          "browser.lent",
          { thread: "t1", tab: "Fix login redirect #598", lending: "lent" },
          work,
        ],
      ])
      expect(letGo).toEqual([])

      yield* tabs.lend(page, null)
      yield* settle
      expect(said.at(-1)).toEqual([
        "browser.lent",
        { thread: "t1", tab: "Fix login redirect #598", lending: "back" },
        work,
      ])
      expect(letGo).toEqual(["agent-1 off 5"])

      // The engine that ran every session went: each lend ends.
      yield* tabs.lend(page, to)
      hear({ state: "lost", retryIn: 250 })
      yield* settle
      expect(tabs.lentTo(page)).toBeUndefined()
      expect(said.at(-1)).toEqual([
        "browser.lent",
        { thread: "t1", tab: "Fix login redirect #598", lending: "session" },
        work,
      ])
      expect(letGo).toEqual(["agent-1 off 5", "agent-1 off 5"])
    }).pipe(Effect.provide(layer))
)
