import { EventEmitter } from "node:events"
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { UpdateState } from "@banda/contract/updates"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

const updater = vi.hoisted(() => ({
  checkForUpdates: vi.fn(async () => null),
  downloadUpdate: vi.fn(async () => []),
  setFeedURL: vi.fn(),
  quitAndInstall: vi.fn(),
  autoInstallOnAppQuit: false,
}))
const electron = vi.hoisted(() => ({
  isPackaged: true,
  getVersion: () => "0.1.0-dev.420",
  getPath: (): string => "/nowhere",
  on: (() => {}) as (event: string, listener: () => void) => void,
}))
vi.mock("electron-updater", () => ({
  autoUpdater: updater,
  Provider: class {},
}))
vi.mock("electron", () => ({ app: electron }))
// A restart starts the new AppImage after this one: not in a test.
vi.mock("node:child_process", () => ({
  spawn: () => ({ unref() {} }),
}))

import { type App, type Engine, updates } from "./app"

const HOUR = 3_600_000
let events: EventEmitter
let quits: EventEmitter
let folder: string
let listed: string | undefined
let mine: App
/** What the engine answers `updates.check` with, as it looks. */
let engine: Engine & { check: ReturnType<typeof vi.fn> }

/** What the engine says once it looked, at `at`, and found `newest`. */
const looked = (newest = "0.1.0-dev.421", at = Date.now()): UpdateState => ({
  running: "0.1.0-dev.420",
  newest,
  looked: at,
})

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(console, "warn").mockImplementation(() => {})
  events = new EventEmitter()
  quits = new EventEmitter()
  Object.assign(updater, { on: events.on.bind(events) })
  electron.on = quits.on.bind(quits)
  for (const fn of [
    updater.checkForUpdates,
    updater.downloadUpdate,
    updater.setFeedURL,
    updater.quitAndInstall,
  ])
    fn.mockClear()
  folder = mkdtempSync(join(tmpdir(), "banda-update-"))
  const image = join(folder, "banda-dev-0.1.0-dev.420-x86_64.AppImage")
  writeFileSync(image, "")
  electron.getPath = () => folder
  listed = image
  mine = {
    name: "Banda Dev",
    folder: "banda-dev",
    which: "dev",
    repository: { owner: "o", repo: "r" },
    listApp: () => {},
    listedImage: () => listed,
  }
  engine = { check: vi.fn(async () => looked()) }
  vi.stubEnv("APPIMAGE", image)
  vi.stubEnv("BANDA_UPDATES", "")
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  rmSync(folder, { recursive: true, force: true })
})

/** A version's update, as the source answers it. */
const offer = (version: string) => ({
  version,
  releaseNotes: [{ version, note: `the change in ${version}` }],
})

/** Banda Dev with 0.1.0-dev.421 down and ready, once its engine looked. */
function ready(leaving = vi.fn()) {
  const update = updates(mine, engine, vi.fn(), leaving)
  update.heard(looked())
  events.emit("update-available", offer("0.1.0-dev.421"))
  events.emit("update-downloaded", offer("0.1.0-dev.421"))
  expect(update.current()).toMatchObject({
    state: "ready",
    version: "0.1.0-dev.421",
  })
  return update
}

/** Whether the quit now would install the version ready. */
function quitInstalls(): boolean {
  quits.emit("will-quit")
  return updater.autoInstallOnAppQuit
}

/** The machine sleeps for `ms`: the clock moves on, the timers do not. */
function sleep(ms: number) {
  vi.setSystemTime(Date.now() + ms)
}

/** Whether Banda restarted into the version ready. */
async function restarted(): Promise<boolean> {
  await vi.advanceTimersByTimeAsync(0)
  return updater.quitAndInstall.mock.calls.length > 0
}

it("reads the release its engine found newest, once for each look the engine made", () => {
  const update = updates(mine, engine, vi.fn())
  const [source] = updater.setFeedURL.mock.calls[0] as [
    { provider: string; which: string; folder: string; newest: () => unknown },
  ]
  expect(source).toMatchObject({
    provider: "custom",
    which: "dev",
    folder: "banda-dev",
  })
  expect(update.current()).toMatchObject({ state: "none", always: true })
  // It looks at nothing by itself: the engine looks.
  vi.advanceTimersByTime(2 * HOUR)
  expect(updater.checkForUpdates).not.toHaveBeenCalled()
  const first = looked("0.1.0-dev.421", 1000)
  update.heard(first)
  expect(source.newest()).toBe("0.1.0-dev.421")
  expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
  // A take's progress is no new look.
  update.heard({
    ...first,
    taking: { version: "0.1.0-dev.421", share: 0.5, size: 1 },
  })
  expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
  update.heard(looked("0.1.0-dev.422", 2000))
  expect(source.newest()).toBe("0.1.0-dev.422")
  expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
  expect(engine.check).not.toHaveBeenCalled()
})

it("downloads what a look offers, and installs it at the quit", () => {
  ready()
  expect(updater.downloadUpdate).toHaveBeenCalledTimes(1)
  expect(quitInstalls()).toBe(true)
})

it("keeps reading while a version is ready, and keeps it while it is offered", () => {
  const update = ready()
  vi.advanceTimersByTime(HOUR)
  update.heard(looked())
  expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
  events.emit("update-available", offer("0.1.0-dev.421"))
  expect(update.current()).toMatchObject({ state: "ready" })
  // It is down: no download again.
  expect(updater.downloadUpdate).toHaveBeenCalledTimes(1)
  expect(quitInstalls()).toBe(true)
})

it("downloads a newer version in place of the one ready", () => {
  const update = ready()
  vi.advanceTimersByTime(HOUR)
  update.heard(looked("0.1.0-dev.425"))
  events.emit("update-available", offer("0.1.0-dev.425"))
  expect(update.current()).toMatchObject({
    state: "downloading",
    version: "0.1.0-dev.425",
    restarts: false,
  })
  expect(updater.downloadUpdate).toHaveBeenCalledTimes(2)
  // Not while it downloads: the one ready went with its download.
  expect(quitInstalls()).toBe(false)
  events.emit("update-downloaded", offer("0.1.0-dev.425"))
  expect(update.current()).toMatchObject({
    state: "ready",
    version: "0.1.0-dev.425",
  })
  expect(quitInstalls()).toBe(true)
})

it("drops a version ready once a look finds it withdrawn (ADR 0092, decision 10)", () => {
  const update = ready()
  vi.advanceTimersByTime(HOUR)
  update.heard(looked("0.1.0-dev.420"))
  events.emit("update-not-available", { version: "0.1.0-dev.420" })
  expect(update.current()).toMatchObject({ state: "none" })
  expect(quitInstalls()).toBe(false)
  // Restart has nothing to install.
  update.restart()
  expect(updater.quitAndInstall).not.toHaveBeenCalled()
})

it("installs nothing at the quit once the last look is over an hour old", () => {
  const update = ready()
  // Two hours with no answer: offline, or asleep.
  vi.advanceTimersByTime(2 * HOUR)
  expect(quitInstalls()).toBe(false)
  update.heard(looked())
  events.emit("update-available", offer("0.1.0-dev.421"))
  expect(quitInstalls()).toBe(true)
})

it("restarts at once into a version the last look offered, and stops no engine", async () => {
  const leaving = vi.fn()
  const update = ready(leaving)
  update.restart()
  expect(await restarted()).toBe(true)
  expect(leaving).toHaveBeenCalledTimes(1)
  expect(engine.check).not.toHaveBeenCalled()
  expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
})

it("after a sleep, asks the engine to look, and restarts once the look offers the version again", async () => {
  const update = ready()
  sleep(3 * HOUR)
  update.restart()
  expect(await restarted()).toBe(false)
  expect(engine.check).toHaveBeenCalledTimes(1)
  // The engine's answer is read: the release it found newest.
  expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
  events.emit("update-available", offer("0.1.0-dev.421"))
  expect(await restarted()).toBe(true)
})

it("after a sleep, drops a version withdrawn since instead of restarting into it", async () => {
  const update = ready()
  sleep(3 * HOUR)
  update.restart()
  await vi.advanceTimersByTimeAsync(0)
  events.emit("update-not-available", { version: "0.1.0-dev.420" })
  expect(update.current()).toMatchObject({ state: "none" })
  expect(await restarted()).toBe(false)
})

it("after a sleep, a Restart whose look fails restarts nothing, and says why", async () => {
  const update = ready()
  sleep(3 * HOUR)
  update.now()
  await vi.advanceTimersByTimeAsync(0)
  events.emit("error", new Error("net::ERR_INTERNET_DISCONNECTED\nmore"))
  expect(update.current()).toMatchObject({
    state: "failed",
    reason:
      "Could not check that 0.1.0-dev.421 is still out: net::ERR_INTERNET_DISCONNECTED",
  })
  expect(await restarted()).toBe(false)
  expect(quitInstalls()).toBe(false)
  // The next look readies it again, from the file already down, and
  // restarts nothing by itself: "Update now" ended with the failure.
  update.heard(looked())
  events.emit("update-available", offer("0.1.0-dev.421"))
  events.emit("update-downloaded", offer("0.1.0-dev.421"))
  expect(update.current()).toMatchObject({ state: "ready" })
  expect(await restarted()).toBe(false)
  expect(quitInstalls()).toBe(true)
})

it("after a sleep, a Restart while the engine is away says so", async () => {
  engine.check.mockRejectedValue(new Error("Banda's engine is not running"))
  const update = ready()
  sleep(3 * HOUR)
  update.restart()
  await vi.advanceTimersByTimeAsync(0)
  expect(update.current()).toMatchObject({
    state: "failed",
    reason:
      "Could not check that 0.1.0-dev.421 is still out: Banda's engine is not running",
  })
  expect(await restarted()).toBe(false)
})

it("Update now asks the engine to look, and restarts once the version is down", async () => {
  const update = updates(mine, engine, vi.fn())
  update.now()
  expect(update.current()).toMatchObject({ state: "looking" })
  expect(engine.check).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(0)
  expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
  events.emit("update-available", offer("0.1.0-dev.421"))
  expect(update.current()).toMatchObject({
    state: "downloading",
    restarts: true,
  })
  events.emit("update-downloaded", offer("0.1.0-dev.421"))
  expect(await restarted()).toBe(true)
})

it("Update now whose download fails restarts nothing later", async () => {
  const update = updates(mine, engine, vi.fn())
  update.now()
  await vi.advanceTimersByTimeAsync(0)
  events.emit("update-available", offer("0.1.0-dev.421"))
  expect(update.current()).toMatchObject({ restarts: true })
  events.emit("error", new Error("net::ERR_CONNECTION_RESET"))
  vi.advanceTimersByTime(HOUR)
  update.heard(looked())
  events.emit("update-available", offer("0.1.0-dev.421"))
  events.emit("update-downloaded", offer("0.1.0-dev.421"))
  expect(update.current()).toMatchObject({ state: "ready" })
  expect(await restarted()).toBe(false)
})

it("a look the Person asks for says what it found", async () => {
  const update = updates(mine, engine, vi.fn())
  update.check()
  expect(update.current()).toMatchObject({ state: "looking" })
  await vi.advanceTimersByTimeAsync(0)
  events.emit("update-not-available", { version: "0.1.0-dev.420" })
  expect(update.current()).toMatchObject({
    state: "none",
    looked: Date.now(),
  })
})

it("takes nothing where the engine takes nothing, and says why when asked", async () => {
  const off = {
    running: "0.1.0-dev.420",
    off: 'machine.toml says updates = "off"',
  }
  engine.check.mockResolvedValue(off)
  const update = updates(mine, engine, vi.fn())
  update.heard(off)
  expect(updater.checkForUpdates).not.toHaveBeenCalled()
  update.check()
  await vi.advanceTimersByTimeAsync(0)
  expect(updater.checkForUpdates).not.toHaveBeenCalled()
  expect(update.current()).toMatchObject({
    state: "none",
    missed: 'machine.toml says updates = "off"',
  })
})

it("ignores looks while it restarts, so nothing deletes the version it installs", () => {
  const update = ready()
  updater.quitAndInstall.mockImplementationOnce(() => {
    // The engine's next look comes as the app quits.
    update.heard(looked("0.1.0-dev.425"))
    update.check()
    events.emit("update-available", offer("0.1.0-dev.425"))
    events.emit("update-not-available", { version: "0.1.0-dev.420" })
  })
  update.restart()
  expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
  expect(updater.downloadUpdate).toHaveBeenCalledTimes(1)
  expect(update.current()).toMatchObject({
    state: "ready",
    version: "0.1.0-dev.421",
  })
  expect(updater.quitAndInstall).toHaveBeenCalledTimes(1)
})

// Root writes anywhere, and Windows has no such modes.
it.skipIf(process.getuid?.() === 0 || process.platform === "win32")(
  "downloads nothing into an AppImage it cannot replace",
  () => {
    chmodSync(folder, 0o555)
    try {
      const update = updates(mine, engine, vi.fn())
      update.heard(looked())
      events.emit("update-available", offer("0.1.0-dev.421"))
      expect(updater.downloadUpdate).not.toHaveBeenCalled()
      expect(update.current()).toMatchObject({
        state: "failed",
        reason: `Banda cannot write ${folder}, so 0.1.0-dev.421 cannot install`,
      })
    } finally {
      chmodSync(folder, 0o755)
    }
  }
)

it("installs nothing at the quit at or below the version the launcher's entry starts", () => {
  ready()
  listed = join(folder, "banda-dev-0.1.0-dev.421-x86_64.AppImage")
  expect(quitInstalls()).toBe(false)
  listed = join(folder, "Banda Dev.AppImage")
  expect(quitInstalls()).toBe(true)
})

it("a look while one is ready shows nothing and drops nothing when it fails", async () => {
  const update = ready()
  update.check()
  await vi.advanceTimersByTimeAsync(0)
  expect(update.current()).toMatchObject({ state: "ready" })
  events.emit("error", new Error("net::ERR_INTERNET_DISCONNECTED"))
  expect(update.current()).toMatchObject({ state: "ready" })
})

it("looks for nothing with BANDA_UPDATES=off, for trials and CI", () => {
  vi.stubEnv("BANDA_UPDATES", "off")
  const update = updates(mine, engine, vi.fn())
  expect(update.current()).toMatchObject({ state: "none", always: false })
  update.heard(looked())
  update.check()
  expect(updater.setFeedURL).not.toHaveBeenCalled()
  expect(updater.checkForUpdates).not.toHaveBeenCalled()
  expect(engine.check).not.toHaveBeenCalled()
})
