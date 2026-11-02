/**
 * The desktop's side of the settings window (ADR 0016): the page asks, and
 * `banda settings set|reset` changes the file, keeping the Person's text
 * (decision 5). `banda look --follow` sees the change and hands both
 * windows the new look, so the page never reads or writes a file itself.
 * `banda settings` checks the file and the key; this hands them on.
 */
import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { promisify } from "node:util"
import { shell } from "electron"
import type { Listed } from "@banda/contract/look"

const run = promisify(execFile)

/** `banda settings`, run for the page. */
export class Settings {
  readonly #binary: string
  #themes: Promise<Listed[]> | undefined

  constructor(binary: string) {
    this.#binary = binary
  }

  /** Sets `key` in `file` to `value`, TOML; what was wrong, if it refused. */
  set(file: unknown, key: unknown, value: unknown): Promise<string[]> {
    return this.#settings(["set", text(file), text(key), text(value)])
  }

  /** Takes `key` out of `file`, so the layer under it shows again. */
  reset(file: unknown, key: unknown): Promise<string[]> {
    return this.#settings(["reset", text(file), text(key)])
  }

  /** Names `key` in `file` `to` instead, where it is, comments kept. */
  rename(file: unknown, key: unknown, to: unknown): Promise<string[]> {
    return this.#settings(["rename", text(file), text(key), text(to)])
  }

  /** The themes there are, as `banda look themes` lists them; once. */
  themes(): Promise<Listed[]> {
    this.#themes ??= run(this.#binary, ["look", "themes"]).then(
      ({ stdout }) =>
        stdout
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as Listed),
      (error: unknown) => {
        this.#themes = undefined
        throw error
      }
    )
    return this.#themes
  }

  /** Opens `file`, beside `sidebar.toml` in the config folder, in the
   * Person's editor; the folder when it is not there yet, or for "". */
  async reveal(sidebarFile: string, file: unknown): Promise<void> {
    const name = text(file)
    if (name && !/^[a-z-]+\.toml$/.test(name))
      throw new Error(`${name} is not one.`)
    const path = join(dirname(sidebarFile), name)
    const failed = await shell.openPath(existsSync(path) ? path : dirname(path))
    if (failed) throw new Error(failed)
  }

  /** What it said when it refused, a problem a line; nothing when done. */
  async #settings(args: string[]): Promise<string[]> {
    try {
      await run(this.#binary, ["settings", ...args])
      return []
    } catch (error) {
      const { code, stderr } = error as { code?: number; stderr?: string }
      // 1: refused, said as `check` says it; anything else broke.
      if (code === 1 && stderr) return stderr.split("\n").filter(Boolean)
      throw error
    }
  }
}

function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("Settings are named in text.")
  return value
}
