import { EventEmitter } from "node:events"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { UpdateState } from "@banda/contract/updates"
import type { Update } from "@banda/core"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

const updater = vi.hoisted(() => ({
  checkForUpdates: vi.fn(async () => null),
  setFeedURL: vi.fn(),
}))
vi.mock("electron-updater", () => ({
  autoUpdater: updater,
  Provider: class {},
}))
const electron = vi.hoisted(() => ({
  isPackaged: true,
  getVersion: () => "0.1.0-dev.157",
  getPath: (): string => "/nowhere",
  quit: vi.fn(),
  on() {},
}))
vi.mock("electron", () => ({ app: electron }))
/** The cask that installed this Banda: none, unless a test says. */
const cask = vi.hoisted(() => ({ brew: undefined as Brew | undefined }))
vi.mock("./brew", () => ({ brewOf: () => cask.brew }))

import { type App, updates } from "./app"
import type { Brew } from "./brew"

const mine: App = {
  name: "Banda Dev",
  folder: "banda-dev",
  which: "dev",
  repository: { owner: "o", repo: "r" },
  listApp: () => {},
  listedImage: () => undefined,
  alone: () => alone,
  quits: () => quits,
}
/** Whether no window shows. */
let alone = false
/** Whether Banda quits, as the Person asked. */
let quits = false
const known = { have: "0.1.0-dev.157" }
/** What the engine says once it looked, at `at`. */
const looked = (at = Date.now()): UpdateState => ({
  running: "0.1.0-dev.157",
  newest: "0.1.0-dev.164",
  looked: at,
})
const engine = { check: vi.fn(async () => looked()) }
/** macOS's updates, its engine's first look heard. */
function brewUpdates(
  tell: (now: Update) => void,
  leaving: () => void = () => {}
) {
  const update = updates(mine, engine, tell, leaving)
  update.heard(looked(1))
  return update
}
const pending = () =>
  Object.assign(new Error("0.1.0-dev.164 has no dev-mac.yml yet"), {
    code: "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND",
  })
const platform = process.platform
let events: EventEmitter
let folder: string
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "banda-brew-update-"))
  electron.getPath = () => folder
  electron.quit.mockClear()
  engine.check.mockClear()
  cask.brew = undefined
  alone = false
  quits = false
  vi.useFakeTimers()
  vi.spyOn(console, "warn").mockImplementation(() => {})
  events = new EventEmitter()
  Object.assign(updater, { on: events.on.bind(events) })
  updater.checkForUpdates.mockClear()
  vi.stubEnv("APPIMAGE", "")
  Object.defineProperty(process, "platform", { value: "darwin" })
})
afterEach(() => {
  rmSync(folder, { recursive: true, force: true })
  Object.defineProperty(process, "platform", { value: platform })
  vi.unstubAllEnvs()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** Lets the engine's answer come. */
const answered = () => vi.advanceTimersByTimeAsync(0)

it("reads the release its engine found newest, and shows the brew update", () => {
  const updates = brewUpdates(vi.fn())
  expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
  events.emit("update-available", { version: "0.1.0-dev.164" })
  expect(updates.current()).toMatchObject({
    state: "out",
    version: "0.1.0-dev.164",
    command: "brew update && brew upgrade --cask banda-dev",
  })
})

it("retries while macOS files arrive, then shows the brew update", async () => {
  const updates = brewUpdates(vi.fn())
  updates.check()
  await answered()
  expect(engine.check).toHaveBeenCalled()
  events.emit("error", pending())
  expect(updates.current()).toMatchObject({
    state: "none",
    missed: "The macOS release is still publishing; checking again in a minute",
  })
  await vi.advanceTimersByTimeAsync(60_000)
  // The engine's look, the Person's, and the retry a minute after.
  expect(updater.checkForUpdates).toHaveBeenCalledTimes(3)
  events.emit("update-available", { version: "0.1.0-dev.164" })
  expect(updates.current()).toMatchObject({
    state: "out",
    version: "0.1.0-dev.164",
  })
  await vi.advanceTimersByTimeAsync(60_000)
  expect(updater.checkForUpdates).toHaveBeenCalledTimes(3)
})

it("retries a background look without showing an error", async () => {
  const tell = vi.fn()
  brewUpdates(tell)
  events.emit("error", pending())
  events.emit("error", pending())
  expect(tell).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(60_000)
  expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
})

it("keeps a known update when a later release is not ready", async () => {
  const updates = brewUpdates(vi.fn())
  events.emit("update-available", { version: "0.1.0-dev.162" })
  updates.check()
  await answered()
  events.emit("error", pending())
  expect(updates.current()).toMatchObject({
    state: "out",
    version: "0.1.0-dev.162",
  })
})

it("reports other errors without a fast retry", async () => {
  const updates = brewUpdates(vi.fn())
  updates.check()
  await answered()
  events.emit("error", new Error("net::ERR_INTERNET_DISCONNECTED"))
  expect(updates.current()).toMatchObject({
    state: "none",
    missed: "net::ERR_INTERNET_DISCONNECTED",
  })
  await vi.advanceTimersByTimeAsync(60_000)
  expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
})

it("stops retrying once the Mac's files are long overdue, as a pack that failed sends none", async () => {
  const updates = brewUpdates(vi.fn())
  for (let look = 0; look < 20; look++) {
    events.emit("error", pending())
    await vi.advanceTimersByTimeAsync(60_000)
  }
  // The engine's look and 15 more, a minute apart.
  expect(updater.checkForUpdates).toHaveBeenCalledTimes(16)
  updates.check()
  await answered()
  events.emit("error", pending())
  expect(updates.current()).toMatchObject({
    state: "none",
    missed: "The macOS release is still publishing",
  })
})

it("drops a version out once a look finds it withdrawn (ADR 0092)", () => {
  const updates = brewUpdates(vi.fn())
  events.emit("update-available", { version: "0.1.0-dev.162" })
  expect(updates.current()).toMatchObject({ state: "out" })
  events.emit("update-not-available", { version: known.have })
  expect(updates.current()).toMatchObject({ state: "none" })
})

/** A cask whose tap has `version`, and whose commands do as asked. */
function brewWith(version = "0.1.0-dev.164") {
  const brew = {
    newest: vi.fn(async () => version),
    fetch: vi.fn(async () => {}),
    upgrade: vi.fn<(version: string) => Promise<boolean>>(async () => true),
    reopen: vi.fn(),
  }
  cask.brew = brew
  return brew
}
const ready = { state: "ready", version: "0.1.0-dev.164" }

/** brew with the version ready, as the engine's look offered it. */
async function readyBrew(leaving?: () => void) {
  const brew = brewWith()
  const updates = brewUpdates(vi.fn(), leaving)
  events.emit("update-available", { version: ready.version })
  await answered()
  return { brew, updates }
}

it("brew takes the version, and Restart installs it and opens Banda again with its window", async () => {
  const leaving = vi.fn()
  const { brew, updates } = await readyBrew(leaving)
  expect(brew.fetch).toHaveBeenCalled()
  expect(updates.current()).toMatchObject(ready)
  // Shown, the window waits for the Person.
  await vi.advanceTimersByTimeAsync(10 * 60_000)
  expect(brew.upgrade).not.toHaveBeenCalled()
  updates.restart()
  await answered()
  expect(brew.upgrade).toHaveBeenCalledWith("0.1.0-dev.164")
  expect(leaving).toHaveBeenCalled()
  expect(brew.reopen).toHaveBeenCalledWith(false)
  expect(electron.quit).toHaveBeenCalled()
  expect(
    JSON.parse(readFileSync(join(folder, "update.json"), "utf8"))
  ).toMatchObject({
    from: "0.1.0-dev.157",
    to: "0.1.0-dev.164",
  })
})

it("with no window shown, it restarts by itself and opens again with none", async () => {
  const { brew } = await readyBrew()
  alone = true
  await vi.advanceTimersByTimeAsync(30_000)
  // One look with no window is not enough: a window may open again.
  expect(brew.upgrade).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(30_000)
  expect(brew.upgrade).toHaveBeenCalledTimes(1)
  expect(brew.reopen).toHaveBeenCalledWith(true)
  expect(electron.quit).toHaveBeenCalled()
})

it("a window shown between two looks holds the restart", async () => {
  const { brew } = await readyBrew()
  alone = true
  await vi.advanceTimersByTimeAsync(30_000)
  alone = false
  await vi.advanceTimersByTimeAsync(30_000)
  alone = true
  await vi.advanceTimersByTimeAsync(30_000)
  expect(brew.upgrade).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(30_000)
  expect(brew.upgrade).toHaveBeenCalledTimes(1)
})

it("waits for the tap's cask a minute at a time, quietly", async () => {
  const brew = brewWith("0.1.0-dev.157")
  const tell = vi.fn()
  const updates = brewUpdates(tell)
  events.emit("update-available", { version: "0.1.0-dev.164" })
  await answered()
  expect(brew.fetch).not.toHaveBeenCalled()
  expect(updates.current()).toMatchObject({ state: "none" })
  expect(tell).not.toHaveBeenCalled()
  brew.newest.mockResolvedValue("0.1.0-dev.164")
  await vi.advanceTimersByTimeAsync(60_000)
  // The engine's look, and the one a minute after.
  expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
  events.emit("update-available", { version: "0.1.0-dev.164" })
  await answered()
  expect(updates.current()).toMatchObject(ready)
})

it("says the command once the tap's cask is long overdue, and then tries brew once a look", async () => {
  const brew = brewWith("0.1.0-dev.157")
  const updates = brewUpdates(vi.fn())
  for (let look = 0; look < 16; look++) {
    events.emit("update-available", { version: "0.1.0-dev.164" })
    await answered()
    await vi.advanceTimersByTimeAsync(60_000)
  }
  expect(updates.current()).toMatchObject({
    state: "out",
    version: "0.1.0-dev.164",
    command: "brew update && brew upgrade --cask banda-dev",
  })
  // The engine's next look: one `brew update`, no minute-apart reads.
  const runs = brew.newest.mock.calls.length
  const reads = updater.checkForUpdates.mock.calls.length
  events.emit("update-available", { version: "0.1.0-dev.164" })
  await answered()
  await vi.advanceTimersByTimeAsync(30 * 60_000)
  expect(brew.newest).toHaveBeenCalledTimes(runs + 1)
  expect(updater.checkForUpdates).toHaveBeenCalledTimes(reads)
})

it("a brew that cannot take it says the command, which still works by hand", async () => {
  const brew = brewWith()
  brew.fetch.mockRejectedValue(new Error("Error: Download failed"))
  const updates = brewUpdates(vi.fn())
  events.emit("update-available", { version: "0.1.0-dev.164" })
  await answered()
  expect(updates.current()).toMatchObject({
    state: "out",
    command: "brew update && brew upgrade --cask banda-dev",
  })
})

it("a brew that cannot install it says why, and tries again only as the Person asks", async () => {
  const brew = brewWith()
  brew.upgrade.mockRejectedValueOnce(
    new Error(
      "Error: It seems there is already an App at '/Applications/Banda Dev.app'."
    )
  )
  const updates = brewUpdates(vi.fn())
  events.emit("update-available", { version: "0.1.0-dev.164" })
  await answered()
  alone = true
  await vi.advanceTimersByTimeAsync(60_000)
  expect(updates.current()).toMatchObject({
    state: "failed",
    reason:
      "brew could not install 0.1.0-dev.164: Error: It seems there is already an App at '/Applications/Banda Dev.app'.",
  })
  expect(electron.quit).not.toHaveBeenCalled()
  // The next look finds it ready again, and it waits for the Person.
  events.emit("update-available", { version: "0.1.0-dev.164" })
  await answered()
  await vi.advanceTimersByTimeAsync(10 * 60_000)
  expect(brew.upgrade).toHaveBeenCalledTimes(1)
  updates.restart()
  await answered()
  expect(brew.upgrade).toHaveBeenCalledTimes(2)
  expect(electron.quit).toHaveBeenCalled()
})

it("after an hour with no look, Restart looks first that it is still out", async () => {
  const { brew, updates } = await readyBrew()
  await vi.advanceTimersByTimeAsync(2 * 3_600_000)
  updates.restart()
  await answered()
  expect(engine.check).toHaveBeenCalled()
  expect(brew.upgrade).not.toHaveBeenCalled()
  events.emit("update-available", { version: "0.1.0-dev.164" })
  await answered()
  expect(brew.upgrade).toHaveBeenCalledTimes(1)
})

it("a version ready that was withdrawn goes, and installs nothing", async () => {
  const brew = brewWith()
  alone = true
  const updates = brewUpdates(vi.fn())
  events.emit("update-available", { version: "0.1.0-dev.164" })
  await answered()
  events.emit("update-not-available", { version: known.have })
  expect(updates.current()).toMatchObject({ state: "none" })
  await vi.advanceTimersByTimeAsync(10 * 60_000)
  expect(brew.upgrade).not.toHaveBeenCalled()
})

it("Update now while brew takes the version restarts once it is down", async () => {
  const brew = brewWith()
  let down = () => {}
  brew.fetch.mockReturnValue(new Promise<void>((done) => (down = done)))
  const updates = brewUpdates(vi.fn())
  events.emit("update-available", { version: "0.1.0-dev.164" })
  await answered()
  updates.now()
  await answered()
  // No second look while brew takes it.
  expect(engine.check).not.toHaveBeenCalled()
  down()
  await answered()
  expect(brew.upgrade).toHaveBeenCalledTimes(1)
  expect(brew.reopen).toHaveBeenCalledWith(false)
})

it("a Banda that brew updated says so as it starts", () => {
  writeFileSync(
    join(folder, "update.json"),
    JSON.stringify({ from: "0.1.0-dev.150", to: known.have, notes: [] })
  )
  const updates = brewUpdates(vi.fn())
  expect(updates.current()).toMatchObject({
    state: "updated",
    from: "0.1.0-dev.150",
  })
  updates.seen()
  expect(updates.current()).toMatchObject({ state: "none" })
})

it("after a sleep, the unseen restart waits for the engine's next look, and says no failure", async () => {
  const { brew, updates } = await readyBrew()
  await vi.advanceTimersByTimeAsync(2 * 3_600_000)
  alone = true
  await vi.advanceTimersByTimeAsync(5 * 60_000)
  expect(engine.check).not.toHaveBeenCalled()
  expect(brew.upgrade).not.toHaveBeenCalled()
  expect(updates.current()).toMatchObject(ready)
  // The engine's next look offers it again.
  updates.heard(looked())
  events.emit("update-available", { version: "0.1.0-dev.164" })
  await vi.advanceTimersByTimeAsync(30_000)
  expect(brew.upgrade).toHaveBeenCalledWith("0.1.0-dev.164")
  expect(brew.reopen).toHaveBeenCalledWith(true)
})

it("a Restart whose look finds a newer version goes on to it", async () => {
  const { brew, updates } = await readyBrew()
  await vi.advanceTimersByTimeAsync(2 * 3_600_000)
  updates.restart()
  await answered()
  brew.newest.mockResolvedValue("0.1.0-dev.170")
  events.emit("update-available", { version: "0.1.0-dev.170" })
  await answered()
  expect(brew.upgrade).toHaveBeenCalledTimes(1)
  expect(brew.upgrade).toHaveBeenCalledWith("0.1.0-dev.170")
})

it("a Try again that finds no network restarts nothing later", async () => {
  const brew = brewWith()
  const updates = brewUpdates(vi.fn())
  engine.check.mockRejectedValueOnce(new Error("engine not reachable"))
  updates.now()
  await answered()
  expect(updates.current()).toMatchObject({
    state: "none",
    missed: "engine not reachable",
  })
  events.emit("update-available", { version: "0.1.0-dev.164" })
  await answered()
  expect(updates.current()).toMatchObject(ready)
  await vi.advanceTimersByTimeAsync(10 * 60_000)
  expect(brew.upgrade).not.toHaveBeenCalled()
})

it("a tap that moved since installs nothing: the engine looks, and brew takes what it finds", async () => {
  const brew = brewWith()
  brew.upgrade.mockResolvedValueOnce(false)
  const updates = brewUpdates(vi.fn())
  events.emit("update-available", { version: "0.1.0-dev.164" })
  await answered()
  updates.restart()
  await answered()
  expect(electron.quit).not.toHaveBeenCalled()
  expect(engine.check).toHaveBeenCalled()
  brew.newest.mockResolvedValue("0.1.0-dev.170")
  events.emit("update-available", { version: "0.1.0-dev.170" })
  await answered()
  // The Person's Restart goes on to it.
  expect(brew.upgrade).toHaveBeenLastCalledWith("0.1.0-dev.170")
  expect(electron.quit).toHaveBeenCalled()
})

it("a quit meanwhile goes as asked: brew installs it, and the next start says so", async () => {
  const brew = brewWith()
  let installed: (upgraded: boolean) => void = () => {}
  brew.upgrade.mockReturnValue(
    new Promise<boolean>((done) => (installed = done))
  )
  const leaving = vi.fn()
  const updates = brewUpdates(vi.fn(), leaving)
  events.emit("update-available", { version: "0.1.0-dev.164" })
  await answered()
  updates.restart()
  quits = true
  installed(true)
  await answered()
  expect(leaving).not.toHaveBeenCalled()
  expect(brew.reopen).not.toHaveBeenCalled()
  expect(electron.quit).not.toHaveBeenCalled()
  expect(
    JSON.parse(readFileSync(join(folder, "update.json"), "utf8"))
  ).toMatchObject({ to: "0.1.0-dev.164" })
})

it("a newer version brew cannot take leaves the one ready", async () => {
  const { brew, updates } = await readyBrew()
  brew.newest.mockResolvedValue("0.1.0-dev.170")
  brew.fetch.mockRejectedValue(new Error("Error: Download failed"))
  events.emit("update-available", { version: "0.1.0-dev.170" })
  await answered()
  expect(updates.current()).toMatchObject(ready)
})

it("a new version waits its own minutes for the tap, after the Mac's files took theirs", async () => {
  const brew = brewWith("0.1.0-dev.157")
  const updates = brewUpdates(vi.fn())
  for (let look = 0; look < 15; look++) {
    events.emit("error", pending())
    await vi.advanceTimersByTimeAsync(60_000)
  }
  events.emit("update-available", { version: "0.1.0-dev.164" })
  await answered()
  expect(updates.current()).toMatchObject({ state: "none" })
  brew.newest.mockResolvedValue("0.1.0-dev.164")
  await vi.advanceTimersByTimeAsync(60_000)
  events.emit("update-available", { version: "0.1.0-dev.164" })
  await answered()
  expect(updates.current()).toMatchObject(ready)
})

it("a newer version waits for the tap again, after an older one gave up", async () => {
  const brew = brewWith("0.1.0-dev.157")
  const updates = brewUpdates(vi.fn())
  for (let look = 0; look < 16; look++) {
    events.emit("update-available", { version: "0.1.0-dev.164" })
    await answered()
    await vi.advanceTimersByTimeAsync(60_000)
  }
  expect(updates.current()).toMatchObject({ state: "out" })
  events.emit("update-available", { version: "0.1.0-dev.170" })
  await answered()
  const reads = updater.checkForUpdates.mock.calls.length
  await vi.advanceTimersByTimeAsync(60_000)
  expect(updater.checkForUpdates).toHaveBeenCalledTimes(reads + 1)
  brew.newest.mockResolvedValue("0.1.0-dev.170")
  events.emit("update-available", { version: "0.1.0-dev.170" })
  await answered()
  expect(updates.current()).toMatchObject({
    state: "ready",
    version: "0.1.0-dev.170",
  })
})
