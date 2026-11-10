import { describe, expect, it } from "@effect/vitest"
import { Deferred, Effect, Fiber } from "effect"
import { TestClock } from "effect/testing"
import {
  AGAIN,
  asksOnQuit,
  dockShows,
  hidesOnClose,
  onDock,
  quitAsking,
  startsHidden,
} from "./closing"

const mac = { platform: "darwin", quitting: false, poweringOff: false } as const
const macQuitting = { ...mac, quitting: true } as const
const macPoweringOff = { ...mac, poweringOff: true } as const
const others = (["linux", "win32"] as const).flatMap((platform) => [
  { platform, quitting: false, poweringOff: false },
  { platform, quitting: true, poweringOff: false },
  { platform, quitting: false, poweringOff: true },
])

describe("on macOS, where Banda lives in the menu bar", () => {
  it("closing the main window hides it, and the engine and its Agents go on", () => {
    expect(hidesOnClose(mac)).toBe(true)
    expect(hidesOnClose(macPoweringOff)).toBe(true)
  })

  it("a window closing as Banda quits closes", () => {
    expect(hidesOnClose(macQuitting)).toBe(false)
  })

  it("a quit the app is asked for is Quit Banda, asking first while Agents work, with a window to ask in", () => {
    expect(asksOnQuit(mac, true)).toBe(true)
    // Before the window opens, or in a second Banda that leaves at once.
    expect(asksOnQuit(mac, false)).toBe(false)
  })

  it("a quit Banda makes itself goes through: Quit Banda, banda stop, an update", () => {
    expect(asksOnQuit(macQuitting, true)).toBe(false)
  })

  it("a logout, restart or shutdown goes through, with nobody there to answer", () => {
    expect(asksOnQuit(macPoweringOff, true)).toBe(false)
  })

  it("the Dock's icon shows the window, or opens one when there is none", () => {
    expect(onDock(mac, true)).toBe("show")
    expect(onDock(mac, false)).toBe("open")
    expect(onDock(macQuitting, true)).toBe(null)
    expect(onDock(macQuitting, false)).toBe(null)
  })

  it("the Dock shows Banda's icon only while a window shows (ADR 0086, decision 4)", () => {
    expect(dockShows("darwin", true)).toBe(true)
    expect(dockShows("darwin", false)).toBe(false)
  })

  it("an app the engine opened, as it found none, shows no window: only the menu bar icon", () => {
    const opened = ["/Applications/Banda Dev.app/Contents/MacOS/banda-dev"]
    expect(startsHidden("darwin", [...opened, "--hidden"], false)).toBe(true)
    // `open -j` leaves it hidden, as the Person's Hide does.
    expect(startsHidden("darwin", opened, true)).toBe(true)
    // Opened by the Person, from the Finder, Spotlight or the Dock.
    expect(startsHidden("darwin", opened, false)).toBe(false)
  })
})

describe("on Linux and Windows, as before", () => {
  it("closing the window closes it, a quit goes at once, and the Dock is not there", () => {
    for (const at of others) {
      expect(hidesOnClose(at)).toBe(false)
      expect(asksOnQuit(at, true)).toBe(false)
      expect(onDock(at, true)).toBe(null)
      expect(dockShows(at.platform, false)).toBe(null)
    }
  })

  it("every launch shows its window", () => {
    for (const platform of ["linux", "win32"] as const)
      expect(startsHidden(platform, ["banda", "--hidden"], true)).toBe(false)
  })
})

/** Quit Banda as a quit the app is asked for runs it, where `banda stop`
 * finds Agents at work unless `working` says otherwise, the page can ask
 * unless `pageCan` says otherwise, and the system dialog's answer is
 * `yes`; `did` is what it did, in order. */
function quitWith({
  working = Effect.succeed(true),
  pageCan = true,
  yes = false,
}: {
  working?: Effect.Effect<boolean>
  pageCan?: boolean
  yes?: boolean
} = {}) {
  const did: string[] = []
  const note = (what: string) =>
    Effect.sync(() => {
      did.push(what)
    })
  const quit = quitAsking({
    working: Effect.andThen(note("banda stop"), working),
    pageCan: Effect.succeed(pageCan),
    askPage: note("page asks"),
    askSystem: Effect.as(note("system asks"), yes),
    quitBanda: note("Quit Banda"),
    leave: note("quits"),
  })
  return { did, quit }
}

describe("Quit Banda, as macOS's Quit runs it", () => {
  it.effect(
    "where no Agent works, banda stop stopped the engine, and Banda quits, asking nothing",
    () =>
      Effect.gen(function* () {
        const { did, quit } = quitWith({ working: Effect.succeed(false) })
        yield* quit
        expect(did).toEqual(["banda stop", "quits"])
      })
  )

  it.effect("where Agents work, the page asks, as on Ctrl+Q", () =>
    Effect.gen(function* () {
      const { did, quit } = quitWith()
      yield* quit
      expect(did).toEqual(["banda stop", "page asks"])
    })
  )

  it.effect(
    "a quit again soon after asks in a system dialog, and Banda quits as the Person says",
    () =>
      Effect.gen(function* () {
        const no = quitWith()
        yield* no.quit
        yield* TestClock.adjust(AGAIN - 1)
        yield* no.quit
        // The Person said no: the next quit is the page's to ask again.
        yield* no.quit
        expect(no.did).toEqual([
          "banda stop",
          "page asks",
          "banda stop",
          "system asks",
          "banda stop",
          "page asks",
        ])

        const yes = quitWith({ yes: true })
        yield* yes.quit
        yield* yes.quit
        expect(yes.did).toEqual([
          "banda stop",
          "page asks",
          "banda stop",
          "system asks",
          "Quit Banda",
        ])
      })
  )

  it.effect("a quit long after the page asked asks in the page again", () =>
    Effect.gen(function* () {
      const { did, quit } = quitWith()
      yield* quit
      yield* TestClock.adjust(AGAIN)
      yield* quit
      expect(did).toEqual([
        "banda stop",
        "page asks",
        "banda stop",
        "page asks",
      ])
    })
  )

  it.effect(
    "a page that crashed or loads cannot ask: the system dialog does",
    () =>
      Effect.gen(function* () {
        const { did, quit } = quitWith({ pageCan: false, yes: true })
        yield* quit
        expect(did).toEqual(["banda stop", "system asks", "Quit Banda"])
      })
  )

  it.effect(
    "a quit asked for while banda stop still runs does nothing more",
    () =>
      Effect.gen(function* () {
        const answered = yield* Deferred.make<boolean>()
        const { did, quit } = quitWith({ working: Deferred.await(answered) })
        const first = yield* Effect.forkChild(quit)
        yield* Effect.yieldNow
        yield* quit
        yield* Deferred.succeed(answered, true)
        yield* Fiber.join(first)
        expect(did).toEqual(["banda stop", "page asks"])
      })
  )
})
