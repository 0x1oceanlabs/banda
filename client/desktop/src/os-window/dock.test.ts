import { vi } from "vitest"

vi.mock("electron", () => ({ app: {}, BrowserWindow: {} }))
import { expect, it } from "@effect/vitest"
import { Context, Effect, Exit, Layer, Scope } from "effect"
import { TestClock } from "effect/testing"
import { type Counted, DOCK_SETTLES, HIDDEN } from "../closing"
import { Dock, type Docked } from "./dock"

const SHOWN: Counted = { visible: true, minimized: false }
const CLOSED: Counted = { visible: false, minimized: false }

/** A Mac's app and Dock: its windows, whether it is hidden, and what was
 * `done` to its icon. */
function mac(args: string[] = []) {
  const done: string[] = []
  const now = { windows: [SHOWN], hidden: false }
  const system: Docked = {
    platform: "darwin",
    args: ["/Applications/Banda.app/Contents/MacOS/banda", ...args],
    hidden: () => now.hidden,
    windows: () => now.windows,
    icon: () => ({
      show: () => {
        done.push("show")
        return Promise.resolve()
      },
      hide: () => void done.push("hide"),
    }),
  }
  return { system, done, now }
}

/** The Dock of `system`, long after the machine's clock started, as any
 * real launch is. */
const at = <A, E>(system: Docked, body: Effect.Effect<A, E, Dock>) =>
  Effect.andThen(
    TestClock.adjust("1 day"),
    Effect.provide(body, Dock.layer(system))
  )

it.effect(
  "the icon follows the windows: gone with none open, back with one, and never shown twice (ADR 0086, decision 4)",
  () => {
    const { system, done, now } = mac()
    return at(
      system,
      Effect.gen(function* () {
        const dock = yield* Dock
        expect(dock.startsHidden).toBe(false)
        // Shown as Banda starts: nothing to do.
        dock.follow()
        expect(done).toEqual([])
        expect(dock.unseen()).toBe(false)
        now.windows = [CLOSED]
        dock.follow()
        expect(done).toEqual(["hide"])
        expect(dock.unseen()).toBe(true)
        // Minimized into the Dock, the window is still open.
        now.windows = [{ visible: false, minimized: true }]
        dock.follow()
        dock.follow()
        expect(done).toEqual(["hide", "show"])
        // Asked back while it shows, nothing: a show takes the focus.
        expect(dock.show()).toBeNull()
        expect(done).toEqual(["hide", "show"])
      })
    )
  }
)

it.effect(
  "a hide right after a show waits for the Dock to settle, and a window shown meanwhile keeps the icon",
  () => {
    const { system, done, now } = mac()
    return at(
      system,
      Effect.gen(function* () {
        const dock = yield* Dock
        now.windows = []
        dock.follow()
        expect(dock.show()).toBeInstanceOf(Promise)
        expect(done).toEqual(["hide", "show"])
        // Electron would lose a hide now: it waits.
        dock.follow()
        yield* TestClock.adjust(DOCK_SETTLES - 1)
        expect(done).toEqual(["hide", "show"])
        yield* TestClock.adjust(1)
        expect(done).toEqual(["hide", "show", "hide"])
        // A window shown while it waits: the hide is dropped.
        yield* TestClock.adjust("1 minute")
        void dock.show()
        dock.follow()
        now.windows = [SHOWN]
        dock.follow()
        yield* TestClock.adjust(DOCK_SETTLES)
        expect(done).toEqual(["hide", "show", "hide", "show"])
      })
    )
  }
)

it.effect("hidden by ⌘H, the icon stays as it is", () => {
  const { system, done, now } = mac()
  return at(
    system,
    Effect.gen(function* () {
      const dock = yield* Dock
      now.windows = [CLOSED]
      now.hidden = true
      dock.follow()
      expect(done).toEqual([])
      // Its icon still there, it is not unseen.
      expect(dock.unseen()).toBe(false)
    })
  )
})

it.effect(
  "a launch the engine made starts with no icon, by --hidden or as the app opened hidden; the icon comes back as it is asked for",
  () => {
    const said = mac([HIDDEN])
    const opened = mac()
    opened.now.hidden = true
    return Effect.gen(function* () {
      yield* at(
        said.system,
        Effect.gen(function* () {
          const dock = yield* Dock
          expect(dock.startsHidden).toBe(true)
          expect(said.done).toEqual(["hide"])
          said.now.windows = []
          expect(dock.unseen()).toBe(true)
          expect(dock.show()).toBeInstanceOf(Promise)
          expect(said.done).toEqual(["hide", "show"])
        })
      )
      yield* at(
        opened.system,
        Effect.gen(function* () {
          expect((yield* Dock).startsHidden).toBe(true)
          expect(opened.done).toEqual(["hide"])
        })
      )
    })
  }
)

it.effect("off macOS there is no Dock: nothing is done, or asked", () => {
  const system: Docked = {
    platform: "linux",
    args: ["banda", HIDDEN],
    // Electron has it on macOS alone.
    hidden: () => {
      throw new Error("asked whether it is hidden")
    },
    windows: () => [],
    icon: () => undefined,
  }
  return at(
    system,
    Effect.gen(function* () {
      const dock = yield* Dock
      expect(dock.startsHidden).toBe(false)
      dock.follow()
      expect(dock.show()).toBeNull()
      expect(dock.unseen()).toBe(false)
    })
  )
})

it.effect("a hide that waits goes with main", () => {
  const { system, done, now } = mac()
  return Effect.gen(function* () {
    yield* TestClock.adjust("1 day")
    const scope = yield* Scope.make()
    const dock = Context.get(
      yield* Layer.buildWithScope(Dock.layer(system), scope),
      Dock
    )
    now.windows = []
    dock.follow()
    void dock.show()
    dock.follow()
    yield* Scope.close(scope, Exit.void)
    yield* TestClock.adjust(DOCK_SETTLES)
    expect(done).toEqual(["hide", "show"])
  })
})
