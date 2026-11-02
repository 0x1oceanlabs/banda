/**
 * The engine as the window's child: `banda serve --with-parent` (ADR
 * 0020). It learns the engine's address from the first line it prints,
 * forgets it while the engine is down, and stops the engine with the
 * window (child.ts).
 */
import type { Address } from "@banda/contract"
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
import { command, keepRunning, known, lines } from "./child"

/** The first line `serve --with-parent` prints; `window` is where the
 * window listens for `banda menu`, and `browser` where it says its CDP
 * endpoint. */
const Running = Schema.fromJsonString(
  Schema.Struct({
    protocol: Schema.Number,
    port: Schema.Number,
    secret: Schema.String,
    window: Schema.String,
    browser: Schema.String,
  })
)

/** The engine's first line was not what `serve --with-parent` prints. */
class Unexpected extends Data.TaggedError("Unexpected")<{
  readonly message: string
}> {}

/** The engine's layer: see `Engine` (@banda/desktop-kit). */
export const engineLayer = (binary: string) =>
  Layer.effect(Engine)(
    Effect.gen(function* () {
      const address = yield* SubscriptionRef.make(Option.none<Address>())
      const door = yield* Deferred.make<{ window: string; browser: string }>()
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
              Deferred.succeed(door, running)
            )
          )
        )
      yield* Effect.forkScoped(
        keepRunning(
          "engine",
          command(binary, ["serve", "--with-parent"]),
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
      return {
        address: known(address).pipe(
          Stream.runHead,
          Effect.map(Option.getOrThrow)
        ),
        door: Effect.map(Deferred.await(door), (running) => running.window),
        browser: Effect.map(Deferred.await(door), (running) => running.browser),
      }
    })
  )
