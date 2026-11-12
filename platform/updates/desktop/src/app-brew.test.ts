import { EventEmitter } from "node:events"
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
vi.mock("electron", () => ({
  app: { isPackaged: true, getVersion: () => "0.1.0-dev.157", on() {} },
}))

import { type App, updates } from "./app"

const mine: App = {
  name: "Banda Dev",
  folder: "banda-dev",
  which: "dev",
  repository: { owner: "o", repo: "r" },
  listApp: () => {},
  listedImage: () => undefined,
}
const known = { have: "0.1.0-dev.157" }
/** What the engine says once it looked, at `at`. */
const looked = (at = Date.now()): UpdateState => ({
  running: "0.1.0-dev.157",
  newest: "0.1.0-dev.164",
  looked: at,
})
const engine = { check: vi.fn(async () => looked()) }
/** macOS's updates, its engine's first look heard. */
function brewUpdates(_: unknown, tell: (now: Update) => void) {
  const update = updates(mine, engine, tell)
  update.heard(looked(1))
  return update
}
const pending = () =>
  Object.assign(new Error("0.1.0-dev.164 has no dev-mac.yml yet"), {
    code: "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND",
  })
const platform = process.platform
let events: EventEmitter
beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(console, "warn").mockImplementation(() => {})
  events = new EventEmitter()
  Object.assign(updater, { on: events.on.bind(events) })
  updater.checkForUpdates.mockClear()
  vi.stubEnv("APPIMAGE", "")
  Object.defineProperty(process, "platform", { value: "darwin" })
})
afterEach(() => {
  Object.defineProperty(process, "platform", { value: platform })
  vi.unstubAllEnvs()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** Lets the engine's answer come. */
const answered = () => vi.advanceTimersByTimeAsync(0)

it("reads the release its engine found newest, and shows the brew update", () => {
  const updates = brewUpdates(known, vi.fn())
  expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
  events.emit("update-available", { version: "0.1.0-dev.164" })
  expect(updates.current()).toMatchObject({
    state: "out",
    version: "0.1.0-dev.164",
    command: "brew update && brew upgrade --cask banda-dev",
  })
})

it("retries while macOS files arrive, then shows the brew update", async () => {
  const updates = brewUpdates(known, vi.fn())
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
  brewUpdates(known, tell)
  events.emit("error", pending())
  events.emit("error", pending())
  expect(tell).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(60_000)
  expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
})

it("keeps a known update when a later release is not ready", async () => {
  const updates = brewUpdates(known, vi.fn())
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
  const updates = brewUpdates(known, vi.fn())
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
  const updates = brewUpdates(known, vi.fn())
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
  const updates = brewUpdates(known, vi.fn())
  events.emit("update-available", { version: "0.1.0-dev.162" })
  expect(updates.current()).toMatchObject({ state: "out" })
  events.emit("update-not-available", { version: known.have })
  expect(updates.current()).toMatchObject({ state: "none" })
})
