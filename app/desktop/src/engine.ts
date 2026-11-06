/**
 * The engine as the window's child: `banda serve --with-parent` (ADR
 * 0020). It learns the engine's address from the first line it prints,
 * forgets it while the engine is down, and stops the engine with the
 * window (child.ts). It starts with `path` as its PATH, when there is
 * one: on macOS, the login shell's (login.ts), and with `carried`'s
 * variables over the window's environment: where the adapters the app
 * carries are, and the Node to run them on (ADR 0059).
 */
import { type Address, Engine as Client } from "@banda/contract"
import { Engine } from "@banda/desktop-kit"
import {
  Data,
  Deferred,
  Effect,
  Layer,
  Option,
  Schema,
  Stream,
  SubscriptionRef,
} from "effect"
import type { ChildProcessSpawner } from "effect/process"
import { command, keepRunning, known, lines } from "./child"

/** The first line `serve --with-parent` prints; `window` is where the
 * window listens for `banda menu`. */
const Running = Schema.fromJsonString(
  Schema.Struct({
    protocol: Schema.Number,
    port: Schema.Number,
    secret: Schema.String,
    window: Schema.String,
  })
)

/** The engine's first line was not what `serve --with-parent` prints. */
class Unexpected extends Data.TaggedError("Unexpected")<{
  readonly message: string
}> {}

/** The engine's layer: see `Engine` (@banda/desktop-kit). */
export const engineLayer = (
  binary: string,
  path: Effect.Effect<
    Option.Option<string>,
    never,
    ChildProcessSpawner.ChildProcessSpawner
  > = Effect.succeed(Option.none()),
  carried: Record<string, string> = {}
) =>
  Layer.effect(Engine)(
    Effect.gen(function* () {
      const env = Option.match(yield* path, {
        onNone: () => carried,
        onSome: (PATH) => ({ ...carried, PATH }),
      })
      const address = yield* SubscriptionRef.make(Option.none<Address>())
      const door = yield* Deferred.make<string>()
      /** The first line of a run: where it listens, and the door. */
      const started = (line: string) =>
        Schema.decodeUnknownEffect(Running)(line).pipe(
          Effect.mapError(
            (error) =>
              new Unexpected({
                message: `it said something unexpected: ${error.message}`,
              })
          ),
          Effect.flatMap((running) =>
            Effect.andThen(
              SubscriptionRef.set(
                address,
                Option.some({
                  url: `ws://127.0.0.1:${running.port}/ws`,
                  secret: running.secret,
                })
              ),
              Deferred.succeed(door, running.window)
            )
          )
        )
      yield* Effect.forkScoped(
        keepRunning(
          "engine",
          command(binary, ["serve", "--with-parent"], env),
          (child) => {
            let first = true
            // Every line is read, so the pipe never fills; the address
            // is kept until the engine dies, then forgotten.
            return lines(child).pipe(
              Stream.runForEach((line) => {
                if (!first) return Effect.void
                first = false
                return started(line)
              }),
              Effect.andThen(Effect.never),
              Effect.ensuring(SubscriptionRef.set(address, Option.none()))
            )
          }
        )
      )
      const at = known(address).pipe(
        Stream.runHead,
        Effect.map(Option.getOrThrow)
      )
      let client: Client | undefined
      yield* Effect.addFinalizer(() => Effect.sync(() => client?.close()))
      return {
        address: at,
        client: Effect.sync(
          () => (client ??= new Client(() => Effect.runPromise(at)))
        ),
        door: Deferred.await(door),
      }
    })
  )
