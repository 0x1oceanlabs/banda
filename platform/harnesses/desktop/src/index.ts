/**
 * The harnesses module's part in the window's main process (ADR 0028): it
 * asks Anthropic for Claude Code's usage limits when the engine part asks
 * it to (usage.ts). It answers no channel of the bridge, and serves
 * nothing.
 */
import type { DesktopModule } from "@banda/desktop-kit"
import { Effect, Layer } from "effect"
import { session } from "electron"
import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import { homedir, userInfo } from "node:os"
import { asking, type Means } from "./usage"

/** A session that keeps nothing past Banda's run: no `persist:`. */
let made: Electron.Session | undefined

const read = (path: string) =>
  readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined
    throw error
  })

/** A Keychain item's secret, by `security`; none when it is not there. */
const keychain = (service: string) =>
  new Promise<string | undefined>((resolve) => {
    const account = userInfo().username
    execFile(
      "security",
      ["find-generic-password", "-a", account, "-s", service, "-w"],
      { timeout: 10_000 },
      (error, stdout) => resolve(error ? undefined : stdout.trim())
    )
  })

const means = (): Means => {
  made ??= session.fromPartition("banda-limits")
  return {
    platform: process.platform,
    home: homedir(),
    configured: process.env.CLAUDE_CONFIG_DIR || undefined,
    read,
    keychain,
    fetch: made.fetch.bind(made),
    now: Date.now,
  }
}

export const harnessesDesktop: DesktopModule<object, never, never> = {
  layer: Layer.empty,
  answers: {},
  asked: { claude_usage: asking(means) },
  served: {},
  opened: () => Effect.void,
}
