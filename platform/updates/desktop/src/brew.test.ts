import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, expect, it } from "vitest"
import { brewOf, bundleOf, lastLine, reopening, caskVersion } from "./brew"

let root: string
let prefix: string
let exe: string
let bundle: string

/** A cask as `brew info --json=v2 --cask` says it. */
const info = (cask: Record<string, unknown> = {}) =>
  JSON.stringify({
    casks: [
      {
        token: "banda-dev",
        version: "0.1.0-dev.164",
        installed: "0.1.0-dev.157",
        artifacts: [
          {
            app: ["banda-dev.app", { target: "Banda Dev.app" }],
            target: bundle,
          },
          { postflight_steps: [] },
        ],
        ...cask,
      },
    ],
  })

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "banda-brew-"))
  prefix = join(root, "homebrew")
  bundle = join(root, "Applications", "Banda Dev.app")
  exe = join(bundle, "Contents", "MacOS", "banda-dev")
  mkdirSync(join(prefix, "bin"), { recursive: true })
  mkdirSync(join(prefix, "Caskroom", "banda-dev", "0.1.0-dev.157"), {
    recursive: true,
  })
  // A brew that notes how it was run, answers `info`, and fails `fetch`.
  writeFileSync(
    join(prefix, "bin", "brew"),
    `#!/bin/sh
echo "$HOMEBREW_NO_AUTO_UPDATE $*" >> "${root}/calls"
case "$1" in
  info) cat "${root}/info.json" ;;
  fetch) echo "==> Downloading" >&2; echo "Error: Download failed: timed out" >&2; exit 1 ;;
  upgrade) echo "==> Upgrading" >&2; echo "Error: the upgrade broke" >&2; exit 3 ;;
esac
`
  )
  chmodSync(join(prefix, "bin", "brew"), 0o755)
  writeFileSync(join(root, "info.json"), info())
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

it("finds the app's bundle by its executable", () => {
  expect(bundleOf("/Applications/Banda Dev.app/Contents/MacOS/banda-dev")).toBe(
    "/Applications/Banda Dev.app"
  )
  expect(bundleOf("/usr/bin/node")).toBeUndefined()
})

it("knows a Banda only once brew installed its cask", () => {
  expect(brewOf("banda-dev", exe, [prefix])).toBeDefined()
  expect(brewOf("banda", exe, [prefix])).toBeUndefined()
  expect(brewOf("banda-dev", "/usr/bin/node", [prefix])).toBeUndefined()
  expect(brewOf("banda-dev", exe, [join(root, "nowhere")])).toBeUndefined()
})

it("updates the tap, then reads its cask's version, with no auto-update", async () => {
  const brew = brewOf("banda-dev", exe, [prefix])!
  await expect(brew.newest()).resolves.toBe("0.1.0-dev.164")
  expect(readFileSync(join(root, "calls"), "utf8")).toBe(
    "1 update\n1 info --json=v2 --cask banda-dev\n"
  )
})

it("says brew's last line of error, or how it ended", async () => {
  const brew = brewOf("banda-dev", exe, [prefix])!
  await expect(brew.fetch()).rejects.toThrow(
    /^Error: Download failed: timed out$/
  )
  await expect(brew.upgrade("0.1.0-dev.164")).rejects.toThrow(
    /^Error: the upgrade broke$/
  )
})

it("upgrades only the version ready, while the tap still has it", async () => {
  const brew = brewOf("banda-dev", exe, [prefix])!
  await expect(brew.upgrade("0.1.0-dev.163")).resolves.toBe(false)
  expect(readFileSync(join(root, "calls"), "utf8")).toBe(
    "1 info --json=v2 --cask banda-dev\n"
  )
})

it("takes only a cask that is installed, and installs this app", () => {
  expect(caskVersion(info(), bundle)).toBe("0.1.0-dev.164")
  expect(() => caskVersion(info({ installed: null }), bundle)).toThrow(
    "brew has not installed the cask"
  )
  expect(() => caskVersion(info(), "/Users/r/Downloads/Banda Dev.app")).toThrow(
    `brew installs the app at ${bundle}`
  )
  expect(() => caskVersion(JSON.stringify({ casks: [] }), bundle)).toThrow(
    "brew names no version of the cask"
  )
})

it("opens the app again hidden, as the engine does, or with its window", () => {
  const app = "/Applications/Banda Dev.app"
  expect(reopening(app, true)).toEqual([
    "/usr/bin/open",
    "-g",
    "-j",
    app,
    "--args",
    "--hidden",
  ])
  expect(reopening(app, false)).toEqual(["/usr/bin/open", app])
})

it("reads the last line that says something", () => {
  expect(lastLine("==> a\nError: b\n\n  ")).toBe("Error: b")
  expect(lastLine(" \n")).toBeUndefined()
})
