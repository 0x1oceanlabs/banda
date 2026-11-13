import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { NodeServices } from "@effect/platform-node"
import { expect, it, vi } from "@effect/vitest"
import {
  Clock,
  Deferred,
  Effect,
  Fiber,
  Layer,
  Option,
  Sink,
  Stream,
} from "effect"
import { ChildProcessSpawner } from "effect/process"
import { TestClock } from "effect/testing"
import { command, keepRunning, letGo, lines } from "./child"
import { Engine, Look } from "@banda/desktop-kit"
import { engineLayer, EngineStopped, helloTo, OwnEngine, Stop } from "./engine"
import { deviceKey } from "./key"
import { firstLook, lookLayer } from "./look"
import { Program } from "./program"
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

/** The look's layer, its program `program`. */
const lookOf = (program: string) =>
  lookLayer.pipe(
    Layer.provide(Program.layer({ program })),
    Layer.provide(NodeServices.layer)
  )

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
  "Windows' stop: a child's stdin closes, and it is waited for, a while at most",
  () =>
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      // As `--with-parent` does: it goes once its stdin closes.
      const hears = yield* spawner.spawn(
        command(script("cat > /dev/null\nexit 0"), [])
      )
      yield* letGo(hears)
      expect(yield* hears.isRunning).toBe(false)
      // One that does not hear it is left to be killed after the wait.
      const deaf = yield* spawner.spawn(command(script("exec sleep 60"), []))
      const asked = Date.now()
      yield* letGo(deaf, "300 millis")
      expect(Date.now() - asked).toBeGreaterThanOrEqual(250)
      expect(yield* deaf.isRunning).toBe(true)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
)

it.live(
  "Windows' stop as a kept run's scope closes: its stdin closes first, before the kill",
  () =>
    Effect.gen(function* () {
      // It says it is up, and notes that it heard its stdin close: a
      // SIGTERM before that would leave no note.
      const program = script(
        `echo up\ncat > /dev/null\necho heard > "$(dirname "$0")/heard"`
      )
      const up = yield* Deferred.make<void>()
      const run = yield* keepRunning(
        "listener",
        command(program, []),
        (child) =>
          lines(child).pipe(
            Stream.runForEach(() => Deferred.succeed(up, undefined))
          ),
        { byStdin: true, last: () => true }
      ).pipe(Effect.forkScoped)
      yield* Deferred.await(up)
      yield* Fiber.interrupt(run)
      expect(readFileSync(join(dirname(program), "heard"), "utf8")).toBe(
        "heard\n"
      )
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
)

it.live(
  "the engine's first line gives its address and its door, and the window's end stops it",
  () =>
    Effect.gen(function* () {
      const program = script(
        `echo $$ > "$(dirname "$0")/pid"\n` +
          `echo '{"protocol":1,"port":4321,"secret":"s3","window":"/run/door"}'\n` +
          "exec sleep 60"
      )
      const [address, door] = yield* Engine.use((engine) =>
        Effect.all([engine.address, engine.door])
      ).pipe(
        Effect.provide(
          engineLayer().pipe(
            Layer.provide(Program.layer({ program })),
            Layer.provide(NodeServices.layer)
          )
        )
      )
      expect(address).toEqual({ url: "ws://127.0.0.1:4321/ws", secret: "s3" })
      expect(door).toBe("/run/door")
      const pid = Number(readFileSync(join(dirname(program), "pid"), "utf8"))
      expect(() => process.kill(pid, 0)).toThrow()
    })
)

it.live(
  "the window follows the engine with banda start; one that stopped as asked quits the window, one that crashed starts again",
  () =>
    Effect.gen(function* () {
      const program = script(
        `echo "$@" >> "$(dirname "$0")/runs"\n` +
          `echo '{"protocol":1,"port":1,"secret":"s","window":"/w"}'\n` +
          `[ "$(wc -l < "$(dirname "$0")/runs")" -ge 2 ] && exit 0\n` +
          "exit 1"
      )
      let quit = () => {}
      const quits = new Promise<void>((done) => {
        quit = done
      })
      yield* Effect.gen(function* () {
        yield* Engine.use((engine) => engine.address)
        yield* Effect.promise(() => quits)
      }).pipe(
        Effect.provide(
          engineLayer(Effect.succeed(Option.none()), {}, quit).pipe(
            Layer.provide(Program.layer({ program })),
            Layer.provide(NodeServices.layer)
          )
        )
      )
      const runs = readFileSync(join(dirname(program), "runs"), "utf8")
      expect(runs.trim().split("\n")).toEqual([
        "start --with-parent",
        "start --with-parent",
      ])
    })
)

it.live(
  "an engine stopped as asked, but not by Quit Banda, leaves the window up: the page hears it is stopped, and it starts again when asked",
  () =>
    Effect.gen(function* () {
      // Its first two runs end as `banda start` does for such a stop.
      const program = script(
        `echo "$@" >> "$(dirname "$0")/runs"\n` +
          `[ "$(wc -l < "$(dirname "$0")/runs")" -ge 3 ] || exit 3\n` +
          `echo '{"protocol":1,"port":4321,"secret":"s3","window":"/w"}'\n` +
          "exec sleep 60"
      )
      const quit = vi.fn()
      const runs = () =>
        readFileSync(join(dirname(program), "runs"), "utf8")
          .trim()
          .split("\n")
      yield* Effect.gen(function* () {
        const own = yield* OwnEngine
        const why = yield* Effect.flip(own.reached)
        expect(why).toBeInstanceOf(EngineStopped)
        expect(why.message).toBe("Banda is stopped on this machine")
        // Stopped, it stays so: asked again, the same, and no new run.
        expect((yield* Effect.flip(own.reached)).message).toBe(why.message)
        expect(runs()).toHaveLength(1)
        expect(quit).not.toHaveBeenCalled()
        // Started, twice over, it runs once; stopped again, it stays so,
        // with no Start left over to start it.
        yield* own.start
        yield* own.start
        expect((yield* Effect.flip(own.reached)).message).toBe(why.message)
        yield* Effect.sleep("300 millis")
        expect(runs()).toHaveLength(2)
        // Started again, the address asked next waits for it.
        yield* own.start
        expect(yield* own.reached).toEqual({
          url: "ws://127.0.0.1:4321/ws",
          secret: "s3",
        })
        expect(runs()).toHaveLength(3)
        expect(quit).not.toHaveBeenCalled()
      }).pipe(
        Effect.provide(
          engineLayer(Effect.succeed(Option.none()), {}, quit).pipe(
            Layer.provide(Program.layer({ program })),
            Layer.provide(NodeServices.layer)
          )
        )
      )
    })
)

it("this device's key signs only a hello of Banda's page to the door that proves its machine's host key", () => {
  const hello = (hostKey: string, origin: string) =>
    `banda-door/hello/1\ndoor-nonce\n${hostKey}\n${origin}\nmine`
  expect(helloTo(hello("H0ST", "app://banda"), "H0ST")).toBe(true)
  // Another machine's door, another page, another message, or one with
  // more to it: none.
  expect(helloTo(hello("0THER", "app://banda"), "H0ST")).toBe(false)
  expect(helloTo(hello("H0ST", "https://elsewhere.example"), "H0ST")).toBe(
    false
  )
  expect(helloTo("banda-door/welcome/1\nmine\ndevice", "H0ST")).toBe(false)
  expect(helloTo(`${hello("H0ST", "app://banda")}\nmore`, "H0ST")).toBe(false)
  expect(helloTo("pay Bob", "H0ST")).toBe(false)
})

it.live(
  "an engine with no door is reached as before, and nothing is signed for it",
  () =>
    Effect.gen(function* () {
      const program = script(
        `echo '{"protocol":1,"port":4321,"secret":"s3","window":"/w"}'\n` +
          "exec sleep 60"
      )
      const key = deviceKey(join(dirname(program), "device.key"))
      yield* Effect.gen(function* () {
        const own = yield* OwnEngine
        expect(yield* own.reached).toEqual({
          url: "ws://127.0.0.1:4321/ws",
          secret: "s3",
        })
        const refused = yield* Effect.flip(
          own.sign("banda-door/hello/1\nn\nH0ST\napp://banda\nm")
        )
        expect(refused.message).toContain("signs only its hello")
      }).pipe(
        Effect.provide(
          engineLayer(Effect.succeed(Option.none()), {}, () => {}, key).pipe(
            Layer.provide(Program.layer({ program })),
            Layer.provide(NodeServices.layer)
          )
        )
      )
    })
)

it.live(
  "the engine starts with the PATH it is given, as the login shell's",
  () =>
    Effect.gen(function* () {
      const program = script(
        `printenv PATH > "$(dirname "$0")/path"\n` +
          `echo '{"protocol":1,"port":1,"secret":"s","window":"/w"}'\n` +
          "exec sleep 60"
      )
      const path = `/Users/p/.local/bin:${process.env.PATH}`
      yield* Engine.use((engine) => engine.address).pipe(
        Effect.provide(
          engineLayer(Effect.succeed(Option.some(path))).pipe(
            Layer.provide(Program.layer({ program })),
            Layer.provide(NodeServices.layer)
          )
        )
      )
      expect(readFileSync(join(dirname(program), "path"), "utf8").trim()).toBe(
        path
      )
    })
)

/** Quit Banda's stop of the engine, its `banda` `program`. */
const stopOf = (program: string) =>
  Stop.layer.pipe(
    Layer.provide(Program.layer({ program })),
    Layer.provide(NodeServices.layer)
  )

it.live(
  "Quit Banda runs banda stop --force; macOS's Quit runs banda stop, which says whether Agents work and stopped nothing",
  () =>
    Effect.gen(function* () {
      // Without --force it refuses, as `banda stop` with no terminal to
      // ask in does while Agents work (engine/src/control.rs).
      const working = script(
        `echo "$@" >> "$(dirname "$0")/runs"\n` +
          `[ "$2" = "--force" ] && exit 0\n` +
          `echo '{"error":{"code":"conflict","message":"An Agent works on this computer. Quitting Banda stops it too."}}'\n` +
          "exit 1"
      )
      const asks = yield* Stop.use((stop) =>
        Effect.andThen(stop.engine, stop.unlessWorking)
      ).pipe(Effect.provide(stopOf(working)))
      expect(asks).toBe(true)
      const runs = readFileSync(join(dirname(working), "runs"), "utf8")
      expect(runs.trim().split("\n")).toEqual(["stop --force", "stop"])
      // With none at work it stopped the engine; one that refuses for
      // another reason, breaks, or does not run could not: Banda quits.
      for (const program of [
        script("exit 0"),
        script(`echo '{"error":{"code":"forbidden","message":"No."}}'\nexit 1`),
        script("exit 2"),
        join(dirname(working), "missing"),
      ])
        expect(
          yield* Stop.use((stop) => stop.unlessWorking).pipe(
            Effect.provide(stopOf(program))
          )
        ).toBe(false)
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
      ).pipe(Effect.provide(lookOf(program)))
      expect(modes).toEqual(["dark", "light"])
    })
)

it.live(
  "the look is asked to watch the window, so it goes when the window goes",
  () =>
    Effect.gen(function* () {
      const program = script(
        `echo "$@" > "$(dirname "$0")/args"\necho '{"mode":"dark"}'\nexec sleep 60`
      )
      yield* firstLook(5000).pipe(Effect.provide(lookOf(program)))
      expect(readFileSync(join(dirname(program), "args"), "utf8").trim()).toBe(
        "look --follow --with-parent"
      )
    })
)

it.live("the window opens without its look when none came in time", () =>
  Effect.gen(function* () {
    const program = script("exec sleep 60")
    const first = yield* firstLook(50).pipe(Effect.provide(lookOf(program)))
    expect(first).toBeNull()
  })
)
