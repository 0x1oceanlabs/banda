/**
 * A program the window keeps running as its child (ADR 0020, decision 2):
 * the engine and the look. It starts the program, reads it while it runs,
 * and starts it again when it dies: after half a second, then a wait
 * that doubles up to ten seconds, and back to half a second once a run
 * lasted half a minute. When its scope closes, the program gets SIGTERM,
 * and SIGKILL if it has not gone five seconds later.
 */
import { Clock, Console, Effect, Option, Stream, SubscriptionRef } from "effect"
import { ChildProcess, type ChildProcessSpawner } from "effect/process"

const FIRST_WAIT = 500
const LONGEST_WAIT = 10_000
/** A program that ran this long without dying starts again at once. */
const HEALTHY = 30_000
/** `program args…`, its stderr the window's. Its stdin is a pipe the
 * window holds: if the window dies, the program sees it close. It has the
 * window's environment, `env` over it. */
export function command(
  program: string,
  args: string[],
  env?: Record<string, string>
) {
  return ChildProcess.make(program, args, {
    env,
    extendEnv: true,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
    // In the window's process group, as any child: Ctrl+C stops both.
    detached: false,
    killSignal: "SIGTERM",
    forceKillAfter: "5 seconds",
  })
}

/** Runs `command` for good, `name` in what it says when it dies; `use`
 * reads each run, and a run whose `use` fails is stopped. */
export const keepRunning = <E extends { message: string }, R>(
  name: string,
  command: ChildProcess.Command,
  use: (
    child: ChildProcessSpawner.ChildProcessHandle
  ) => Effect.Effect<void, E, R>
) =>
  Effect.gen(function* () {
    let wait = FIRST_WAIT
    while (true) {
      const started = yield* Clock.currentTimeMillis
      const ended = yield* Effect.scoped(once(command, use))
      if ((yield* Clock.currentTimeMillis) - started > HEALTHY)
        wait = FIRST_WAIT
      yield* Console.error(
        `banda: the ${name} stopped (${ended}); starting it again in ${wait} ms`
      )
      yield* Effect.sleep(wait)
      wait = Math.min(wait * 2, LONGEST_WAIT)
    }
  })

/** One run: how it ended, in words. */
const once = <E extends { message: string }, R>(
  command: ChildProcess.Command,
  use: (
    child: ChildProcessSpawner.ChildProcessHandle
  ) => Effect.Effect<void, E, R>
) =>
  Effect.gen(function* () {
    const child = yield* command
    const exited = child.exitCode.pipe(Effect.map((code) => `code ${code}`))
    return yield* use(child).pipe(
      Effect.andThen(Effect.never),
      Effect.raceFirst(exited)
    )
  }).pipe(Effect.catch((error) => Effect.succeed(error.message)))

/** What a child prints, line by line. */
export const lines = (child: ChildProcessSpawner.ChildProcessHandle) =>
  child.stdout.pipe(Stream.decodeText, Stream.splitLines)

/** The value `ref` holds, now and each time it changes, while it holds
 * one. */
export const known = <A>(
  ref: SubscriptionRef.SubscriptionRef<Option.Option<A>>
) =>
  SubscriptionRef.changes(ref).pipe(
    Stream.filter(Option.isSome),
    Stream.map((some) => some.value)
  )
