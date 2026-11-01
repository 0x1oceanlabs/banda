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
  expect,
  type ElectronApplication,
  type Locator,
  type Page,
} from "@playwright/test"

const repository = resolve(import.meta.dirname, "../../..")
const desktop = resolve(import.meta.dirname, "..")

export type Window = {
  app: ElectronApplication
  page: Page
  dir: string
  /** The engine's pid, main's child named `banda`; none while it restarts. */
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
 * 2.0.0 at least. `look` and `sidebar` are the text of `look.toml` and
 * `sidebar.toml`. */
export async function startWindow({
  account = false,
  oldCli = false,
  look = "",
  sidebar = "",
} = {}): Promise<Window> {
  const dir = mkdtempSync(join(tmpdir(), "banda-window-"))
  mkdirSync(join(dir, "config"))
  if (look) writeFileSync(join(dir, "config/look.toml"), look)
  if (sidebar) writeFileSync(join(dir, "config/sidebar.toml"), sidebar)
  const fake = join(repository, "target/debug/banda-fake-agent")
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
      ...(process.env.BANDA_E2E_SHOW ? [] : ["--ozone-platform=headless"]),
    ],
    env: {
      ...process.env,
      BANDA_ROOT: join(dir, "root"),
      BANDA_STATE: join(dir, "state"),
      // The engine and the look read only this folder: no Omarchy, no
      // Hyprland.
      BANDA_CONFIG: join(dir, "config"),
      BANDA_OMARCHY: "",
      BANDA_FONTCONFIG: "",
      HYPRLAND_INSTANCE_SIGNATURE: "",
      BANDA_LOG: "warn",
      // Notices go to a list the tests read, never to the Person's screen.
      BANDA_DESKTOP: "recorded",
      // A terminal runs the Person's shell: here one every machine has.
      SHELL: "/bin/sh",
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
        const found = execFileSync("pgrep", ["-P", main, "-x", "banda"], {
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

/**
 * Makes the first Space, "Work", which opens a new Thread on the fake
 * agent. The Thread is found by its message box, so it stays found once
 * its first message gives it a title.
 */
export async function firstThread(
  page: Page
): Promise<{ thread: Locator; composer: Locator }> {
  await page.getByLabel("Name").fill("Work")
  await page.getByRole("button", { name: "Create Space" }).click()
  const composer = page.getByRole("textbox", { name: "Message to Fake AI" })
  const thread = page.locator("section").filter({ has: composer })
  return { thread, composer }
}

/**
 * Counts the notes of Banda's sounds as they start: Playwright hears
 * nothing, so a test asks how many began.
 */
export async function countNotes(page: Page): Promise<() => Promise<number>> {
  await page.evaluate(() => {
    const counted = globalThis as unknown as { notes: number }
    counted.notes = 0
    const start = AudioScheduledSourceNode.prototype.start
    AudioScheduledSourceNode.prototype.start = function (...args) {
      counted.notes += 1
      return start.apply(this, args)
    }
  })
  return () =>
    page.evaluate(() => (globalThis as unknown as { notes: number }).notes)
}

/**
 * Sends `text` in `composer`'s Thread and goes to a new Thread as soon as
 * it started, so the first one ends while the Person is elsewhere. The
 * Fake AI takes its time over a message that says "slow".
 */
export async function sendAndLeave(
  page: Page,
  composer: Locator,
  text: string
) {
  await composer.fill(text)
  await composer.press("Enter")
  // A Thread not yet started gets the focus instead of a new one, so the
  // first message must have started it.
  const thread = composer.locator("xpath=ancestor::section[1]")
  await expect(thread).not.toHaveAccessibleName("New Thread")
  await page.keyboard.press("Alt+Enter")
  await expect(page.getByRole("region", { name: "New Thread" })).toBeVisible()
}

/** What the recorded desktop was asked to show (app/desktop/src/notices.ts). */
export type Recorded = {
  shown: {
    key: string
    title: string
    body?: string
    icon?: string
    answer: string
    lasts: boolean
  }[]
  withdrawn: string[]
  isQuiet: boolean
}

/** Reads the recorded desktop. */
export function desktopOf(app: ElectronApplication): Promise<Recorded> {
  return app.evaluate(() => {
    const desktop = (globalThis as unknown as { bandaDesktop: Recorded })
      .bandaDesktop
    return {
      shown: desktop.shown,
      withdrawn: desktop.withdrawn,
      isQuiet: desktop.isQuiet,
    }
  })
}

/** Turns the desktop's Do Not Disturb on or off. */
export async function setQuiet(app: ElectronApplication, quiet: boolean) {
  await app.evaluate((_electron, quiet) => {
    ;(
      globalThis as unknown as { bandaDesktop: Recorded }
    ).bandaDesktop.isQuiet = quiet
  }, quiet)
}

/** The Person clicks the notice of `key`. */
export async function clickNotice(app: ElectronApplication, key: string) {
  await app.evaluate((_electron, key) => {
    ;(
      globalThis as unknown as {
        bandaDesktop: { click: (key: string) => void }
      }
    ).bandaDesktop.click(key)
  }, key)
}

/**
 * The Person goes to another window, or comes back: the page hears its
 * window lose or take the desktop's focus. A headless window never does.
 */
export async function setInFront(page: Page, front: boolean) {
  await page.evaluate((front) => {
    const own = globalThis as unknown as { realHasFocus?: () => boolean }
    own.realHasFocus ??= Document.prototype.hasFocus
    Document.prototype.hasFocus = front ? own.realHasFocus : () => false
    window.dispatchEvent(new Event(front ? "focus" : "blur"))
  }, front)
}
