/**
 * Starts the real window on a throwaway machine: its own folders, and the
 * fake agent as the only Harness, so no test reaches a paid model.
 */
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test"

const repository = resolve(import.meta.dirname, "../../..")
const desktop = resolve(import.meta.dirname, "..")

export type Window = {
  app: ElectronApplication
  page: Page
  dir: string
  /** The engine's pid, main's child named `bandaso`; none while it restarts. */
  engine: () => number | undefined
  close: () => Promise<void>
}

/** A CLI in `dir` that says it is `version`, as a Harness entry's `cli`
 * that asks for `minimum` at least. */
function fakeCli(dir: string, version: string, minimum: string): string {
  const path = join(dir, "fake-cli")
  writeFileSync(path, `#!/bin/sh\necho '${version} (Fake CLI)'\n`, {
    mode: 0o755,
  })
  const program = JSON.stringify(path)
  return `cli = { program = ${program}, variable = "FAKE_AGENT_CLI", minimum = ${JSON.stringify(minimum)} }\n`
}

/** With `account`, the fake agent has one in the throwaway folders, signed
 * out. With `oldCli`, it runs a CLI that says 1.0.0 where its entry asks for
 * 2.0.0 at least. */
export async function startWindow({
  account = false,
  oldCli = false,
} = {}): Promise<Window> {
  const dir = mkdtempSync(join(tmpdir(), "bandaso-window-"))
  mkdirSync(join(dir, "config"))
  const fake = join(repository, "target/debug/bandaso-fake-agent")
  const home = join(dir, "fake-home")
  mkdirSync(home)
  const env = account
    ? `env = { FAKE_AGENT_HOME = ${JSON.stringify(home)} }\n`
    : ""
  const cli = oldCli ? fakeCli(dir, "1.0.0", "2.0.0") : ""
  writeFileSync(
    join(dir, "config/harnesses.toml"),
    `[[harness]]\nid = "fake"\nname = "Fake AI"\ncommand = ${JSON.stringify(fake)}\n${env}${cli}`
  )
  const app = await electron.launch({
    args: [
      desktop,
      ...(process.env.BANDASO_E2E_SHOW ? [] : ["--ozone-platform=headless"]),
    ],
    env: {
      ...process.env,
      BANDASO_ROOT: join(dir, "root"),
      BANDASO_STATE: join(dir, "state"),
      BANDASO_CONFIG: join(dir, "config"),
      BANDASO_LOG: "warn",
    },
  })
  const page = await app.firstWindow()
  // A headless screen is small; the window takes a laptop's size.
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 800)
  )
  await page.setViewportSize({ width: 1280, height: 800 })
  return {
    app,
    page,
    dir,
    engine: () => {
      const main = String(app.process().pid)
      try {
        const found = execFileSync("pgrep", ["-P", main, "-x", "bandaso"], {
          encoding: "utf8",
        })
        return Number(found.trim().split("\n").at(-1))
      } catch {
        return undefined
      }
    },
    close: async () => {
      await app.close()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}
