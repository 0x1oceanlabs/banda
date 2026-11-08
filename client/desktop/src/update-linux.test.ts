import { EventEmitter } from "node:events"
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
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
const entry = vi.hoisted(() => ({
  listApp: () => {},
  listedImage: (): string | undefined => undefined,
}))
const power = vi.hoisted(() => ({
  on: (() => {}) as (event: string, listener: () => void) => void,
}))
vi.mock("electron-updater", () => ({
  autoUpdater: updater,
  Provider: class {},
}))
vi.mock("electron", () => ({ app: electron, powerMonitor: power }))
// A restart starts the new AppImage after this one: not in a test.
vi.mock("node:child_process", () => ({
  spawn: () => ({ unref() {} }),
}))
vi.mock("./channel", () => {
  const dev = { name: "Banda Dev", folder: "banda-dev" }
  return { channel: dev, CHANNELS: { dev, local: {}, stable: {} } }
})
vi.mock("./entry", () => entry)

import { updates } from "./update"

const HOUR = 3_600_000
let events: EventEmitter
let quits: EventEmitter
let wakes: EventEmitter
let folder: string

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(console, "warn").mockImplementation(() => {})
  events = new EventEmitter()
  quits = new EventEmitter()
  wakes = new EventEmitter()
  Object.assign(updater, { on: events.on.bind(events) })
  electron.on = quits.on.bind(quits)
  power.on = wakes.on.bind(wakes)
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
  entry.listedImage = () => image
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

/** Banda Dev with 0.1.0-dev.421 down and ready, a minute after its start. */
async function ready() {
  const update = updates(vi.fn())
  await vi.advanceTimersByTimeAsync(60_000)
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

/** Whether Banda restarted into the version ready, once `before` ran. */
async function restarted(): Promise<boolean> {
  await vi.advanceTimersByTimeAsync(0)
  return updater.quitAndInstall.mock.calls.length > 0
}

it("reads Banda Dev's own source, and looks a minute after the start, then hourly", async () => {
  const update = updates(vi.fn())
  expect(updater.setFeedURL).toHaveBeenCalledWith(
    expect.objectContaining({ provider: "custom", which: "dev" })
  )
  expect(update.current()).toMatchObject({ state: "none", always: true })
  await vi.advanceTimersByTimeAsync(60_000)
  expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(HOUR)
  expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
})

it("downloads what a look offers, and installs it at the quit", async () => {
  await ready()
  expect(updater.downloadUpdate).toHaveBeenCalledTimes(1)
  expect(quitInstalls()).toBe(true)
})

it("keeps looking while a version is ready, and keeps it while it is offered", async () => {
  const update = await ready()
  await vi.advanceTimersByTimeAsync(HOUR)
  expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
  events.emit("update-available", offer("0.1.0-dev.421"))
  expect(update.current()).toMatchObject({ state: "ready" })
  // It is down: no download again.
  expect(updater.downloadUpdate).toHaveBeenCalledTimes(1)
  expect(quitInstalls()).toBe(true)
})

it("downloads a newer version in place of the one ready, still restarting when idle", async () => {
  const update = await ready()
  update.wait()
  await vi.advanceTimersByTimeAsync(HOUR)
  events.emit("update-available", offer("0.1.0-dev.425"))
  expect(update.current()).toMatchObject({
    state: "downloading",
    version: "0.1.0-dev.425",
    restarts: true,
  })
  expect(updater.downloadUpdate).toHaveBeenCalledTimes(2)
  // Not while it downloads: the one ready went with its download.
  expect(quitInstalls()).toBe(false)
  events.emit("update-downloaded", offer("0.1.0-dev.425"))
  expect(update.current()).toMatchObject({
    state: "ready",
    version: "0.1.0-dev.425",
    waits: true,
  })
  expect(quitInstalls()).toBe(true)
})

it("drops a version ready once a look finds it withdrawn (ADR 0092, decision 10)", async () => {
  const update = await ready()
  await vi.advanceTimersByTimeAsync(HOUR)
  events.emit("update-not-available", { version: "0.1.0-dev.420" })
  expect(update.current()).toMatchObject({ state: "none" })
  expect(quitInstalls()).toBe(false)
  // Restart has nothing to install.
  update.restart()
  expect(updater.quitAndInstall).not.toHaveBeenCalled()
})

it("installs nothing at the quit once the last look is over an hour old", async () => {
  await ready()
  // Two hours with no answer: offline, or asleep.
  await vi.advanceTimersByTimeAsync(2 * HOUR)
  expect(quitInstalls()).toBe(false)
  events.emit("update-available", offer("0.1.0-dev.421"))
  expect(quitInstalls()).toBe(true)
})

it("looks a minute after a wake, so a quit after a sleep installs again", async () => {
  await ready()
  sleep(3 * HOUR)
  expect(quitInstalls()).toBe(false)
  wakes.emit("resume")
  await vi.advanceTimersByTimeAsync(60_000)
  expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
  events.emit("update-available", offer("0.1.0-dev.421"))
  expect(quitInstalls()).toBe(true)
})

it("restarts at once into a version the last look offered", async () => {
  const update = await ready()
  update.restart()
  expect(await restarted()).toBe(true)
  expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
})

it("after a sleep, restarts only once a look offers the version again", async () => {
  const update = await ready()
  sleep(3 * HOUR)
  update.restart()
  expect(await restarted()).toBe(false)
  expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
  events.emit("update-available", offer("0.1.0-dev.421"))
  expect(await restarted()).toBe(true)
})

it("after a sleep, drops a version withdrawn since instead of restarting into it", async () => {
  const update = await ready()
  sleep(3 * HOUR)
  update.restart()
  events.emit("update-not-available", { version: "0.1.0-dev.420" })
  expect(update.current()).toMatchObject({ state: "none" })
  expect(await restarted()).toBe(false)
})

it("after a sleep, a Restart whose look fails restarts nothing, and says why", async () => {
  const update = await ready()
  sleep(3 * HOUR)
  update.now()
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
  events.emit("update-available", offer("0.1.0-dev.421"))
  events.emit("update-downloaded", offer("0.1.0-dev.421"))
  expect(update.current()).toMatchObject({ state: "ready", waits: false })
  expect(await restarted()).toBe(false)
  expect(quitInstalls()).toBe(true)
})

it("after a sleep, Restart when idle outlasts a look that fails, and the window asks again once a look offers the version", async () => {
  const update = await ready()
  update.wait()
  sleep(3 * HOUR)
  // The window, once no Thread works.
  update.restart()
  events.emit("error", new Error("net::ERR_INTERNET_DISCONNECTED"))
  // Not waiting while Banda cannot tell the version is still out.
  expect(update.current()).toMatchObject({ state: "ready", waits: false })
  expect(await restarted()).toBe(false)
  // The look a minute after the wake: Banda waits again, and the window
  // asks for the restart once no Thread works, not main by itself.
  wakes.emit("resume")
  await vi.advanceTimersByTimeAsync(60_000)
  events.emit("update-available", offer("0.1.0-dev.421"))
  expect(update.current()).toMatchObject({ state: "ready", waits: true })
  expect(await restarted()).toBe(false)
  update.restart()
  expect(await restarted()).toBe(true)
})

it("Restart when idle outlasts a newer version's download that fails", async () => {
  const update = await ready()
  update.wait()
  await vi.advanceTimersByTimeAsync(HOUR)
  events.emit("update-available", offer("0.1.0-dev.425"))
  events.emit("error", new Error("net::ERR_CONNECTION_RESET"))
  expect(update.current()).toMatchObject({ state: "none" })
  await vi.advanceTimersByTimeAsync(HOUR)
  events.emit("update-available", offer("0.1.0-dev.425"))
  expect(update.current()).toMatchObject({
    state: "downloading",
    restarts: true,
  })
  events.emit("update-downloaded", offer("0.1.0-dev.425"))
  expect(update.current()).toMatchObject({
    state: "ready",
    version: "0.1.0-dev.425",
    waits: true,
  })
})

it("Update now whose download fails restarts nothing later", async () => {
  const update = updates(vi.fn())
  update.now()
  events.emit("update-available", offer("0.1.0-dev.421"))
  expect(update.current()).toMatchObject({ restarts: true })
  events.emit("error", new Error("net::ERR_CONNECTION_RESET"))
  await vi.advanceTimersByTimeAsync(HOUR)
  events.emit("update-available", offer("0.1.0-dev.421"))
  events.emit("update-downloaded", offer("0.1.0-dev.421"))
  expect(update.current()).toMatchObject({ state: "ready", waits: false })
})

it("ignores looks while it restarts, so nothing deletes the version it installs", async () => {
  let stopped = () => {}
  const before = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        stopped = resolve
      })
  )
  const update = updates(vi.fn(), before)
  await vi.advanceTimersByTimeAsync(60_000)
  events.emit("update-available", offer("0.1.0-dev.421"))
  events.emit("update-downloaded", offer("0.1.0-dev.421"))
  update.restart()
  expect(before).toHaveBeenCalledTimes(1)
  // The engine takes its time to stop; the hourly look comes back meanwhile
  // with a newer version, then with the one ready withdrawn.
  await vi.advanceTimersByTimeAsync(HOUR)
  expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
  update.check()
  expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
  events.emit("update-available", offer("0.1.0-dev.425"))
  events.emit("update-not-available", { version: "0.1.0-dev.420" })
  expect(updater.downloadUpdate).toHaveBeenCalledTimes(1)
  expect(update.current()).toMatchObject({
    state: "ready",
    version: "0.1.0-dev.421",
  })
  expect(await restarted()).toBe(false)
  stopped()
  expect(await restarted()).toBe(true)
  expect(updater.quitAndInstall).toHaveBeenCalledTimes(1)
})

// Root writes anywhere, and Windows has no such modes.
it.skipIf(process.getuid?.() === 0 || process.platform === "win32")(
  "downloads nothing into an AppImage it cannot replace",
  async () => {
    chmodSync(folder, 0o555)
    try {
      const update = updates(vi.fn())
      await vi.advanceTimersByTimeAsync(60_000)
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

it("installs nothing at the quit at or below the version the launcher's entry starts", async () => {
  await ready()
  entry.listedImage = () =>
    join(folder, "banda-dev-0.1.0-dev.421-x86_64.AppImage")
  expect(quitInstalls()).toBe(false)
  entry.listedImage = () => join(folder, "Banda Dev.AppImage")
  expect(quitInstalls()).toBe(true)
})

it("a look while one is ready shows nothing and drops nothing when it fails", async () => {
  const update = await ready()
  update.check()
  expect(update.current()).toMatchObject({ state: "ready" })
  events.emit("error", new Error("net::ERR_INTERNET_DISCONNECTED"))
  expect(update.current()).toMatchObject({ state: "ready" })
})

it("looks for nothing with BANDA_UPDATES=off, for trials and CI", async () => {
  vi.stubEnv("BANDA_UPDATES", "off")
  const update = updates(vi.fn())
  expect(update.current()).toMatchObject({ state: "none", always: false })
  await vi.advanceTimersByTimeAsync(2 * HOUR)
  expect(updater.setFeedURL).not.toHaveBeenCalled()
  expect(updater.checkForUpdates).not.toHaveBeenCalled()
})
