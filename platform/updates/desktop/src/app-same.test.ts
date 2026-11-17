/**
 * One machine on every system (app.ts): the same looks and the same
 * Update give the same steps on Linux, macOS and Windows, whatever
 * installs (installer.ts).
 */
import { EventEmitter } from "node:events"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { UpdateState } from "@banda/contract/updates"
import type { Update } from "@banda/core"
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
  getVersion: () => "0.1.0-dev.826",
  getPath: (): string => "/nowhere",
  quit: vi.fn(),
  on() {},
}))
vi.mock("electron-updater", () => ({
  autoUpdater: updater,
  Provider: class {},
}))
vi.mock("electron", () => ({ app: electron }))
vi.mock("node:child_process", () => ({ spawn: () => ({ unref() {} }) }))
const cask = vi.hoisted(() => ({ brew: undefined as Brew | undefined }))
vi.mock("./brew", () => ({ brewOf: () => cask.brew }))

import { type App, updates } from "./app"
import type { Brew } from "./brew"

const NEW = "0.1.0-dev.827"
const looked = (): UpdateState => ({
  running: "0.1.0-dev.826",
  newest: NEW,
  looked: Date.now(),
})
const platform = process.platform
let events: EventEmitter
let folder: string
let alone = false

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(console, "warn").mockImplementation(() => {})
  events = new EventEmitter()
  Object.assign(updater, { on: events.on.bind(events) })
  updater.quitAndInstall.mockClear()
  electron.quit.mockClear()
  folder = mkdtempSync(join(tmpdir(), "banda-same-update-"))
  electron.getPath = () => folder
  alone = false
})
afterEach(() => {
  rmSync(folder, { recursive: true, force: true })
  Object.defineProperty(process, "platform", { value: platform })
  vi.unstubAllEnvs()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

type System = "Linux" | "macOS" | "Windows"

/** Banda Dev on `system`, and whether it restarted into the new version. */
function on(system: System) {
  const image = join(folder, "banda-dev-0.1.0-dev.826-x86_64.AppImage")
  writeFileSync(image, "")
  vi.stubEnv("APPIMAGE", system === "Linux" ? image : "")
  vi.stubEnv("BANDA_UPDATES", "")
  Object.defineProperty(process, "platform", {
    value: { Linux: "linux", macOS: "darwin", Windows: "win32" }[system],
  })
  const brew = {
    newest: vi.fn(async () => NEW),
    fetch: vi.fn(async () => {}),
    upgrade: vi.fn(async () => true),
    reopen: vi.fn(),
  }
  cask.brew = system === "macOS" ? brew : undefined
  const mine: App = {
    name: "Banda Dev",
    folder: "banda-dev",
    which: "dev",
    repository: { owner: "o", repo: "r" },
    listApp: () => {},
    listedImage: () => undefined,
    alone: () => alone,
    quits: () => false,
  }
  const told: Update[] = []
  const update = updates(mine, { check: async () => looked() }, (now) =>
    told.push(now)
  )
  return {
    update,
    /** Each thing it said, in a word. */
    said: () =>
      told.map((now) =>
        now.state === "ready" && now.doing ? now.doing : now.state
      ),
    /** The engine looked, and the release offers the new version. */
    async offered() {
      update.heard(looked())
      events.emit("update-available", { version: NEW })
      // electron-updater's download ends; brew's needs no word.
      events.emit("update-downloaded", { version: NEW })
      await vi.advanceTimersByTimeAsync(0)
    },
    restarted: () =>
      system === "macOS"
        ? electron.quit.mock.calls.length > 0
        : updater.quitAndInstall.mock.calls.length > 0,
  }
}

const SYSTEMS: System[] = ["Linux", "macOS", "Windows"]

it.each(SYSTEMS)(
  "on %s, Update says Installing, then Restarting, and restarts",
  async (system) => {
    const banda = on(system)
    await banda.offered()
    expect(banda.update.current()).toMatchObject({ state: "ready" })
    banda.update.restart()
    await vi.advanceTimersByTimeAsync(1000)
    // A download shows only where the installer says how far it is.
    expect(banda.said().filter((word) => word !== "downloading")).toEqual([
      "ready",
      "installing",
      "restarting",
    ])
    expect(banda.restarted()).toBe(true)
  }
)

it.each(SYSTEMS)(
  "on %s, with no window shown, it restarts by itself only where Banda can stay with none",
  async (system) => {
    const banda = on(system)
    await banda.offered()
    // Shown, it waits for the Person.
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(banda.restarted()).toBe(false)
    alone = true
    await vi.advanceTimersByTimeAsync(61_000)
    // A Mac's lives in the menu bar; the others have no tray yet (#1870).
    expect(banda.restarted()).toBe(system === "macOS")
    expect(banda.said().filter((word) => word !== "downloading")).toEqual([
      "ready",
    ])
  }
)
