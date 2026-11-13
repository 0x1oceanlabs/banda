/**
 * A program the window keeps running as its child (ADR 0020, decision 2):
 * the engine's follower and the look. It starts the program, reads it
 * while it runs, and starts it again when it dies: after half a second,
 * then a wait that doubles up to ten seconds, and back to half a second
 * once a run lasted half a minute. A run that ends as `last` says is the
 * last one. When its scope closes, the program gets SIGTERM, and SIGKILL
 * if it has not gone five seconds later. Windows has no SIGTERM: Node's
 * is a kill there. So on Windows its stdin closes, which `--with-parent`
 * reads as "stop", and it is killed only if it has not gone a while later,
 * five seconds unless its caller says (ADR 0090, decision 5). It starts
 * with no console window there.
 */
import {
  Clock,
  Console,
  type Duration,
  Effect,
  Option,
  type PlatformError,
  type Scope,
  Stream,
  SubscriptionRef,
} from "effect"
import { ChildProcess, type ChildProcessSpawner } from "effect/process"

const FIRST_WAIT = 500
const LONGEST_WAIT = 10_000
/** A program that ran this long without dying starts again at once. */
const HEALTHY = 30_000
/** How long a program asked to stop has before it is killed. */
const GRACE = "5 seconds"
/** `program args…`, its stderr the window's, or a pipe to read. Its
 * stdin is a pipe the window holds: if the window dies, the program sees
 * it close. It has the window's environment, `env` over it. */
export function command(
  program: string,
  args: string[],
  env?: Record<string, string>,
  stderr: "inherit" | "pipe" = "inherit"
) {
  return ChildProcess.make(program, args, {
    env,
    extendEnv: true,
    stdin: "pipe",
    stdout: "pipe",
    stderr,
    // In the window's process group, as any child: Ctrl+C in a terminal
    // stops both. On Windows it has a console of its own, hidden, and
    // Node's Job Object ends it as the window ends.
    detached: false,
    // A console program started by Electron, which has none, would open
    // a console window of its own on Windows.
    windowsHide: true,
    killSignal: "SIGTERM",
    forceKillAfter: GRACE,
  })
}

/** Asks `child` to stop by closing its stdin, and waits for it to go, at
 * most `grace`: Windows' way to stop the window's children. What is
 * still there after is killed as the run's scope closes. */
export const letGo = (
  child: ChildProcessSpawner.ChildProcessHandle,
  grace: Duration.Input = GRACE
) =>
  Stream.run(Stream.empty, child.stdin).pipe(
    Effect.andThen(child.exitCode),
    Effect.timeoutOption(grace),
    Effect.ignore
  )

/** How a run ends: whether a run that exits with a code is the last
 * (`last`), and how it is asked to stop as its scope closes: by its stdin
 * closing (`letGo`, with `grace` to go), as on Windows, or by SIGTERM. */
type Ending = {
  last?: (code: number) => boolean
  byStdin?: boolean
  grace?: Duration.Input
}

/** What starts one run: a `command`, or an effect that makes one as the
 * run starts. */
type Start = Effect.Effect<
  ChildProcessSpawner.ChildProcessHandle,
  PlatformError.PlatformError,
  ChildProcessSpawner.ChildProcessSpawner | Scope.Scope
>

/** Runs what `start` starts for good, `name` in what it says when it
 * dies, or until a run exits with a code `last` takes, which it gives;
 * `use` reads each
 * run, and a run whose `use` fails is stopped. `start` is asked anew for
 * each run, so a run starts the program where it is then. */
export const keepRunning = <E extends { message: string }, R>(
  name: string,
  start: Start,
  use: (
    child: ChildProcessSpawner.ChildProcessHandle
  ) => Effect.Effect<void, E, R>,
  {
    last = () => false,
    byStdin = process.platform === "win32",
    grace = GRACE,
  }: Ending = {}
) =>
  Effect.gen(function* () {
    let wait = FIRST_WAIT
    while (true) {
      const started = yield* Clock.currentTimeMillis
      const ended = yield* Effect.scoped(
        once(start, use, byStdin ? grace : undefined)
      )
      if (typeof ended === "number" && last(ended)) return ended
      if ((yield* Clock.currentTimeMillis) - started > HEALTHY)
        wait = FIRST_WAIT
      const how = typeof ended === "number" ? `code ${ended}` : ended
      yield* Console.error(
        `banda: the ${name} stopped (${how}); starting it again in ${wait} ms`
      )
      yield* Effect.sleep(wait)
      wait = Math.min(wait * 2, LONGEST_WAIT)
    }
  })

/** One run: the code it exited with, or how it ended, in words. With a
 * `grace`, it is asked to stop by its stdin. */
const once = <E extends { message: string }, R>(
  start: Start,
  use: (
    child: ChildProcessSpawner.ChildProcessHandle
  ) => Effect.Effect<void, E, R>,
  grace: Duration.Input | undefined
) =>
  Effect.gen(function* () {
    const child = yield* start
    // Closed first, as the scope closes: before the kill.
    if (grace !== undefined)
      yield* Effect.addFinalizer(() => letGo(child, grace))
    const exited: Effect.Effect<number | string, PlatformError.PlatformError> =
      child.exitCode.pipe(Effect.map(Number))
    return yield* use(child).pipe(
      Effect.andThen(Effect.never),
      Effect.raceFirst(exited)
    )
  }).pipe(
    Effect.catch((error) => Effect.succeed<number | string>(error.message))
  )

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
