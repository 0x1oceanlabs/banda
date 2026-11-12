/**
 * Homebrew, as a Mac's Banda runs it to update its own app (ADR 0121;
 * ADR 0033, decision 6). The app is signed ad hoc, so Squirrel.Mac will
 * not swap it; the cask that installed it does, as the Person's
 * `brew upgrade` did: `brew update` and the cask's version, then the new
 * zip into brew's cache while Banda runs, then the upgrade, then Banda
 * opens again from the new app.
 *
 * Only a Banda that brew installed, where brew put it: one copied
 * elsewhere, or run from a checkout, has none, and only says the command.
 */
import { spawn } from "node:child_process"
import { closeSync, existsSync, openSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { startAfter } from "./after"

/** Where Homebrew lives: Apple silicon's, then Intel's. */
const PREFIXES = ["/opt/homebrew", "/usr/local"]

/** How long one brew command may run: `brew update` and a download on a
 * slow network take minutes, never this long. */
const TAKES_AT_MOST = 10 * 60_000

/** What an app the engine opens is told (`client/desktop/src/closing.ts`,
 * `engine/src/service/app.rs`): it shows no window, only its menu bar
 * icon. */
const HIDDEN = "--hidden"

/** The cask of a Mac's Banda, as brew updates it. */
export type Brew = {
  /** `brew update`, then the version the tap's cask has now; refused when
   * the cask is not installed, or installs its app elsewhere than this
   * one's. */
  newest(): Promise<string>
  /** Downloads that version into brew's cache, while Banda runs. */
  fetch(): Promise<void>
  /** Installs `version` in the app's place, if the tap's cask still has
   * it; false, installing nothing, if the tap moved since. Banda runs on
   * from its old files, which macOS keeps while they are open, until it
   * quits; brew runs on its own, so a quit meanwhile does not cut it. */
  upgrade(version: string): Promise<boolean>
  /** Opens the app again once this process is gone: `hidden`, with only
   * its menu bar icon, or with its window. */
  reopen(hidden: boolean): void
}

/** The `.app` the executable `exe` is in, if it is in one. */
export function bundleOf(exe: string): string | undefined {
  const at = exe.indexOf(".app/Contents/MacOS/")
  return at < 0 ? undefined : exe.slice(0, at + ".app".length)
}

/**
 * The cask `folder` (`banda-dev`) that installed the app `exe` runs from,
 * if brew is here and installed it; none for a Banda brew does not know.
 */
export function brewOf(
  folder: string,
  exe: string,
  prefixes: readonly string[] = PREFIXES
): Brew | undefined {
  const bundle = bundleOf(exe)
  const prefix = prefixes.find(
    (one) =>
      existsSync(join(one, "bin", "brew")) &&
      existsSync(join(one, "Caskroom", folder))
  )
  if (!bundle || !prefix) return undefined
  const brew = join(prefix, "bin", "brew")
  const run = (args: string[], log?: string) => ran(brew, args, log)
  const cask = async () =>
    caskVersion(await run(["info", "--json=v2", "--cask", folder]), bundle)
  return {
    async newest() {
      await run(["update"])
      return cask()
    },
    async fetch() {
      await run(["fetch", "--cask", folder])
    },
    async upgrade(version) {
      if ((await cask()) !== version) return false
      await run(
        ["upgrade", "--cask", folder],
        join(tmpdir(), `${folder}-brew-upgrade.log`)
      )
      return true
    },
    reopen(hidden) {
      startAfter(reopening(bundle, hidden))
    },
  }
}

/** The cask's version in `brew info --json=v2 --cask`'s `json`, once it
 * says the cask is installed, into `bundle`. */
export function caskVersion(json: string, bundle: string): string {
  const cask = (JSON.parse(json) as { casks?: Cask[] }).casks?.[0]
  if (!cask?.version) throw new Error("brew names no version of the cask")
  if (!cask.installed) throw new Error("brew has not installed the cask")
  const target = cask.artifacts?.find((one) => "app" in one)?.target
  if (target !== bundle)
    throw new Error(`brew installs the app at ${target ?? "no path"}`)
  return cask.version
}

/** What `caskVersion` reads of a cask. */
type Cask = {
  version?: string
  installed?: string | null
  artifacts?: { app?: unknown; target?: string }[]
}

/**
 * Runs brew with `args`, and gives what it wrote, or its last line of
 * error. No auto-update: Banda runs `brew update` itself, once a look.
 * With a `log`, brew writes there and runs on its own, with no time
 * limit: Banda quitting, or a kill, never cuts it halfway.
 */
function ran(brew: string, args: string[], log?: string): Promise<string> {
  return new Promise((done, failed) => {
    let file: number | undefined
    let child
    try {
      if (log) file = openSync(log, "w")
      child = spawn(brew, args, {
        detached: file !== undefined,
        stdio: ["ignore", file ?? "pipe", file ?? "pipe"],
        env: {
          ...process.env,
          HOMEBREW_NO_AUTO_UPDATE: "1",
          HOMEBREW_NO_ENV_HINTS: "1",
        },
      })
    } catch (error) {
      failed(error)
      return
    } finally {
      // brew has its own copy.
      if (file !== undefined) closeSync(file)
    }
    let out = ""
    let err = ""
    child.stdout?.on("data", (chunk: Buffer) => (out += chunk))
    child.stderr?.on("data", (chunk: Buffer) => (err += chunk))
    const running = child
    const late = log
      ? undefined
      : setTimeout(() => running.kill(), TAKES_AT_MOST)
    child.on("error", (error) => {
      clearTimeout(late)
      failed(error)
    })
    child.on("close", (code, signal) => {
      clearTimeout(late)
      if (code === 0) {
        done(out)
        return
      }
      if (log) err = readLog(log)
      failed(
        new Error(
          lastLine(err) ??
            `brew ${args[0]} ${signal ? `stopped by ${signal}` : `exited with ${code}`}`
        )
      )
    })
  })
}

/** What brew wrote to `log`; nothing if it cannot be read. */
function readLog(log: string): string {
  try {
    return readFileSync(log, "utf8")
  } catch {
    return ""
  }
}

/** `text`'s last line that says something, if any. */
export function lastLine(text: string): string | undefined {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1)
}

/** The command that opens `bundle` again: `hidden`, `-g -j` and
 * `--hidden`, as the engine opens it, or with its window. */
export function reopening(bundle: string, hidden: boolean): string[] {
  return [
    "/usr/bin/open",
    ...(hidden ? ["-g", "-j", bundle, "--args", HIDDEN] : [bundle]),
  ]
}
