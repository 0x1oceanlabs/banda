/**
 * The engine, as the window reaches it: `banda start --with-parent`, run
 * on the window's `banda` (program.ts), a packed Banda's own copy (ADR
 * 0086). The engine is the session's service, which outlives the window:
 * a systemd unit on Linux, a launchd job on macOS. That program starts it
 * when it does not run, prints where it listens, and follows it while the
 * window is open; the window's end, or the app's crash, leaves the engine
 * running (decisions 1 and 3). Where the engine is the window's child, as
 * for Banda Local, on Windows for now, and where systemd or launchd did
 * not start it, that program is the engine, `serve --with-parent` (ADR
 * 0020), and stops with the window (child.ts); on macOS the app stays as
 * its window closes (closing.ts).
 *
 * The window learns the engine's address from the first line, and forgets
 * it while the engine is down. An engine Quit Banda stopped, here or by
 * `banda stop`, ends the program with code 0: the window quits then
 * (`stopped`). One stopped as asked by anything else, as its unit stopped
 * by hand, ends it with code 3: the window stays, its Panes say Banda is
 * stopped on this machine, and it starts the engine again when the Person
 * says (`start`; ADR 0124, decision 9). One that crashed is started
 * again. Quit Banda here runs `banda stop --force` (`Stop`). It starts
 * with `path` as its PATH, when there is one: on macOS, the login
 * shell's (login.ts), and with `env` over the window's environment: the
 * Node the app provides for the adapters it carries (ADR 0059).
 */
import { type Address, type Code, Engine as Client } from "@banda/contract"
import { STOPPED_HERE } from "@banda/core"
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

/** The code `start --with-parent` ends with once the engine stopped as
 * asked, but not by Quit Banda (`engine/src/control.rs`). */
const STOPPED = 3

/** The engine was stopped as asked, but not by Quit Banda (ADR 0124,
 * decision 9). Its message is what the page says of it. */
export class EngineStopped extends Data.TaggedError("EngineStopped")<{
  readonly message: string
}> {}

/** This machine's engine as the page's own connection reaches it, beside
 * what main and its modules read of it (`Engine`). */
export class OwnEngine extends Context.Service<
  OwnEngine,
  {
    /** Where the engine listens, as `Engine.address` says it; but it says
     * why not while the engine is stopped, so the page's Panes say so and
     * nothing waits. */
    readonly reached: Effect.Effect<Address, EngineStopped>
    /** Starts an engine that was stopped; running, it changes nothing. */
    readonly start: Effect.Effect<void>
  }
>()("banda/OwnEngine") {}

/** The engine's first line was not what `start --with-parent` prints. */
class Unexpected extends Data.TaggedError("Unexpected")<{
  readonly message: string
}> {}

/** The engine's layer: see `Engine` (@banda/desktop-kit) and `OwnEngine`.
 * `stopped` is called once Quit Banda stopped the engine. */
export const engineLayer = (
  path: Effect.Effect<
    Option.Option<string>,
    never,
    ChildProcessSpawner.ChildProcessSpawner
  > = Effect.succeed(Option.none()),
  env: Record<string, string> = {},
  stopped: () => void = () => {}
) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const program = yield* Program
      const variables = Option.match(yield* path, {
        onNone: () => env,
        onSome: (PATH) => ({ ...env, PATH }),
      })
      const address = yield* SubscriptionRef.make(Option.none<Address>())
      const door = yield* Deferred.make<string>()
      // Whether it was stopped, not by Quit Banda, until it is started.
      const down = yield* SubscriptionRef.make(false)
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
      const running = keepRunning(
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
        {
          // It stopped as asked: by Quit Banda, or by something else.
          last: (code) => code === 0 || code === STOPPED,
          // As long as `banda stop --force` gives it elsewhere (`Stop`):
          // on Windows Quit Banda stops it by its stdin.
          grace: "30 seconds",
        }
      )
      yield* Effect.forkScoped(
        Effect.gen(function* () {
          while (true) {
            // Quit Banda stopped it: Banda quits.
            if ((yield* running) !== STOPPED) return yield* Effect.sync(stopped)
            // Stopped otherwise, the window stays until the Person starts
            // it again.
            yield* SubscriptionRef.set(down, true)
            yield* SubscriptionRef.changes(down).pipe(
              Stream.filter((is) => !is),
              Stream.runHead
            )
          }
        })
      )
      const at = known(address).pipe(
        Stream.runHead,
        Effect.map(Option.getOrThrow)
      )
      // Stopped now, or while it waits: the page's connection hears why.
      const whenDown = SubscriptionRef.changes(down).pipe(
        Stream.filter((is) => is),
        Stream.runHead,
        Effect.andThen(
          Effect.fail(new EngineStopped({ message: STOPPED_HERE }))
        )
      )
      let client: Client | undefined
      yield* Effect.addFinalizer(() => Effect.sync(() => client?.close()))
      const own = {
        reached: Effect.raceFirst(at, whenDown),
        // No longer stopped at once, so the address asked next waits.
        start: SubscriptionRef.set(down, false),
      }
      return Context.make(Engine, {
        address: at,
        client: Effect.sync(
          () => (client ??= new Client(() => Effect.runPromise(at)))
        ),
        door: Deferred.await(door),
      }).pipe(Context.add(OwnEngine, own))
    })
  )

/** What `banda stop` prints as it refuses: the refusal's code, which a
 * caller acts on (`Refusal`). */
const Refused = Schema.fromJsonString(
  Schema.Struct({ error: Schema.Struct({ code: Schema.String }) })
)
/** The code `banda stop` refuses with while Agents work, with no terminal
 * to ask in. */
const WORKING: Code = "conflict"

/**
 * Quit Banda's stop of the engine (ADR 0086, decision 3): `banda stop
 * --force` on the window's `banda`, which stops the engine, its Agents,
 * Harnesses and Terminals, and returns once it has gone, or after half a
 * minute. The page asked first while Agents work; an update restarts the
 * engine with it, once no Thread works or the Person said so.
 * `unlessWorking` is `banda stop` with no terminal to ask in, as macOS's
 * Quit runs it (closing.ts): it stops the engine where no Agent works,
 * and refuses where some do, for the window to ask. On Windows, which has
 * no `banda stop` yet (ADR 0090, step 10), the engine is the window's
 * child, and stops as the window goes: its stdin closes, and it has half
 * a minute (child.ts).
 */
export class Stop extends Context.Service<
  Stop,
  {
    readonly engine: Effect.Effect<void>
    /** Whether Agents work, and it stopped nothing. Else it stopped the
     * engine, found none running, or could not stop it, as when it does
     * not run or takes over half a minute. */
    readonly unlessWorking: Effect.Effect<boolean>
  }
>()("banda/Stop") {
  static readonly layer = Layer.effect(Stop)(
    Effect.gen(function* () {
      const program = yield* Program
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      /** `banda stop` with `more`: its exit code, and what it printed; it
       * fails when it cannot run, or after half a minute. */
      const stop = (...more: string[]) =>
        Effect.scoped(
          Effect.gen(function* () {
            const binary = yield* program.path
            const child = yield* spawner.spawn(
              ChildProcess.make(binary, ["stop", ...more], {
                extendEnv: true,
                stdin: "ignore",
                stdout: "pipe",
                stderr: "inherit",
              })
            )
            return yield* Effect.all(
              [
                child.exitCode,
                child.stdout.pipe(Stream.decodeText, Stream.mkString),
              ],
              { concurrency: 2 }
            )
          })
        ).pipe(Effect.timeout("30 seconds"))
      return {
        engine:
          process.platform === "win32"
            ? Effect.void
            : Effect.ignore(stop("--force")),
        unlessWorking: stop().pipe(
          Effect.map(
            ([code, said]) =>
              code !== 0 &&
              Option.exists(
                Schema.decodeUnknownOption(Refused)(said.trim()),
                (refused) => refused.error.code === WORKING
              )
          ),
          Effect.orElseSucceed(() => false)
        ),
      }
    })
  )
}
