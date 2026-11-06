/**
 * What follows a tab's lend (ADR 0083, decision 4): the Thread's line of
 * each lend and of its end, said through the engine (`browser.lent`),
 * which the agents module posts in the Thread for its Person and its
 * Agent; and, as a lend ends, the Thread's hold on the tab, which ends too.
 * A Thread's session lives in the engine that runs it, and its pass with
 * it: once main loses that engine, every lend ends.
 */
import { Engine } from "@banda/desktop-kit"
import { Effect, Layer, Stream } from "effect"
import { Drive } from "./drive"
import { type LendChange, Tabs } from "./tabs"

export const lendsLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tabs = yield* Tabs
    const drive = yield* Drive
    const client = yield* Engine.use((engine) => engine.client)
    /** The Thread's line of `change`; the lend holds or ends all the
     * same when the engine cannot take it. A line said while the engine
     * is away waits for it. */
    const say = ({ lend, lending, tab }: LendChange) =>
      Effect.ignore(
        Effect.tryPromise(() =>
          client.command(
            "browser.lent",
            { thread: lend.thread, tab, lending },
            lend.project
          )
        )
      )
    // The hold ends at once; the lines go in order, as the engine takes
    // them.
    yield* Effect.forkScoped(
      tabs.lends.pipe(
        Stream.filter((change) => change.lending !== "lent"),
        Stream.runForEach(({ page, lend }) => drive.letGo(page.id, lend.agent))
      )
    )
    yield* Effect.forkScoped(tabs.lends.pipe(Stream.runForEach(say)))
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        client.watch((status) => {
          if (status.state === "lost" || status.state === "refused")
            tabs.ended()
        })
      ),
      (stop) => Effect.sync(stop)
    )
  })
)
