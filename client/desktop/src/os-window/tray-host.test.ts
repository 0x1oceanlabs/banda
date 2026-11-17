import { NodeServices } from "@effect/platform-node"
import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { script } from "../testing"
import { hasTrayHost } from "./tray-host"

/** Whether a tray host is there, on Linux unless said, by a `busctl`
 * that is the shell script `text`. */
const asked = (
  text: string,
  options: Partial<Parameters<typeof hasTrayHost>[0]> = {}
) =>
  hasTrayHost({
    platform: "linux",
    busctl: script(text),
    wait: "2 seconds",
    ...options,
  }).pipe(Effect.provide(NodeServices.layer))

/** A `busctl` that fails as the real one does, saying `why` on stderr. */
const fails = (why: string) => `echo "${why}" >&2\nexit 1`

it.effect(
  "a watcher that says a host is registered: yes, asked of the session bus and starting nothing",
  () =>
    Effect.gen(function* () {
      const said = yield* asked(
        `[ "$*" = "--user --json=short --auto-start=no get-property org.kde.StatusNotifierWatcher /StatusNotifierWatcher org.kde.StatusNotifierWatcher IsStatusNotifierHostRegistered" ] || exit 2
echo '{"type":"b","data":true}'`
      )
      expect(said).toBe(true)
    })
)

it.effect("a watcher with no host registered: no", () =>
  Effect.gen(function* () {
    expect(yield* asked(`echo '{"type":"b","data":false}'`)).toBe(false)
  })
)

it.effect("no watcher on the bus: no", () =>
  Effect.gen(function* () {
    const said = yield* asked(
      fails(
        "Failed to get property IsStatusNotifierHostRegistered on interface org.kde.StatusNotifierWatcher: The name org.kde.StatusNotifierWatcher was not provided by any .service files"
      )
    )
    expect(said).toBe(false)
  })
)

it.effect("no session bus: no", () =>
  Effect.gen(function* () {
    const said = yield* asked(
      fails("Failed to connect to user bus: No medium found")
    )
    expect(said).toBe(false)
  })
)

it.effect("no busctl on the machine: no", () =>
  Effect.gen(function* () {
    const said = yield* hasTrayHost({
      platform: "linux",
      busctl: "/nowhere/busctl",
    }).pipe(Effect.provide(NodeServices.layer))
    expect(said).toBe(false)
  })
)

// On the real clock: the program runs in real time.
it.live("a bus that does not answer in time: no", () =>
  Effect.gen(function* () {
    const said = yield* asked("sleep 30", { wait: "200 millis" })
    expect(said).toBe(false)
  })
)

it.effect(
  "an answer that is not that boolean is no: other words, another type, a yes that failed",
  () =>
    Effect.gen(function* () {
      expect(yield* asked("echo true")).toBe(false)
      expect(yield* asked("echo 'b true'")).toBe(false)
      expect(yield* asked(`echo '{"type":"s","data":"true"}'`)).toBe(false)
      expect(yield* asked(`echo '{"type":"b","data":1}'`)).toBe(false)
      expect(yield* asked("exit 0")).toBe(false)
      expect(yield* asked(`echo '{"type":"b","data":true}'\nexit 1`)).toBe(
        false
      )
    })
)

it.effect(
  "Windows' notification area and macOS's menu bar are always there, and the bus is not asked; another system has no tray Banda knows",
  () =>
    Effect.gen(function* () {
      // A program that would say no, were it asked.
      const no = `echo '{"type":"b","data":false}'`
      expect(yield* asked(no, { platform: "win32" })).toBe(true)
      expect(yield* asked(no, { platform: "darwin" })).toBe(true)
      const yes = `echo '{"type":"b","data":true}'`
      expect(yield* asked(yes, { platform: "freebsd" })).toBe(false)
    })
)
