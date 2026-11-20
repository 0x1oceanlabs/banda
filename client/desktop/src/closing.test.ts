import { describe, expect, it } from "@effect/vitest"
import { Deferred, Effect, Fiber } from "effect"
import { TestClock } from "effect/testing"
import {
  AGAIN,
  asksOnQuit,
  DOCK_SETTLES,
  dockShows,
  dockStep,
  hidesOnClose,
  onClose,
  onDock,
  quitAsking,
  saysStillRuns,
  unseen,
  startsHidden,
} from "./closing"

const mac = {
  platform: "darwin",
  quitting: false,
  poweringOff: false,
  icon: true,
} as const
const macQuitting = { ...mac, quitting: true } as const
const macPoweringOff = { ...mac, poweringOff: true } as const
const linux = { ...mac, platform: "linux" } as const
const windows = { ...mac, platform: "win32" } as const
const others = [linux, windows].flatMap((at) => [
  at,
  { ...at, quitting: true },
  { ...at, poweringOff: true },
  { ...at, icon: false },
])

describe("on macOS, where Banda lives in the menu bar", () => {
  it("closing the main window hides it, and the engine and its Agents go on", () => {
    expect(onClose(mac)).toBe("hide")
    expect(onClose(macPoweringOff)).toBe("hide")
  })

  it("a window closing as Banda quits closes", () => {
    expect(onClose(macQuitting)).toBe("close")
  })

  it("a quit the app is asked for is Quit Banda, asking first while Agents work, with a window to ask in", () => {
    // By the menu bar's Quit Banda, or by anything else.
    expect(asksOnQuit(mac, true, true)).toBe(true)
    expect(asksOnQuit(mac, true, false)).toBe(true)
    // Before the window opens, or in a second Banda that leaves at once.
    expect(asksOnQuit(mac, false, false)).toBe(false)
  })

  it("a quit Banda makes itself goes through: Quit Banda, banda stop, an update", () => {
    expect(asksOnQuit(macQuitting, true, true)).toBe(false)
  })

  it("a logout, restart or shutdown goes through, with nobody there to answer", () => {
    expect(asksOnQuit(macPoweringOff, true, true)).toBe(false)
  })

  it("the Dock's icon shows the window, or opens one when there is none", () => {
    expect(onDock(mac, true)).toBe("show")
    expect(onDock(mac, false)).toBe("open")
    expect(onDock(macQuitting, true)).toBe(null)
    expect(onDock(macQuitting, false)).toBe(null)
  })

  it("the Dock shows Banda's icon only while a window is open (ADR 0086, decision 4)", () => {
    const shown = { visible: true, minimized: false }
    const minimized = { visible: false, minimized: true }
    const closed = { visible: false, minimized: false }
    expect(dockShows("darwin", [shown], false)).toBe(true)
    expect(dockShows("darwin", [closed, shown], false)).toBe(true)
    // Minimized into the Dock, the window is still open.
    expect(dockShows("darwin", [minimized], false)).toBe(true)
    expect(dockShows("darwin", [closed, minimized], false)).toBe(true)
    expect(dockShows("darwin", [closed], false)).toBe(false)
    expect(dockShows("darwin", [], false)).toBe(false)
    // Hidden by ⌘H, or opened so: the icon stays as it is.
    expect(dockShows("darwin", [closed], true)).toBe(null)
  })

  it("the Dock's icon is shown once, and a hide right after a show waits", () => {
    // As it is: nothing, never a show again, which takes the focus.
    expect(dockStep(true, true, 0, 5_000)).toBe(null)
    expect(dockStep(false, false, 0, 5_000)).toBe(null)
    expect(dockStep(true, false, 0, 5_000)).toBe("show")
    expect(dockStep(false, true, 0, 5_000)).toBe("hide")
    // Electron ignores a hide within a second of a show.
    expect(dockStep(false, true, 4_500, 5_000)).toBe("later")
    expect(dockStep(false, true, 5_000 - DOCK_SETTLES, 5_000)).toBe("hide")
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

describe("a new version, unseen (ADR 0121)", () => {
  const shown = [{ visible: true, minimized: false }]
  const minimized = [{ visible: false, minimized: true }]
  const closed = [{ visible: false, minimized: false }]

  it("restarts Banda in the menu bar, its window closed or never shown", () => {
    expect(unseen("darwin", closed, false)).toBe(true)
    // Opened by the engine, `open -g -j`: hidden, and no Dock icon.
    expect(unseen("darwin", [], false)).toBe(true)
  })

  it("holds while a window shows or waits in the Dock, or Banda is hidden by ⌘H", () => {
    expect(unseen("darwin", shown, true)).toBe(false)
    expect(unseen("darwin", minimized, true)).toBe(false)
    // A Pane in its own window, the main one closed.
    expect(unseen("darwin", [...closed, ...shown], true)).toBe(false)
    // ⌘H: no window visible, the Dock icon still there.
    expect(unseen("darwin", closed, true)).toBe(false)
  })

  it("holds off macOS", () => {
    expect(unseen("linux", closed, false)).toBe(false)
  })
})

describe("on Linux and Windows, where Banda lives in the tray (ADR 0136, decision 2)", () => {
  it("on Windows closing the main window hides it: the notification area is always there", () => {
    expect(onClose(windows)).toBe("hide")
  })

  it("on Linux it asks whether a tray host is there, hides where one is, and closes on anything but a clear yes", () => {
    expect(onClose(linux)).toBe("ask")
    expect(hidesOnClose(linux, true)).toBe(true)
    expect(hidesOnClose(linux, false)).toBe(false)
    // Banda quit while the bus was asked.
    expect(hidesOnClose({ ...linux, quitting: true }, true)).toBe(false)
  })

  it("with no icon, as on a Linux window with no screen, it closes as before, and nothing is asked", () => {
    expect(onClose({ ...linux, icon: false })).toBe("close")
    expect(onClose({ ...windows, icon: false })).toBe("close")
  })

  it("a window closing as Banda quits, or as an update restarts it, closes", () => {
    for (const at of [linux, windows])
      expect(onClose({ ...at, quitting: true })).toBe("close")
  })

  it("the icon's Quit Banda asks first while Agents work, with a window to ask in, hidden or shown", () => {
    for (const at of [linux, windows]) {
      expect(asksOnQuit(at, true, true)).toBe(true)
      expect(asksOnQuit(at, false, true)).toBe(false)
      expect(asksOnQuit({ ...at, quitting: true }, true, true)).toBe(false)
    }
  })

  it("any other quit goes at once: a signal, as a session ending sends, or the last window closed", () => {
    for (const at of others) expect(asksOnQuit(at, true, false)).toBe(false)
  })

  it("the Dock is not there", () => {
    for (const at of others) {
      expect(onDock(at, true)).toBe(null)
      expect(dockShows(at.platform, [], false)).toBe(null)
      expect(
        dockShows(at.platform, [{ visible: true, minimized: false }], false)
      ).toBe(null)
    }
  })

  it("Windows says once that Banda still runs, as its window first hides; no other system does (decision 6)", () => {
    expect(saysStillRuns("win32", false)).toBe(true)
    expect(saysStillRuns("win32", true)).toBe(false)
    expect(saysStillRuns("linux", false)).toBe(false)
    expect(saysStillRuns("darwin", false)).toBe(false)
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

describe("Quit Banda, as macOS's Quit and the icon's Quit Banda run it", () => {
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
