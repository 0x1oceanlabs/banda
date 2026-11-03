/**
 * The Person's PATH on macOS (#443). An app opened from the Dock, Finder
 * or Spotlight gets launchd's PATH, `/usr/bin:/bin:/usr/sbin:/sbin`,
 * without what the shell profile adds: `~/.local/bin`, where Claude Code
 * and Codex install themselves, and the Node that `npx` comes from. The
 * window asks the login shell once, as VS Code does, and the engine
 * starts with what it says (engine.ts), so it finds the Harnesses as a
 * terminal would. A window started from a terminal (`TERM` is set) has
 * the profile's PATH already, and skips the seconds an interactive
 * profile takes. Only PATH is taken; Linux keeps its session's.
 */
import { Console, Duration, Effect, Option, Stream } from "effect"
import { ChildProcess, type ChildProcessSpawner } from "effect/process"
import { lines } from "./child"

/** Around the PATH the shell prints, so a profile's own output is skipped. */
const MARK = "__banda_path__"
/** How long a login shell may take, as VS Code waits; a profile that
 * hangs does not hold Banda. */
const WAIT: Duration.Input = "10 seconds"

/** `login`'s folders, then those of `own` it lacks, each once. */
export function merged(login: string, own: string | undefined): string {
  const folders = [...login.split(":"), ...(own ?? "").split(":")]
  return [...new Set(folders.filter((folder) => folder !== ""))].join(":")
}

/** The PATH the Person's login shell has on macOS, the window's own
 * folders after it; none off macOS, from a terminal, or when the shell
 * fails, says nothing of it or takes longer than `wait`. */
export const loginPath = (options: {
  readonly platform: NodeJS.Platform
  readonly shell: string | undefined
  readonly own: string | undefined
  /** The window's `TERM`: set when a terminal started it. */
  readonly term: string | undefined
  readonly wait?: Duration.Input
}): Effect.Effect<
  Option.Option<string>,
  never,
  ChildProcessSpawner.ChildProcessSpawner
> =>
  options.platform !== "darwin" || options.term || !options.shell
    ? Effect.succeed(Option.none())
    : asked(options.shell).pipe(
        Effect.timeoutOption(options.wait ?? WAIT),
        Effect.map(Option.flatten),
        Effect.catch(() => Effect.succeed(Option.none<string>())),
        Effect.map(Option.map((login) => merged(login, options.own))),
        Effect.tap((path) =>
          Option.isNone(path)
            ? Console.error(
                `banda: ${options.shell} did not say its PATH; the engine keeps the window's`
              )
            : Effect.void
        )
      )

/** What `shell`, as a login shell, says its PATH is. */
const asked = (shell: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const child = yield* ChildProcess.make(
        shell,
        ["-ilc", `echo ${MARK}; /usr/bin/printenv PATH; echo ${MARK}`],
        {
          stdin: "ignore",
          stdout: "pipe",
          stderr: "ignore",
          // An interactive shell ignores SIGTERM; one whose profile hangs
          // still goes when the wait ends.
          killSignal: "SIGKILL",
        }
      )
      const said = yield* Stream.runCollect(lines(child))
      return between(said)
    })
  )

/** The line between the first two marks, if there is one. */
function between(said: ReadonlyArray<string>): Option.Option<string> {
  const start = said.indexOf(MARK)
  const path = said[start + 1]
  return start >= 0 && said[start + 2] === MARK && path
    ? Option.some(path)
    : Option.none()
}
