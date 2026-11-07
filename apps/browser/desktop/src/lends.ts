/**
 * The Thread's line of each lend of a tab and of its end (ADR 0083,
 * decision 4), said through the engine (`browser.lent`), which the agents
 * module posts in the Thread for its Person and its Agent. A Thread's
 * session lives in the engine that runs it: once that engine starts
 * again, every session of its last boot ended, and every lend with it.
 */
import { Engine } from "@banda/desktop-kit"
import { Effect, Layer, Stream } from "effect"
import { type LendChange, Tabs } from "./tabs"

export const lendsLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tabs = yield* Tabs
    const client = yield* Engine.use((engine) => engine.client)
    /** The Thread's line of `change`; the lend holds or ends all the
     * same when the engine cannot take it. A line said while the engine
     * is away waits for it. */
    const say = ({ lend, lending, title }: LendChange) =>
      Effect.ignore(
        Effect.tryPromise(() =>
          client.command(
            "browser.lent",
            { thread: lend.thread, title, lending },
            lend.project
          )
        )
      )
    yield* Effect.forkScoped(tabs.lends.pipe(Stream.runForEach(say)))
    /** The engine's boot the sessions of the lends run in. */
    let boot: string | undefined
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        client.watch((status) => {
          if (status.state !== "open") return
          if (boot !== undefined && status.boot !== boot) tabs.ended()
          boot = status.boot
        })
      ),
      (stop) => Effect.sync(stop)
    )
  })
)
