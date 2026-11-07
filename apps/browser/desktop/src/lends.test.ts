import { vi } from "vitest"
vi.mock("electron", () => ({ webContents: { fromId: () => undefined } }))
import { EventEmitter } from "node:events"
import { expect, it } from "@effect/vitest"
import type { Engine as Client, Status } from "@banda/contract"
import { Engine, Window } from "@banda/desktop-kit"
import { Effect, Layer } from "effect"
import type { Session, WebContents } from "electron"
import { lendsLayer } from "./lends"
import { Tabs } from "./tabs"

const work = "0199a3c4-0000-7000-8000-000000000001"
const to = { agent: "agent-1", thread: "t1", project: work }

/** What the engine was told. */
const said: unknown[][] = []
/** Who hears the engine's status. */
let hear: (status: Status) => void = () => {}

const engine = Layer.succeed(Engine)({
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
})

const layer = lendsLayer.pipe(
  Layer.provideMerge(Tabs.layer),
  Layer.provideMerge(engine),
  Layer.provideMerge(Window.layer(() => null))
)

/** The engine, open in its boot `boot`. */
const open = (boot: string): Status => ({
  state: "open",
  engine: "banda test",
  modules: ["agents", "browser"],
  boot,
})

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

/** What the engine is told of a lend's change `lending`. */
const line = (lending: string) => [
  "browser.lent",
  { thread: "t1", title: "Fix login redirect #598", lending },
  work,
]

it.effect(
  "each lend and its end is said in its Thread, and a new boot of the engine ends every lend",
  () =>
    Effect.gen(function* () {
      said.length = 0
      const tabs = yield* Tabs
      yield* settle
      const page = personsTab(tabs, 5)
      hear(open("boot-1"))

      yield* tabs.lend(page.id, to)
      yield* settle
      expect(said).toEqual([line("lent")])
      yield* tabs.lend(page.id, null)
      yield* settle
      expect(said).toEqual([line("lent"), line("back")])

      // The connection breaks and comes back to the same boot: its
      // sessions run on, and so does the lend.
      yield* tabs.lend(page.id, to)
      hear({ state: "lost", retryIn: 250 })
      hear(open("boot-1"))
      yield* settle
      expect(tabs.lentTo(page)?.agent).toBe("agent-1")

      // The engine started again: every session of its last boot ended.
      hear({ state: "lost", retryIn: 250 })
      hear(open("boot-2"))
      yield* settle
      expect(tabs.lentTo(page)).toBeUndefined()
      expect(said.slice(2)).toEqual([line("lent"), line("session")])
    }).pipe(Effect.provide(layer))
)
