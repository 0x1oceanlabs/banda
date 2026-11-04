import { EventEmitter } from "node:events"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

const updater = vi.hoisted(() => ({ checkForUpdates: vi.fn(async () => null) }))
vi.mock("electron-updater", () => ({ autoUpdater: updater }))
vi.mock("electron", () => ({ app: {} }))
vi.mock("./channel", () => ({
  channel: { folder: "banda-dev" },
  CHANNELS: {},
}))
vi.mock("./entry", () => ({ listApp: vi.fn() }))

import { brewUpdates } from "./update"

const known = { name: "Banda Dev", have: "0.1.0-dev.157", always: true }
const pending = () =>
  Object.assign(new Error("Cannot find latest-mac.yml"), {
    code: "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND",
  })
let events: EventEmitter
beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(console, "warn").mockImplementation(() => {})
  events = new EventEmitter()
  Object.assign(updater, { on: events.on.bind(events) })
  updater.checkForUpdates.mockClear()
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

it("retries while macOS files arrive, then shows the brew update", async () => {
  const updates = brewUpdates(known, vi.fn())
  updates.check()
  events.emit("error", pending())
  expect(updates.current()).toMatchObject({
    state: "none",
    missed: "The macOS release is still publishing; checking again in a minute",
  })
  await vi.advanceTimersByTimeAsync(60_000)
  // The first scheduled look and retry coincide: only one should run.
  expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
  events.emit("update-available", { version: "0.1.0-dev.164" })
  expect(updates.current()).toMatchObject({
    state: "out",
    version: "0.1.0-dev.164",
    command: "brew update && brew upgrade --cask banda-dev",
  })
  await vi.advanceTimersByTimeAsync(60_000)
  expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
})

it("retries a background check without showing an error", async () => {
  const tell = vi.fn()
  brewUpdates(known, tell)
  await vi.advanceTimersByTimeAsync(60_000)
  events.emit("error", pending())
  events.emit("error", pending())
  expect(tell).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(60_000)
  expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
})

it("keeps a known update when a later release is not ready", () => {
  const updates = brewUpdates(known, vi.fn())
  events.emit("update-available", { version: "0.1.0-dev.162" })
  updates.check()
  events.emit("error", pending())
  expect(updates.current()).toMatchObject({
    state: "out",
    version: "0.1.0-dev.162",
  })
})

it("reports other errors without a fast retry", async () => {
  const updates = brewUpdates(known, vi.fn())
  await vi.advanceTimersByTimeAsync(60_000)
  updates.check()
  events.emit("error", new Error("net::ERR_INTERNET_DISCONNECTED"))
  expect(updates.current()).toMatchObject({
    state: "none",
    missed: "net::ERR_INTERNET_DISCONNECTED",
  })
  await vi.advanceTimersByTimeAsync(60_000)
  expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
})
