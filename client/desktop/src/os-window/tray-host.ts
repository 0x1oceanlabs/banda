/**
 * Whether a tray host is there to show Banda's icon (issue #1870, Roma's
 * choice 2; ADR 0136, proposed): where one is, closing the window may
 * hide it, and where none is known it closes as today. Anything but a
 * clear yes is no.
 *
 * On Linux the icon is a StatusNotifierItem, and Electron does not say
 * whether anything shows it. The session bus does: a host (Waybar's
 * `tray`, KDE's panel, GNOME's AppIndicator extension) registers with
 * `org.kde.StatusNotifierWatcher`, whose property
 * `IsStatusNotifierHostRegistered` then reads true. It is asked with
 * `busctl`, systemd's, which the engine's user unit needs already. No
 * bus, no watcher, no `busctl`, an answer that is not that boolean or
 * none in `WAIT`: no. Windows' notification area and macOS's menu bar
 * are always there: yes, and nothing is started.
 *
 * It answers for now and keeps nothing: a host comes and goes while
 * Banda runs (Waybar restarts, the extension is turned off), so it is
 * asked each time the answer is needed.
 *
 * A part of the device's window (ADR 0089, decision 9).
 */
import { type Duration, Effect, Option, Schema, Stream } from "effect"
import { ChildProcess, type ChildProcessSpawner } from "effect/process"
import { lines } from "../child"

/** How long the bus has to answer: closing the window waits for it. */
export const WAIT: Duration.Input = "1 second"

const WATCHER = "org.kde.StatusNotifierWatcher"

/** What `busctl --json=short get-property` prints for a boolean. */
const Registered = Schema.fromJsonString(
  Schema.Struct({ type: Schema.Literal("b"), data: Schema.Boolean })
)

/** Whether a tray host is there now. `busctl` is the program asked on
 * Linux, another in a test. */
export const hasTrayHost = (options: {
  readonly platform: NodeJS.Platform
  readonly busctl?: string
  readonly wait?: Duration.Input
}): Effect.Effect<boolean, never, ChildProcessSpawner.ChildProcessSpawner> =>
  options.platform !== "linux"
    ? Effect.succeed(
        options.platform === "win32" || options.platform === "darwin"
      )
    : asked(options.busctl ?? "busctl").pipe(
        Effect.timeoutOption(options.wait ?? WAIT),
        Effect.map(Option.getOrElse(() => false)),
        Effect.catch(() => Effect.succeed(false))
      )

/** What the watcher on the session bus says of its hosts; fails when
 * `busctl` cannot be started or says something else. */
const asked = (busctl: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const child = yield* ChildProcess.make(
        busctl,
        [
          "--user",
          "--json=short",
          // A watcher is there or not: asking starts none.
          "--auto-start=no",
          "get-property",
          WATCHER,
          "/StatusNotifierWatcher",
          WATCHER,
          "IsStatusNotifierHostRegistered",
        ],
        {
          stdin: "ignore",
          stdout: "pipe",
          stderr: "ignore",
          // It only reads: one that hangs goes at once when the wait ends.
          killSignal: "SIGKILL",
        }
      )
      const said = yield* Stream.runCollect(lines(child))
      const { data } = yield* Schema.decodeUnknownEffect(Registered)(
        said.join("\n")
      )
      return data && (yield* child.exitCode) === 0
    })
  )
