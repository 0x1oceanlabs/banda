/**
 * Starts the real window on a throwaway machine: its own folders, and the
 * fake agent as the only Harness, so no test reaches a paid model.
 */
import { execFileSync, spawn, spawnSync } from "node:child_process"
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
  test,
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
  /** The engine's pid, main's child `banda start --with-parent`, which
   * serves the engine for a checkout's window (engine.ts), and only
   * follows it where it runs as a service; none while it restarts. Main's
   * other `banda`, `look --follow`, is not it. */
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
    // A new Thread keeps its first message's title (ADR 0118).
    BANDA_AUTO_TITLE: "off",
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
        const found = execFileSync(
          "pgrep",
          ["-P", main, "-f", "(^|/)banda start --with-parent$"],
          { encoding: "utf8" }
        )
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
export async function agentSays(
  window: Pick<Window, "dir">,
  name: string,
  args: object
) {
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
 * site answers the window meanwhile. `window` is the folder whose fake
 * agent wrote mcp.json: a window's, or another machine's (arc.ts).
 */
export async function agentCalls(
  window: Pick<Window, "dir">,
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

/** Opens the Banda menu at "Add Project" as the Person does, by ✎'s
 * menu in the sidebar's header (ADR 0098, decision 16): the sidebar
 * shows. The menu, at its ways to add one. */
export async function addProject(page: Page): Promise<Locator> {
  await page
    .getByRole("complementary", { name: "Sidebar" })
    .getByRole("button", { name: "New Thread", exact: true })
    .click({ button: "right" })
  await page
    .getByRole("menu", { name: "New Thread" })
    .getByRole("menuitem", { name: "Add Project…" })
    .click()
  const menu = page.getByRole("dialog", { name: "Banda menu" })
  await expect(menu.getByRole("option", { name: /New Project/ })).toBeVisible()
  return menu
}

/** Makes a Project called `name` from the Banda menu, as the Person does:
 * its New Thread shows. */
export async function newProject(page: Page, name: string): Promise<void> {
  const menu = await addProject(page)
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

/** Starts a New Thread with `text` in the Project in front, as the Person
 * does, from Alt+Enter: its region, which has the focus. */
export async function startAgent(page: Page, text: string): Promise<Locator> {
  await page.keyboard.press("Alt+Enter")
  const box = page
    .getByRole("region", { name: "New Thread" })
    .getByRole("textbox", { name: "Message to Fake AI" })
  await expect(box).toBeFocused()
  await box.fill(text)
  await box.press("Enter")
  return page.getByRole("region", { name: text, exact: true })
}

/** A recording `record` began. */
export type Recording = {
  /** Stops capturing: the last frame the page drew runs on to now, and
   * ffmpeg has kept every frame once it settles. The video is not written
   * yet, so a recording stopped while another goes on takes nothing from
   * it. */
  stop: () => Promise<void>
  /** Encodes the frames `stop` kept as the video, then removes them. */
  encode: () => Promise<void>
  /** Leaves nothing of a recording not encoded: it stops capturing, as far
   * as the page still answers, kills ffmpeg, and removes its frames and
   * any video half written. It never fails, and does nothing once
   * `encode` is done. A test runs it whatever happened (`finally`), and
   * the page's closing runs it if the recording was never stopped. */
  discard: () => Promise<void>
}

/** `promise`, settled or not after `ms`: what a page gone may never
 * answer. */
const settled = (promise: Promise<unknown>, ms: number) =>
  Promise.race([
    promise.catch(() => {}),
    new Promise<void>((done) => setTimeout(done, ms).unref()),
  ])

/**
 * Records what `page` shows from now as the WebM video `path`, at `size`:
 * 25 frames a second, each the last the page drew by then; it is written
 * once `encode()` is, after `stop()`. The machine's ffmpeg makes it, as
 * Playwright's own (`recordVideo`) needs its ffmpeg, which these tests never
 * download, and without it the page never answers; where the machine has
 * none, it records nothing and says so in the test's annotations. While
 * the page plays, ffmpeg only keeps its JPEGs as they come, beside `path`
 * (`<path>.mjpeg.mkv`, about 100 MB a minute), so encoding takes nothing
 * from what is recorded, nor holds frames in memory as it falls behind.
 * Whatever is not encoded, `discard()` removes.
 */
export async function record(
  page: Page,
  path: string,
  size: { width: number; height: number }
): Promise<Recording> {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) {
    test.info().annotations.push({
      type: "not recorded",
      description: `${path}: no ffmpeg on this machine`,
    })
    const none = async () => {}
    return { stop: none, encode: none, discard: none }
  }
  const fps = 25
  const frames = `${path}.mjpeg.mkv`
  const ffmpeg = (args: string[], stdin: "pipe" | "ignore" = "ignore") =>
    spawn("ffmpeg", ["-loglevel", "error", "-y", ...args], {
      stdio: [stdin, "ignore", "inherit"],
    })
  /** What `run` ended with, as an error that names `what` unless 0. */
  const ended = async (run: ReturnType<typeof ffmpeg>, what: string) => {
    const [code] = await once(run, "close")
    if (code !== 0) throw new Error(`ffmpeg, ${what} ${path}: ${code}`)
  }
  const kept = ffmpeg(
    [
      ...["-f", "image2pipe", "-framerate", `${fps}`, "-c:v", "mjpeg"],
      ...["-i", "pipe:0", "-an", "-c:v", "copy", "-f", "matroska", frames],
    ],
    "pipe"
  )
  const keeping = ended(kept, "keeping the frames of")
  // Awaited as it stops; meanwhile a failure waits for it there.
  keeping.catch(() => {})
  let broken: Error | undefined
  kept.stdin!.on("error", (error) => (broken ??= error))
  // Capturing, stopping, its frames kept, encoding, then done: encoded,
  // or discarded.
  let stage: "capturing" | "stopping" | "kept" | "encoding" | "done" =
    "capturing"
  let encoding: Promise<void> | undefined
  let encoder: ReturnType<typeof ffmpeg> | undefined
  // The last frame the page drew, when it drew it by its clock and by
  // ours, and how many frames of the video are written.
  let last: { data: Buffer; at: number; here: number } | undefined
  let first = 0
  let written = 0
  /** The last frame again, until the video is `at` ms long. */
  const upTo = (at: number) => {
    const due = Math.floor(((at - first) * fps) / 1000)
    for (; last && written < due; written++) kept.stdin!.write(last.data)
  }
  const discard = async () => {
    if (stage === "done") return
    const was = stage
    stage = "done"
    page.off("close", closed)
    kept.stdin!.end()
    kept.kill("SIGKILL")
    encoder?.kill("SIGKILL")
    if (was === "capturing") await settled(page.screencast.stop(), 5000)
    await Promise.allSettled([keeping, encoding])
    rmSync(frames, { force: true })
    if (encoder) rmSync(path, { force: true })
  }
  // A page that closes, or is killed, before its recording stops.
  const closed = () => void discard()
  page.once("close", closed)
  try {
    await page.screencast.start({
      size,
      onFrame: ({ data, timestamp }) => {
        if (stage !== "capturing") return
        if (!last) first = timestamp
        upTo(timestamp)
        last = { data, at: timestamp, here: Date.now() }
      },
    })
  } catch (error) {
    await discard()
    throw error
  }
  return {
    stop: async () => {
      if (stage !== "capturing") return
      stage = "stopping"
      page.off("close", closed)
      try {
        await page.screencast.stop()
      } finally {
        // Whatever the page says, ffmpeg ends with what it has.
        if (last) upTo(last.at + (Date.now() - last.here) + 1000 / fps)
        kept.stdin!.end()
      }
      await keeping
      if (broken) throw new Error(`ffmpeg, recording ${path}: ${broken}`)
      if (stage === "stopping") stage = "kept"
    },
    encode: async () => {
      if (stage !== "kept")
        throw new Error(`${path}: encoded while ${stage}, not stopped`)
      stage = "encoding"
      encoder = ffmpeg([
        ...["-nostdin", "-i", frames, "-an"],
        ...["-c:v", "libvpx", "-deadline", "good", "-cpu-used", "5"],
        ...["-crf", "10", "-b:v", "4M", "-pix_fmt", "yuv420p", path],
      ])
      encoding = ended(encoder, "encoding")
      await encoding
      if (stage !== "encoding") return
      stage = "done"
      rmSync(frames, { force: true })
    },
    discard,
  }
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
  const screen = await openTerminal(page)
  await expect(
    page.locator("section[data-tile]").filter({ has: screen }).locator("header")
  ).toContainText("root/Work")
  return screen
}

/** A shell opened from the Pane in focus, by Alt+N, and its screen once it
 * runs: in that Pane's Group, if it is in one. */
export async function openTerminal(page: Page): Promise<Locator> {
  await page.keyboard.press("Alt+KeyN")
  await page
    .getByRole("region", { name: "New Pane" })
    .getByRole("button", { name: "Terminal" })
    .click()
  const screen = page.getByRole("region", { name: "Terminal screen" })
  await expect(screen).toHaveAttribute("data-state", "running")
  return screen
}

/**
 * The URL a Pane makes for the file at `path` in Project `project` for
 * `use` (ADR 0106, decision 6): a token this machine's engine gives the
 * Person (`bytes.issue`), on the sandbox host for a page and the byte
 * host for the rest, which main relays to that engine. None where the
 * engine refuses it.
 */
export function bytesUrl(
  window: Window,
  project: string,
  path: string,
  use: "file" | "media" | "page" = "file"
): string | null {
  try {
    const params = JSON.stringify({ path, use })
    const { ok } = JSON.parse(
      window.banda(
        "call",
        "bytes.issue",
        "--project",
        project,
        "--params",
        params
      )
    ) as { ok: { token: string } }
    return `app://${use === "page" ? "preview" : "files"}/${ok.token}`
  } catch {
    return null
  }
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

/** Work's id in each window, looked up once. */
const works = new WeakMap<Window, string>()

/** What the engine's `method` answers in the Project "Work", run as the
 * Person's `banda call`, from outside the Window. */
export function call(window: Window, method: string, params?: object) {
  if (!works.has(window)) works.set(window, projectId(window, "Work"))
  const work = works.get(window)!
  const args = params ? ["--params", JSON.stringify(params)] : []
  return JSON.parse(window.banda("call", method, "--project", work, ...args)).ok
}

/** Work's Thread named `title`, as the engine lists it; none until it is
 * listed, and with no latest turn until its first has begun. */
export function threadNamed(window: Window, title: string) {
  const { threads } = call(window, "agents.threads") as {
    threads: {
      id: string
      title: string
      latest?: { turn: string; state: string }
      later?: { someday?: boolean; woke?: { by: string }; woke_seen?: string }
    }[]
  }
  return threads.find((thread) => thread.title === title)
}

export const sidebarOf = (page: Page) =>
  page.getByRole("complementary", { name: "Sidebar" })

/** The sidebar's view menu, in its foot (ADR 0098, decision 21). */
export const viewMenuOf = (page: Page) =>
  page.getByRole("dialog", { name: "View" })

/**
 * Groups the sidebar list by `by` from its view menu, as the Person does
 * (ADR 0098, decision 7): the menu writes `group` into sidebar.toml, and
 * the look brings it back, picked. Esc then closes the menu.
 */
export async function groupBy(
  page: Page,
  by: "None" | "Project" | "Machine"
): Promise<void> {
  await sidebarOf(page)
    .getByRole("button", { name: "View", exact: true })
    .click()
  const picked = viewMenuOf(page)
    .getByRole("radiogroup", { name: "Group by" })
    .getByRole("radio", { name: by })
  await picked.click()
  await expect(picked).toHaveAttribute("aria-checked", "true")
  await page.keyboard.press("Escape")
  await expect(viewMenuOf(page)).toBeHidden()
}

/**
 * The Banda menu, opened by its key from where the focus is (ADR 0017,
 * decision 1). While the sidebar shows, Alt+Space goes to its Search
 * first, and pressed there again with nothing typed opens the menu (ADR
 * 0098, decision 17): two presses then, one where it is hidden.
 */
export async function bandaMenu(page: Page): Promise<Locator> {
  await page.keyboard.press("Alt+Space")
  const inSearch = await page.evaluate(
    () => document.activeElement?.id === "sb-search"
  )
  if (inSearch) await page.keyboard.press("Alt+Space")
  const menu = page.getByRole("dialog", { name: "Banda menu" })
  await expect(menu).toBeVisible()
  return menu
}
/** The Later picker, Alt+Z's. */
export const pickerOf = (page: Page) =>
  page.getByRole("dialog").filter({ hasText: "Later ·" })
export const toastsOf = (page: Page) =>
  page.getByRole("region", { name: "Notifications" })

/**
 * The pointer leaves the Sidebar for the Strip: its list holds still
 * under the pointer, and moves once it leaves; a card the pointer put
 * away leaves a ghost line in its slot until then (ADR 0098, S5c).
 *
 * It never lands on a browser Pane's page, but just above it, on its
 * Pane: a move CDP sends goes straight to the frame under the point, so
 * one into a `<webview>` can reach that page alone, and the window's page
 * never hears the pointer leave its list, which then holds for good (seen
 * in motion.spec.ts). Whether a real mouse's moves do the same is not
 * checked yet: they go through Chromium's input router, which may tell the
 * window's page the pointer left. Until the window hears it from main,
 * #1291 tracks it.
 */
export async function leaveSidebar(page: Page) {
  const box = (await sidebarOf(page).boundingBox())!
  const x = box.x + box.width + 200
  const y = await page.evaluate(
    ([x, y]) => {
      const under = document.elementFromPoint(x, y)
      return under?.tagName === "WEBVIEW"
        ? under.getBoundingClientRect().top - 4
        : y
    },
    [x, box.y + box.height / 2]
  )
  await page.mouse.move(x, y)
}

/** The Agent at work in Work's Thread named `title` ends its turn, done:
 * its Person's word goes into the turn from outside the Window. */
export function finish(window: Window, title: string) {
  const thread = threadNamed(window, title)!.id
  call(window, "agents.send", { thread, text: "go", steer: true })
}

/** A Thread in Work started with `text` from outside the Window, with no
 * Pane, one after the other, so each is newer than the one before: at
 * work while its words say "wait", else answered, calling its Person. */
export async function send(window: Window, text: string): Promise<void> {
  call(window, "agents.send", { harness: "fake", text, settings: null })
  await expect
    .poll(() => threadNamed(window, text)?.latest?.state)
    .toBe(text.includes("wait") ? "running" : "done")
}

/**
 * The items of the sidebar list's region `name` in `scope`: its cards,
 * heads and group header. The list is drawn flat, so a card keeps its node
 * from one region to another, and each item names its region (ADR 0098,
 * S5c); the first is the region's head or header.
 */
export const placeOf = (scope: Page | Locator, name: string): Locator =>
  scope.locator(`[data-place="${name}"]`)

/** Where each of `rows` stands, from the window's top, in px: the list
 * holds still while none of them moves. */
export const topsOf = (rows: Locator): Promise<number[]> =>
  rows.evaluateAll((all) => all.map((one) => one.getBoundingClientRect().top))

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

/** The room of the Strip on screen, in pixels across the page: past the
 * Sidebar over its left, and short of its right padding. */
function roomOf(page: Page): Promise<{ from: number; to: number }> {
  return page.locator(`${ON_SCREEN} [data-strip]`).evaluate((strip) => {
    const box = strip.getBoundingClientRect()
    const style = getComputedStyle(strip)
    return {
      from: box.left + parseFloat(style.paddingLeft),
      to: box.right - parseFloat(style.paddingRight),
    }
  })
}

/** How far `tile` stands from the left of the Strip on screen, in pixels:
 * none for a picked Agent (ADR 0065, decision 8). */
export async function fromLeft(page: Page, tile: Locator): Promise<number> {
  const { from } = await roomOf(page)
  return Math.abs((await tile.boundingBox())!.x - from)
}

/** How much of `tile`'s width shows in the room of the Strip on screen, in
 * percent. */
export async function shownOf(page: Page, tile: Locator): Promise<number> {
  const room = await roomOf(page)
  const box = (await tile.boundingBox())!
  const shown =
    Math.min(box.x + box.width, room.to) - Math.max(box.x, room.from)
  return Math.round((Math.max(0, shown) / box.width) * 100)
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
