import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { NodeServices } from "@effect/platform-node"
import { expect, it } from "@effect/vitest"
import { Clock, Effect, Layer, Option, Sink, Stream } from "effect"
import { ChildProcessSpawner } from "effect/process"
import { TestClock } from "effect/testing"
import { command, keepRunning } from "./child"
import { Engine, Look } from "@banda/desktop-kit"
import { engineLayer } from "./engine"
import { firstLook, lookLayer } from "./look"
import { script } from "./testing"

/** A spawner whose programs end as `ends` says for their nth run, and
 * which notes when each started. */
function fakeSpawner(ends: (run: number) => Effect.Effect<number>) {
  const starts: number[] = []
  const spawner = ChildProcessSpawner.make(() =>
    Effect.gen(function* () {
      const run = starts.length
      starts.push(yield* Clock.currentTimeMillis)
      return ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(run + 1),
        exitCode: Effect.map(ends(run), ChildProcessSpawner.ExitCode),
        isRunning: Effect.succeed(true),
        kill: () => Effect.void,
        stdin: Sink.drain,
        stdout: Stream.empty,
        stderr: Stream.empty,
        all: Stream.empty,
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
        unref: Effect.succeed(Effect.void),
      })
    })
  )
  return { starts, spawner }
}

/** Runs a program that `fake` spawns for `ms` of the test clock. */
const runFor = (
  spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
  ms: number
) =>
  Effect.gen(function* () {
    yield* keepRunning("fake", command("fake", []), () => Effect.void).pipe(
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      Effect.forkScoped
    )
    for (let at = 0; at < ms; at += 100) yield* TestClock.adjust(100)
  })

it.effect(
  "a program that dies starts again, each wait twice the last, up to ten seconds",
  () =>
    Effect.gen(function* () {
      const { starts, spawner } = fakeSpawner(() => Effect.succeed(1))
      yield* runFor(spawner, 36_000)
      expect(starts).toEqual([0, 500, 1500, 3500, 7500, 15_500, 25_500, 35_500])
    })
)

it.effect(
  "a program that ran half a minute starts again after the first wait",
  () =>
    Effect.gen(function* () {
      const { starts, spawner } = fakeSpawner((run) =>
        run === 2 ? Effect.as(Effect.sleep(31_000), 0) : Effect.succeed(1)
      )
      yield* runFor(spawner, 33_500)
      expect(starts).toEqual([0, 500, 1500, 33_000])
    })
)

it.live(
  "the engine's first line gives its address and its door, and the window's end stops it",
  () =>
    Effect.gen(function* () {
      const program = script(
        `echo $$ > "$(dirname "$0")/pid"\n` +
          `echo '{"protocol":1,"port":4321,"secret":"s3","window":"/run/door","browser":"/run/browser.json"}'\n` +
          "exec sleep 60"
      )
      const [address, door] = yield* Engine.use((engine) =>
        Effect.all([engine.address, engine.door])
      ).pipe(
        Effect.provide(
          engineLayer(program).pipe(Layer.provide(NodeServices.layer))
        )
      )
      expect(address).toEqual({ url: "ws://127.0.0.1:4321/ws", secret: "s3" })
      expect(door).toBe("/run/door")
      const pid = Number(readFileSync(join(dirname(program), "pid"), "utf8"))
      expect(() => process.kill(pid, 0)).toThrow()
    })
)

it.live(
  "the engine starts with the PATH it is given, as the login shell's",
  () =>
    Effect.gen(function* () {
      const program = script(
        `printenv PATH > "$(dirname "$0")/path"\n` +
          `echo '{"protocol":1,"port":1,"secret":"s","window":"/w","browser":"/b"}'\n` +
          "exec sleep 60"
      )
      const path = `/Users/p/.local/bin:${process.env.PATH}`
      yield* Engine.use((engine) => engine.address).pipe(
        Effect.provide(
          engineLayer(program, Effect.succeed(Option.some(path))).pipe(
            Layer.provide(NodeServices.layer)
          )
        )
      )
      expect(readFileSync(join(dirname(program), "path"), "utf8").trim()).toBe(
        path
      )
    })
)

it.live(
  "each line the look prints is the look; one that is not is left out",
  () =>
    Effect.gen(function* () {
      const program = script(
        `echo '{"mode":"dark"}'\nsleep 0.3\necho 'not a look'\necho '{"mode":"light"}'\nexec sleep 60`
      )
      const modes = yield* Look.use((look) =>
        look.changes.pipe(
          Stream.map((each) => each.mode),
          Stream.changes,
          Stream.take(2),
          Stream.runCollect
        )
      ).pipe(
        Effect.provide(
          lookLayer(program).pipe(Layer.provide(NodeServices.layer))
        )
      )
      expect(modes).toEqual(["dark", "light"])
    })
)

it.live("the window opens without its look when none came in time", () =>
  Effect.gen(function* () {
    const program = script("exec sleep 60")
    const first = yield* firstLook(50).pipe(
      Effect.provide(lookLayer(program).pipe(Layer.provide(NodeServices.layer)))
    )
    expect(first).toBeNull()
  })
)
