/**
 * The engine, as the window reaches it: `banda start --with-parent`, run
 * on the window's `banda` (program.ts), a packed Banda's own copy (ADR
 * 0086). On Linux the engine is the session's service, which outlives the
 * window: that program starts it when it does not run, prints where it
 * listens, and follows it while the window is open; the window's end
 * leaves the engine running (decisions 1 and 3). Where the engine is the
 * window's child, as on macOS for now and for Banda Local, that program
 * is the engine, `serve --with-parent` (ADR 0020), and stops with the
 * window (child.ts).
 *
 * The window learns the engine's address from the first line, and forgets
 * it while the engine is down. An engine that stops as asked, as Quit
 * Banda or `banda stop` stops it, ends the program with code 0: the window
 * quits then (`stopped`). One that crashed is started again. Quit Banda
 * here runs `banda stop --force` (`Stop`). It starts
 * with `path` as its PATH, when there is one: on macOS, the login
 * shell's (login.ts), and with `env` over the window's environment: the
 * Node the app provides for the adapters it carries (ADR 0059).
 */
import { type Address, Engine as Client } from "@banda/contract"
import { Engine } from "@banda/desktop-kit"
import {
  Context,
  Data,
  Deferred,
  Effect,
  Layer,
  Option,
  Schema,
  Stream,
  SubscriptionRef,
} from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { command, keepRunning, known, lines } from "./child"
import { Program } from "./program"

/** The first line `start --with-parent` prints; `window` is where the
 * window listens for `banda menu`. */
const Running = Schema.fromJsonString(
  Schema.Struct({
    protocol: Schema.Number,
    port: Schema.Number,
    secret: Schema.String,
    window: Schema.String,
  })
)

/** The engine's first line was not what `start --with-parent` prints. */
class Unexpected extends Data.TaggedError("Unexpected")<{
  readonly message: string
}> {}

/** The engine's layer: see `Engine` (@banda/desktop-kit). `stopped` is
 * called once the engine stopped as asked. */
export const engineLayer = (
  path: Effect.Effect<
    Option.Option<string>,
    never,
    ChildProcessSpawner.ChildProcessSpawner
  > = Effect.succeed(Option.none()),
  env: Record<string, string> = {},
  stopped: () => void = () => {}
) =>
  Layer.effect(Engine)(
    Effect.gen(function* () {
      const program = yield* Program
      const variables = Option.match(yield* path, {
        onNone: () => env,
        onSome: (PATH) => ({ ...env, PATH }),
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
          Effect.flatMap(program.path, (binary) =>
            command(binary, ["start", "--with-parent"], variables)
          ),
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
          },
          // It stopped as asked: Banda quits.
          (code) => code === 0
        ).pipe(Effect.andThen(Effect.sync(stopped)))
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

/**
 * Quit Banda's stop of the engine (ADR 0086, decision 3): `banda stop
 * --force` on the window's `banda`, which stops the engine, its Agents,
 * Harnesses and Terminals, and returns once it has gone, or after half a
 * minute. The page asked first while Agents work; an update restarts the
 * engine with it, once no Thread works or the Person said so.
 */
export class Stop extends Context.Service<
  Stop,
  { readonly engine: Effect.Effect<void> }
>()("banda/Stop") {
  static readonly layer = Layer.effect(Stop)(
    Effect.gen(function* () {
      const program = yield* Program
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const stop = (binary: string) =>
        ChildProcess.make(binary, ["stop", "--force"], {
          extendEnv: true,
          stdin: "ignore",
          stdout: "ignore",
          stderr: "inherit",
        })
      return {
        engine: program.path.pipe(
          Effect.flatMap((binary) =>
            Effect.scoped(
              Effect.flatMap(
                spawner.spawn(stop(binary)),
                (child) => child.exitCode
              )
            )
          ),
          Effect.timeout("30 seconds"),
          Effect.ignore
        ),
      }
    })
  )
}
