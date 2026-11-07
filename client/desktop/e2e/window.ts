/**
 * Starts the real window on a throwaway machine: its own folders, and the
 * fake agent as the only Harness, so no test reaches a paid model.
 */
import { execFileSync, spawn } from "node:child_process"
import { once } from "node:events"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Locator,
  type Page,
} from "@playwright/test"

const repository = resolve(import.meta.dirname, "../../..")
const desktop = resolve(import.meta.dirname, "..")

/** Playwright's loader, of the Playwright that runs the tests: it holds
 * the window's `ready` back until Playwright has attached. Playwright
 * puts it first only in an Electron it finds itself. */
const loader = (() => {
  let from = createRequire(import.meta.url).resolve("@playwright/test")
  for (const name of ["playwright", "playwright-core"])
    from = createRequire(from).resolve(`${name}/package.json`)
  return join(dirname(from), "lib/server/electron/loader.js")
})()

/**
 * What `electron.launch` takes to start the window of the checkout at
 * `app`, with `args` and `env`, in a systemd unit of its own, as
 * scripts/local.sh does: so the test's window lives and dies apart from
 * the Agent running the tests (ADR 0086, decision 7). It closes once this
 * test runner has gone, however it went, since nothing else would close
 * it there. Playwright's own args come before the loader then, so main's
 * `process.argv` keeps `-r <loader>` before the app, where Playwright
 * takes out only its own; Banda reads argv only when packaged.
 */
export const inUnit = (
  app: string,
  args: string[],
  env: NodeJS.ProcessEnv
) => ({
  executablePath: join(repository, "scripts/local.sh"),
  cwd: app,
  args: ["-r", loader, app, ...args],
  env: { ...env, BANDA_LOCAL_PARENT: String(process.pid) },
})

/**
 * Whether the window runs in Chromium's sandbox, as Banda does: extensions'
 * workers need it for their APIs. CI's containers cannot give it, so there
 * it runs without, as Playwright does unless asked.
 */
export const SANDBOXED = !process.env.CI

export type Window = {
  app: ElectronApplication
  page: Page
  dir: string
  /** The engine's pid, main's child named `banda`; none while it restarts. */
  engine: () => number | undefined
  /** Runs the `banda` CLI on this window's folders; what it printed. */
  banda: (...args: string[]) => string
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

/** A file's text, empty until it is written: `expect.poll` stops at a
 * throw, so a file the next click creates is read this way. */
export const textOf = (file: string) =>
  existsSync(file) ? readFileSync(file, "utf8") : ""

/** With `account`, the fake agent has one in the throwaway folders, signed
 * out. With `oldCli`, it runs a CLI that says 1.0.0 where its entry asks for
 * 2.0.0 at least. With `other`, a second fake Harness, "Other AI", is
 * listed after it. `look` and `sidebar` are the text of `look.toml` and
 * `sidebar.toml`; `files` are more, by their paths in the throwaway
 * folder. Unless `asked` is false, the first run's sharing question was
 * answered already: nothing shared. `env` is more of the window's
 * environment; `dir`, the throwaway folder of a window before, to open
 * again on what it left. */
export async function startWindow({
  account = false,
  oldCli = false,
  other = false,
  look = "",
  sidebar = "",
  files = {} as Record<string, string>,
  asked = true,
  deviceScaleFactor = 1,
  env: more = {} as Record<string, string>,
  dir = mkdtempSync(join(tmpdir(), "banda-window-")),
} = {}): Promise<Window> {
  mkdirSync(join(dir, "config"), { recursive: true })
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  // The blocker's lists: these two filters, never fetched.
  writeFileSync(join(dir, "blocker.txt"), "/banda-ad.js\n##.banda-ad\n")
  if (look) writeFileSync(join(dir, "config/look.toml"), look)
  if (sidebar) writeFileSync(join(dir, "config/sidebar.toml"), sidebar)
  if (asked && !files["config/sharing.toml"])
    writeFileSync(join(dir, "config/sharing.toml"), "problems = false\n")
  const fake = join(repository, "target/debug/banda-fake-agent")
  const home = join(dir, "fake-home")
  mkdirSync(home, { recursive: true })
  // The fake agent writes where each new session's MCP servers are, for
  // `agentCalls`.
  const mcp = `FAKE_AGENT_MCP = ${JSON.stringify(join(dir, "mcp.json"))}`
  const env = account
    ? `env = { FAKE_AGENT_HOME = ${JSON.stringify(home)}, ${mcp} }\n`
    : `env = { ${mcp} }\n`
  const cli = oldCli ? fakeCli(dir, "1.0.0", "2.0.0") : ""
  const entry = (id: string, name: string, more = "") =>
    `[[harness]]\nid = "${id}"\nname = "${name}"\ncommand = ${JSON.stringify(fake)}\n${env}${more}`
  writeFileSync(
    join(dir, "config/harnesses.toml"),
    entry("fake", "Fake AI", cli) + (other ? entry("other", "Other AI") : "")
  )
  // The test's window and `banda` are its own engine's owner's, wherever
  // the tests run: an Agent's shell hands `banda` a pass of its own.
  const outside: NodeJS.ProcessEnv = { ...process.env }
  delete outside.BANDA_TOKEN
  delete outside.BANDA_ENGINE
  const variables = {
    ...outside,
    BANDA_ROOT: join(dir, "root"),
    BANDA_DATA: join(dir, "data"),
    BANDA_STATE: join(dir, "state"),
    // The engine and the look read only this folder: no Omarchy, no
    // Hyprland.
    BANDA_CONFIG: join(dir, "config"),
    // Files' small pictures, kept in a throwaway cache, and none from the
    // Person's freedesktop one.
    BANDA_CACHE: join(dir, "cache"),
    BANDA_THUMBNAILS: "",
    BANDA_OMARCHY: "",
    BANDA_FONTCONFIG: "",
    HYPRLAND_INSTANCE_SIGNATURE: "",
    // Nor the desktop's wallpaper (ADR 0030).
    XDG_CURRENT_DESKTOP: "",
    BANDA_LOG: "warn",
    BANDA_BLOCK_LIST: join(dir, "blocker.txt"),
    // Notices go to a list the tests read, never to the Person's screen.
    BANDA_DESKTOP: "recorded",
    // A terminal runs the Person's shell: here one every machine has.
    SHELL: "/bin/sh",
    // The system's Trash is a throwaway one, as freedesktop finds it, on
    // the same disk as the throwaway Projects (ADR 0073, decision 10).
    XDG_DATA_HOME: join(dir, "xdg-data"),
    ...more,
  }
  const app = await electron.launch({
    ...inUnit(
      desktop,
      [
        `--force-device-scale-factor=${deviceScaleFactor}`,
        ...(process.env.BANDA_E2E_SHOW ? [] : ["--ozone-platform=headless"]),
      ],
      variables
    ),
    chromiumSandbox: SANDBOXED,
  })
  const page = await app.firstWindow()
  // A headless screen is small; the window takes a laptop's size.
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 800)
  )
  await page.setViewportSize({ width: 1280, height: 800 })
  // No test starts an editor of the machine's: none is found, unless the
  // test says which (`editorsOn`).
  await editorsOn(app, [])
  return {
    app,
    page,
    dir,
    banda: (...args) =>
      execFileSync(join(repository, "target/debug/banda"), args, {
        env: variables,
        encoding: "utf8",
      }),
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
 * Main as if `editors` were the code editors on this machine. What the
 * page opens in one is kept, never started: `openedIn` reads it, each as
 * the editor, the path, the line and the column. The page asks once a
 * run, so a test says this before anything shows an editor.
 */
export async function editorsOn(
  app: ElectronApplication,
  editors: { id: string; name: string }[]
): Promise<void> {
  await app.evaluate(({ ipcMain }, found) => {
    const opened: unknown[][] = []
    ;(globalThis as { openedIn?: unknown[][] }).openedIn = opened
    ipcMain.removeHandler("files.editors")
    ipcMain.handle("files.editors", () => found)
    ipcMain.removeHandler("files.openIn")
    ipcMain.handle("files.openIn", (_event, ...args: unknown[]) => {
      opened.push(args)
    })
  }, editors)
}

/** What the page opened in an editor since `editorsOn`. */
export const openedIn = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as { openedIn?: unknown[][] }).openedIn)

/** What a tool of `banda mcp` says, which it did not refuse. */
export async function agentSays(window: Window, name: string, args: object) {
  const said = await agentCalls(window, name, args)
  expect(said.isError, said.content[0]?.text).toBeFalsy()
  return said.content[0]!.text
}

/** What a tool of `banda mcp` answers as JSON, which it did not refuse. */
export async function agentAnswers(window: Window, name: string, args: object) {
  return JSON.parse(await agentSays(window, name, args))
}

/**
 * The Agent of the Thread whose session opened last calls Banda's tool
 * `name` with `args`, through `banda mcp` as its Harness would; what the
 * tool answered (ADR 0019). It waits without blocking, so the test's own
 * site answers the window meanwhile.
 */
export async function agentCalls(
  window: Window,
  name: string,
  args: object
): Promise<{
  isError?: boolean
  content: [
    { type: "text"; text: string },
    ...(
      | { type: "text"; text: string }
      | { type: "image"; data: string; mimeType: string }
    )[],
  ]
}> {
  const [server] = JSON.parse(
    readFileSync(join(window.dir, "mcp.json"), "utf8")
  ) as {
    command: string
    args: string[]
    env: { name: string; value: string }[]
  }[]
  const env = Object.fromEntries(server.env.map((v) => [v.name, v.value]))
  const hello = {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "e2e", version: "1" },
  }
  const messages = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: hello },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name, arguments: args },
    },
  ]
  const child = spawn(server.command, server.args, {
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "inherit"],
  })
  child.stdin.end(messages.map((m) => JSON.stringify(m)).join("\n") + "\n")
  let said = ""
  child.stdout.setEncoding("utf8").on("data", (chunk) => (said += chunk))
  const [code] = await once(child, "close")
  if (code !== 0) throw new Error(`banda mcp exited with ${code}`)
  return JSON.parse(said.trim().split("\n").at(-1)!).result
}

/**
 * Makes the first Project, "Work", which opens a new Thread on the fake
 * agent. The Thread is found by its message box, so it stays found once
 * its first message gives it a title.
 */
/** A look whose desk is glass made of `wall.png`, once `wallpaper` puts
 * that picture in the window's config folder. */
export const GLASS = '[desk]\nwallpaper = "wall.png"\n'

/** Puts a 1×1 sky-blue PNG where `GLASS` looks for the wallpaper. */
export function wallpaper(dir: string) {
  writeFileSync(
    join(dir, "config/wall.png"),
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGOImHkHAAOAAg7PaQnHAAAAAElFTkSuQmCC",
      "base64"
    )
  )
}

/** Makes a Project called `name` from the Banda menu, as the Person does:
 * its New Thread shows. */
export async function newProject(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: "Add Project", exact: true }).click()
  const menu = page.getByRole("dialog", { name: "Banda menu" })
  await menu.getByRole("option", { name: /New Project/ }).click()
  await menu.getByRole("combobox").fill(name)
  await menu.getByRole("combobox").press("Enter")
  await expect(menu).toBeHidden()
}

export async function firstThread(
  page: Page
): Promise<{ thread: Locator; composer: Locator }> {
  await expect(page.getByRole("region", { name: "New Thread" })).toBeVisible()
  await page
    .getByRole("region", { name: "New Thread" })
    .getByRole("button", { name: "Close New Thread", exact: true })
    .click()
  await newProject(page, "Work")
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
  // The first message must have started it, so the new one is the only
  // New Thread.
  const thread = composer.locator("xpath=ancestor::section[1]")
  await expect(thread).not.toHaveAccessibleName("New Thread")
  await page.keyboard.press("Alt+Enter")
  await expect(page.getByRole("region", { name: "New Thread" })).toBeVisible()
}

/** What the recorded desktop was asked to show (platform/notifications/desktop/src/notices.ts). */
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

/** A new shell in the first Project, and its screen once it runs and its
 * header says where it is: paths it prints start there. */
export async function newTerminal(page: Page): Promise<Locator> {
  await firstThread(page)
  await expect(page.getByRole("region", { name: "New Thread" })).toBeVisible()
  await page.keyboard.press("Alt+KeyN")
  await page
    .getByRole("region", { name: "New Pane" })
    .getByRole("button", { name: "Terminal" })
    .click()
  const screen = page.getByRole("region", { name: "Terminal screen" })
  await expect(screen).toHaveAttribute("data-state", "running")
  await expect(
    page.locator("section[data-tile]").filter({ has: screen }).locator("header")
  ).toContainText("root/Work")
  return screen
}

/** The text of the file at `path`; none while it is not there. */
export function read(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8")
  } catch {
    return undefined
  }
}
