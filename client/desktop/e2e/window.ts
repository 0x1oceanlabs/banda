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
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { createRequire } from "node:module"
import { availableParallelism, loadavg, tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
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
/** agents.toml in the Flow `free`, for `startWindow`'s files: a new Pane
 * opens right of the one in front, wherever it is, as the tests of the
 * keys, the mouse and the overview were written for; the row's own rules
 * have tests of their own (ADR 0102). */
export const FREE = { "config/agents.toml": 'flow = "free"\n' }

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

/** How main's line starts, on its console, when one of the window's
 * processes went. */
const GONE = "window.ts:"

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
 * answered already: nothing shared. `latency` is how many ms late the
 * page hears the engine, as from a host far away (`BANDA_TEST_LATENCY`).
 * `env` is more of the window's environment; `dir`, the throwaway folder
 * of a window before, to open again on what it left. */
export async function startWindow({
  account = false,
  oldCli = false,
  other = false,
  look = "",
  sidebar = "",
  files = {} as Record<string, string>,
  asked = true,
  deviceScaleFactor = 1,
  latency = 0,
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
    // A new Thread's mode follows the fence (ADR 0083): off here, so it
    // starts Supervised on every machine the tests run on.
    BANDA_FENCE: "off",
    BANDA_BLOCK_LIST: join(dir, "blocker.txt"),
    // Notices go to a list the tests read, never to the Person's screen.
    BANDA_DESKTOP: "recorded",
    // A terminal runs the Person's shell: here one every machine has.
    SHELL: "/bin/sh",
    // The system's Trash is a throwaway one, as freedesktop finds it, on
    // the same disk as the throwaway Projects (ADR 0073, decision 10).
    XDG_DATA_HOME: join(dir, "xdg-data"),
    // What the engine says reaches the page this many ms late, as from a
    // host far away (`Address.latency`).
    ...(latency > 0 && { BANDA_TEST_LATENCY: String(latency) }),
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
  // Playwright says only that a page crashed: main says why.
  app.on("console", (message) => {
    if (message.text().startsWith(GONE)) console.warn(message.text())
  })
  await app.evaluate(({ app }, gone) => {
    app.on("render-process-gone", (_, contents, { reason, exitCode }) =>
      console.log(
        `${gone} a ${contents.getType()}'s page went: ${reason}, code ${exitCode}`
      )
    )
    app.on("child-process-gone", (_, { type, reason, exitCode }) => {
      if (reason !== "clean-exit")
        console.log(
          `${gone} the ${type} process went: ${reason}, code ${exitCode}`
        )
    })
  }, GONE)
  const page = await app.firstWindow()
  // A headless screen is small; the window takes a laptop's size.
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 800)
  )
  // Playwright's viewport holds the page at a scale of 1, whatever the
  // screen's: on a screen of another, the window's own size is the page's.
  if (deviceScaleFactor === 1)
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
 * Presses a key in the browser page that has the focus, as the keyboard
 * does: Playwright's own keys skip Electron's `before-input-event`, where
 * the desktop takes Banda's keys from a page. `keyCode` and `modifiers` are
 * Electron's. With no page focused, the first page takes it, unless
 * `focused` says only a focused one may. Whether a page took it.
 */
export async function pressInPage(
  app: ElectronApplication,
  keyCode: string,
  modifiers: ("alt" | "shift" | "control")[],
  {
    types = ["keyDown", "keyUp"],
    focused = false,
  }: { types?: ("keyDown" | "keyUp")[]; focused?: boolean } = {}
): Promise<boolean> {
  return app.evaluate(
    ({ webContents }, { keyCode, modifiers, types, focused }) => {
      const pages = webContents
        .getAllWebContents()
        .filter((contents) => contents.getType() === "webview")
      const page =
        pages.find((each) => each.isFocused()) ??
        (focused ? undefined : pages[0])
      if (!page) return false
      for (const type of types)
        page.sendInputEvent({ type, keyCode, modifiers })
      return true
    },
    { keyCode, modifiers, types, focused }
  )
}

/** Ten tiling keys, from a New Thread and three launchers: they end with
 * the launchers before the Thread, the last one first (roma-day.spec.ts,
 * and keys.spec.ts with the engine far). */
export const TEN_KEYS = [
  "Alt+KeyN",
  "Alt+Shift+Home",
  "Alt+ArrowRight",
  "Alt+Shift+End",
  "Alt+Home",
  "Alt+KeyW",
  "Alt+Shift+ArrowRight",
  "Alt+Shift+ArrowRight",
  "Alt+ArrowLeft",
  "Alt+Shift+Home",
]

/**
 * Presses `keys`, each as Playwright names it (`Alt+Shift+Home`,
 * `Control+Alt+ArrowLeft`), in one task of the page, as the Window's keys
 * hear them: each lands before the one before is drawn, however fast the
 * machine, and before anything the engine says can be heard. Says the
 * page's time (`performance.now()`) just before the first and just after
 * the last, read in that task, so a test times from the keys themselves
 * and not from a round trip to the page.
 */
export async function pressAtOnce(
  page: Page,
  keys: string[]
): Promise<{ before: number; after: number }> {
  const events = keys.map((press) => {
    const mods = press.split("+")
    const code = mods.pop()!
    return {
      code,
      key: code.startsWith("Key") ? code.slice(3).toLowerCase() : code,
      altKey: mods.includes("Alt"),
      ctrlKey: mods.includes("Control"),
      metaKey: mods.includes("Meta"),
      shiftKey: mods.includes("Shift"),
    }
  })
  return page.evaluate((events) => {
    const target = document.activeElement ?? document.body
    const before = performance.now()
    for (const key of events)
      for (const type of ["keydown", "keyup"])
        target.dispatchEvent(
          new KeyboardEvent(type, { ...key, bubbles: true, cancelable: true })
        )
    return { before, after: performance.now() }
  }, events)
}

/** This machine's load a core: the processes that ran or waited to, over
 * the last minute, for each of its cores. */
export function loadACore(): number {
  return loadavg()[0] / availableParallelism()
}

/**
 * Why this machine, at `load` a core, is too busy to time the window by
 * in ms: busy with more than a quarter of its cores, it times itself as
 * much as the window. keys.spec.ts gates its keys' ms only below that,
 * and motion.md says it beside a phase's load. None below that.
 */
export function busy(load = loadACore()): string | undefined {
  return load > 0.25 ? `load ${load.toFixed(2)} a core` : undefined
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
 * Marks how every Thread of `dir`'s Projects came to be in Full access,
 * where the engine keeps it and reads it as a turn starts (ADR 0083): no
 * mark, as a Thread from before the fence has, or `fenced`, as Full
 * access chosen where the fence held whole.
 */
export function markFullAccess(dir: string, mark: "fenced" | null) {
  const projects = join(dir, "data/projects")
  for (const id of readdirSync(projects)) {
    const file = join(projects, id, "project.sqlite3")
    if (!existsSync(file)) continue
    const db = new DatabaseSync(file, { timeout: 5000 })
    try {
      const table = db
        .prepare("SELECT 1 FROM sqlite_master WHERE name = 'agents_threads'")
        .get()
      if (table)
        db.prepare(
          "UPDATE agents_threads SET full_access = ? WHERE full_access IS NOT NULL"
        ).run(mark)
    } finally {
      db.close()
    }
  }
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

/** Runs git in `folder`, as one who has no config of their own, and says
 * what it printed. */
export function git(folder: string, ...args: string[]): string {
  return execFileSync("git", args, {
    encoding: "utf8",
    cwd: folder,
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "Roma",
      GIT_AUTHOR_EMAIL: "roma@banda.so",
      GIT_COMMITTER_NAME: "Roma",
      GIT_COMMITTER_EMAIL: "roma@banda.so",
    },
  })
}

/** The id of the Project named `name`, as the Person's `banda call` lists
 * it. */
export function projectId(window: Window, name: string): string {
  const { ok } = JSON.parse(window.banda("call", "projects.list")) as {
    ok: { id: string; name: string }[]
  }
  return ok.find((project) => project.name === name)!.id
}

/** The workspace on screen. */
export const ON_SCREEN = '[role="group"]:not([aria-hidden="true"])'

/** The bar's workspace buttons by their names, from the top. */
export function workspaceNames(page: Page) {
  return page
    .getByRole("navigation", { name: "Workspaces" })
    .getByRole("button")
    .evaluateAll((buttons) => buttons.map((b) => b.ariaLabel))
}

/** The plate of the Group whose column holds `tile`; none in no Group. */
export const plateOf = (tile: Locator) =>
  tile.locator("xpath=ancestor::*[@data-column][1]/*[@data-group-plate]")

/** The workspace on screen: each column's Tiles, top down, by ID. */
export function layoutOf(page: Page) {
  return page.evaluate(
    (onScreen) =>
      [...document.querySelectorAll(`${onScreen} [data-column]`)].map(
        (column) =>
          [...column.querySelectorAll<HTMLElement>(":scope > [data-tile]")].map(
            (tile) => tile.dataset.tile
          )
      ),
    ON_SCREEN
  )
}

/**
 * Each column's share of the Strip's room, in hundredths, as the Strip
 * draws it: of each column `found` finds, or the column of each Tile it
 * finds, in their order. One that fills the screen has 100.
 */
export async function sharesOf(...found: Locator[]): Promise<number[]> {
  const shares = await Promise.all(
    found.map((each) =>
      each.evaluateAll((elements) =>
        elements.map((element) => {
          const column = element.closest<HTMLElement>("[data-column]")!
          const strip = column.parentElement!
          const style = getComputedStyle(strip)
          const gap = parseFloat(style.columnGap) || 0
          const room =
            strip.clientWidth -
            parseFloat(style.paddingLeft) -
            parseFloat(style.paddingRight) +
            gap
          return Math.round(((column.offsetWidth + gap) / room) * 100)
        })
      )
    )
  )
  return shares.flat()
}

/** How far `tile` stands from the left of the Strip on screen, in pixels:
 * none for a picked Agent (ADR 0065, decision 8). */
export async function fromLeft(page: Page, tile: Locator): Promise<number> {
  const left = await page
    .locator(`${ON_SCREEN} [data-strip]`)
    .evaluate(
      (strip) =>
        strip.getBoundingClientRect().left +
        parseFloat(getComputedStyle(strip).paddingLeft)
    )
  return Math.abs((await tile.boundingBox())!.x - left)
}

/**
 * What the header of `tile`, a Pane's section, shows, in order: a Mark,
 * a Project, another machine, Banda's buttons at its end, and the rest by
 * its words, as its title. A Thread's Mark and another machine's name
 * are the Apps' in the header's Slot (ADR 0062, decision 17).
 */
export async function headerShows(tile: Locator): Promise<string[]> {
  return tile
    .locator("header")
    .first()
    .evaluate((header) =>
      [...header.children].map((part) =>
        part.matches('[data-slot="banda-mark"]')
          ? "mark"
          : part.querySelector("[data-sign]")
            ? "project"
            : part.querySelector("[data-machine-icon]")
              ? "machine"
              : part.matches('[data-slot="pane-buttons"]')
                ? "buttons"
                : (part.textContent ?? "").trim()
      )
    )
}
