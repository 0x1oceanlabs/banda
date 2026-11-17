/**
 * The AppImage's installer on real files (appimage.ts): the file down is
 * put beside the one that runs, renamed into place, and the one that ran
 * stays until the new Banda ran a minute; and the script that starts the
 * new one starts the old one where that ends badly at once (after.ts).
 */
import { execFileSync } from "node:child_process"
import { EventEmitter } from "node:events"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

const updater = vi.hoisted(() => ({
  downloadUpdate: vi.fn(async () => []),
  autoInstallOnAppQuit: true,
  on: (() => {}) as unknown as EventEmitter["on"],
}))
const electron = vi.hoisted(() => ({ quit: vi.fn() }))
const spawned = vi.hoisted(() => ({ calls: [] as string[][] }))
vi.mock("electron-updater", () => ({
  autoUpdater: updater,
  Provider: class {},
}))
vi.mock("electron", () => ({ app: electron }))
vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  spawn: (_program: string, args: string[]) => {
    spawned.calls.push(args)
    return { unref() {} }
  },
}))

import { FELL_BACK, startOrScript } from "./after"
import { appImageInstaller } from "./appimage"
import type { Taking } from "./installer"

const OLD = "banda-dev-0.1.0-dev.826-x86_64.AppImage"
const NEW = "banda-dev-0.1.0-dev.827-x86_64.AppImage"
const info = { version: "0.1.0-dev.827" } as never
let events: EventEmitter
let folder: string
let apps: string
let data: string
let listed: string[]

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(console, "warn").mockImplementation(() => {})
  events = new EventEmitter()
  updater.on = events.on.bind(events)
  electron.quit.mockClear()
  spawned.calls = []
  listed = []
  folder = mkdtempSync(join(tmpdir(), "banda-appimage-"))
  apps = join(folder, "Applications")
  data = join(folder, "data")
  for (const dir of [apps, data, join(folder, "cache")]) mkdirSync(dir)
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  chmodSync(apps, 0o755)
  rmSync(folder, { recursive: true, force: true })
})

/** The installer of the Banda at `name`, which runs `have`. */
function installerAt(name = OLD, have = "0.1.0-dev.826") {
  const image = join(apps, name)
  if (!existsSync(image)) writeFileSync(image, "old")
  return appImageInstaller({
    image,
    have,
    data,
    listApp: (path) => listed.push(path),
    folder: "banda-dev",
  })
}

/** What hears a take, and how it ended. */
function hearing() {
  const heard = { done: undefined as boolean | undefined, failed: "" }
  const on: Taking = {
    progress: () => {},
    done: (down) => (heard.done = down),
    failed: (error) => (heard.failed = error.message),
  }
  return { on, heard }
}

/** electron-updater's download of dev.827 ends, with its file. */
function down() {
  const downloadedFile = join(folder, "cache", NEW)
  writeFileSync(downloadedFile, "new")
  events.emit("update-downloaded", { version: "0.1.0-dev.827", downloadedFile })
}

/** dev.827 taken by `installer`: down, and beside the one that runs. */
async function taken(installer = installerAt()) {
  const { on, heard } = hearing()
  installer.take(info, on)
  down()
  await vi.advanceTimersByTimeAsync(0)
  expect(heard).toEqual({ done: true, failed: "" })
  return installer
}

/** The old file starts in place of the new one at `put`, which did not
 * start, as the script says it. */
function fellBack(put: string) {
  vi.stubEnv(FELL_BACK, put)
}

it("puts the file down beside the one that runs, and the quit installs nothing by electron-updater", async () => {
  await taken()
  expect(updater.autoInstallOnAppQuit).toBe(false)
  expect(readdirSync(apps).sort()).toEqual([`.${NEW}.new`, OLD].sort())
  expect(readdirSync(join(folder, "cache"))).toEqual([])
})

it("installing is one rename: the new file under its own name, listed, and the old one kept", async () => {
  const installer = await taken()
  expect(await installer.install("0.1.0-dev.827")).toBe(true)
  expect(readFileSync(join(apps, NEW), "utf8")).toBe("new")
  expect(readFileSync(join(apps, OLD), "utf8")).toBe("old")
  expect(listed).toEqual([join(apps, NEW)])
  // Banda quits, and the new file starts, or the old one.
  installer.relaunch(false)
  expect(electron.quit).toHaveBeenCalled()
  expect(spawned.calls[0]?.slice(3, 5)).toEqual([
    join(apps, NEW),
    join(apps, OLD),
  ])
})

it("a file the Person named keeps its name, and the one that ran moves aside", async () => {
  const installer = await taken(installerAt("Banda Dev.AppImage"))
  await installer.install("0.1.0-dev.827")
  expect(readFileSync(join(apps, "Banda Dev.AppImage"), "utf8")).toBe("new")
  expect(readFileSync(join(apps, "Banda Dev.AppImage.old"), "utf8")).toBe("old")
})

it("the quit installs it when told to, and nothing when not", async () => {
  ;(await taken()).quitting(false)
  expect(existsSync(join(apps, NEW))).toBe(false)
  // The Banda that starts next puts away the file that was not installed.
  ;(await taken(installerAt())).quitting(true)
  expect(readFileSync(join(apps, NEW), "utf8")).toBe("new")
  expect(existsSync(join(apps, OLD))).toBe(true)
})

it("a file the Person named is never away from its path, even where the new one is gone", async () => {
  const installer = await taken(installerAt("Banda Dev.AppImage"))
  rmSync(join(apps, ".Banda Dev.AppImage.new"))
  installer.quitting(true)
  expect(readFileSync(join(apps, "Banda Dev.AppImage"), "utf8")).toBe("old")
})

it("puts away the files of versions it did not install", async () => {
  const stale = join(apps, ".banda-dev-0.1.0-dev.820-x86_64.AppImage.new")
  const part = join(apps, ".banda-dev-0.1.0-dev.821-x86_64.AppImage.new.part")
  // Banda's, of another channel, and the Person's: not this app's.
  const others = [
    ".banda-0.2.0-x86_64.AppImage.new",
    ".notes.new",
    "banda-dev-0.1.0-dev.800-x86_64.AppImage",
  ]
  for (const name of others) writeFileSync(join(apps, name), "")
  writeFileSync(stale, "")
  writeFileSync(part, "")
  await taken()
  expect(existsSync(stale) || existsSync(part)).toBe(false)
  for (const name of others) expect(existsSync(join(apps, name))).toBe(true)
  expect(existsSync(join(apps, `.${NEW}.new`))).toBe(true)
})

it("the new Banda that ran a minute lets the old file go", async () => {
  await (await taken()).install("0.1.0-dev.827")
  // The new one starts, from the file put in place.
  const started = installerAt(NEW, "0.1.0-dev.827")
  expect(started.failed).toBeUndefined()
  vi.advanceTimersByTime(59_000)
  expect(existsSync(join(apps, OLD))).toBe(true)
  vi.advanceTimersByTime(2_000)
  expect(existsSync(join(apps, OLD))).toBe(false)
  expect(existsSync(join(apps, NEW))).toBe(true)
})

it("a swap made in the new Banda's first minute ends the one before, and keeps its own way back", async () => {
  await (await taken()).install("0.1.0-dev.827")
  const started = installerAt(NEW, "0.1.0-dev.827")
  // dev.828 comes down and is installed at once.
  const { on } = hearing()
  started.take({ version: "0.1.0-dev.828" } as never, on)
  const next = "banda-dev-0.1.0-dev.828-x86_64.AppImage"
  writeFileSync(join(folder, "cache", next), "newer")
  events.emit("update-downloaded", {
    version: "0.1.0-dev.828",
    downloadedFile: join(folder, "cache", next),
  })
  await vi.advanceTimersByTimeAsync(0)
  await started.install("0.1.0-dev.828")
  // The file of dev.826 went as dev.827 swapped again; dev.827's stays.
  expect(existsSync(join(apps, OLD))).toBe(false)
  vi.advanceTimersByTime(61_000)
  expect(existsSync(join(apps, NEW))).toBe(true)
  expect(
    JSON.parse(readFileSync(join(data, "update-swap.json"), "utf8"))
  ).toEqual({
    old: join(apps, NEW),
    new: join(apps, next),
    to: "0.1.0-dev.828",
  })
})

it("the old Banda that starts in the new one's place says it did not start, and takes that version no more", async () => {
  await (await taken()).install("0.1.0-dev.827")
  fellBack(join(apps, NEW))
  const back = installerAt()
  expect(back.failed).toBe(
    "0.1.0-dev.827 did not start, so 0.1.0-dev.826 is back"
  )
  expect(existsSync(join(apps, NEW))).toBe(false)
  expect(listed.at(-1)).toBe(join(apps, OLD))
  expect(back.cannot(info)).toContain("did not start here before")
  // Said once: the next start has nothing left of it but the version.
  vi.unstubAllEnvs()
  const again = installerAt()
  expect(again.failed).toBeUndefined()
  expect(again.cannot(info)).toContain("did not start here before")
  expect(again.cannot({ version: "0.1.0-dev.828" } as never)).toBeUndefined()
})

it("a file the Person named takes its name back where the new one did not start", async () => {
  const name = "Banda Dev.AppImage"
  await (await taken(installerAt(name))).install("0.1.0-dev.827")
  fellBack(join(apps, name))
  const back = installerAt(`${name}.old`)
  expect(back.failed).toContain("did not start")
  expect(readFileSync(join(apps, name), "utf8")).toBe("old")
  expect(existsSync(join(apps, `${name}.old`))).toBe(false)
  expect(listed.at(-1)).toBe(join(apps, name))
})

it("the old file started by hand says nothing against the new version", async () => {
  ;(await taken()).quitting(true)
  const byHand = installerAt()
  expect(byHand.failed).toBeUndefined()
  expect(byHand.cannot(info)).toBeUndefined()
  expect(existsSync(join(apps, NEW))).toBe(true)
})

it("what it kept and cannot read never stops Banda from starting", () => {
  writeFileSync(join(data, "update-bad.json"), "5")
  writeFileSync(join(data, "update-swap.json"), '{"old": 1}')
  expect(installerAt().failed).toBeUndefined()
})

it("a file gone from beside Banda installs nothing, and says so", async () => {
  const installer = await taken()
  rmSync(join(apps, `.${NEW}.new`))
  await expect(installer.install("0.1.0-dev.827")).rejects.toThrow(/is gone/)
  expect(existsSync(join(apps, OLD))).toBe(true)
})

// Root writes anywhere.
it.skipIf(process.getuid?.() === 0)(
  "takes nothing into a folder it cannot write",
  () => {
    const installer = installerAt()
    chmodSync(apps, 0o555)
    expect(installer.cannot(info)).toBe(
      `Banda cannot write ${apps}, so 0.1.0-dev.827 cannot install`
    )
  }
)

/** Runs the script that starts `image`, or `old`, as Banda's exit does,
 * with two fifths of a second for the new one to end badly in; what the
 * two wrote, the old one with what it was told. */
function startedBy(newScript: string) {
  const out = join(folder, "started")
  const script = (name: string, body: string) => {
    const path = join(folder, name)
    writeFileSync(
      path,
      `#!/bin/sh\necho ${name} "$@" "$\{${FELL_BACK}##*/}" >> ${out}\n${body}\n`
    )
    chmodSync(path, 0o755)
    return path
  }
  // A pid that is gone: the Banda that quit.
  execFileSync("/bin/bash", [
    "-c",
    startOrScript(2),
    "999999999",
    script("new", newScript),
    script("old", "exit 0"),
    "--hidden",
  ])
  return readFileSync(out, "utf8")
    .trim()
    .split("\n")
    .map((line) => line.trim())
}

it("starts the old file where the new one ends badly at once, with the same arguments", () => {
  vi.useRealTimers()
  // The old one hears which file it stands in for.
  expect(startedBy("exit 1")).toEqual(["new --hidden", "old --hidden new"])
})

it("starts nothing more where the new one runs on, or the Person closed it", () => {
  vi.useRealTimers()
  expect(startedBy("sleep 2")).toEqual(["new --hidden"])
  rmSync(join(folder, "started"))
  expect(startedBy("exit 0")).toEqual(["new --hidden"])
})
