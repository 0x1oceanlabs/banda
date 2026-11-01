/**
 * The desktop window. It runs the engine as its child, serves the page
 * from `app://banda` and hands the page the engine's address. It also
 * runs `banda look --follow` and hands the page each look (ADR 0007),
 * and writes the preset the page picks into `sidebar.toml` (ADR 0008);
 * nothing else crosses from Node to the page (docs/architecture.md,
 * "Processes"). The page shows the browser's pages, kept apart from it
 * (browser.ts, ADR 0013). Settings open in a window of their own, the same
 * page at `#settings` (settings.ts, ADR 0016).
 */
import { join, resolve, sep } from "node:path"
import { pathToFileURL } from "node:url"
import {
  app,
  BrowserWindow,
  type BrowserWindowConstructorOptions,
  ipcMain,
  Menu,
  nativeTheme,
  net,
  protocol,
  session,
  shell,
} from "electron"
import type { Look as LookValue } from "@banda/contract/look"
import type { Notice } from "@banda/web/host"
import { NodeServices } from "@effect/platform-node"
import { Effect, Layer, ManagedRuntime, Stream } from "effect"
import { Blocker } from "./blocker"
import { hostPages, keepProfile, reveal } from "./browser"
import { openDoor } from "./door"
import { Extensions } from "./extensions"
import { Engine } from "./engine"
import { firstFrame, Look } from "./look"
import { type Desktop, RecordedDesktop, SystemDesktop } from "./notices"
import { Settings } from "./settings"
import { ensure } from "./sidebar"

/** The page's origin; the engine lets it in (kernel/src/api.rs, APP_ORIGIN). */
const ORIGIN = "app://banda"
/**
 * In development, the Vite server's address; the page is served from it.
 * A packaged app ignores it: no other page ever gets the engine.
 */
const DEV_PAGE = app.isPackaged ? undefined : process.env.BANDA_PAGE
/** Where the windows load the page from. */
const PAGE = DEV_PAGE ?? `${ORIGIN}/index.html`

const CSP = [
  "default-src 'self'",
  // Ghostty draws terminals from WebAssembly that ships with the page.
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  // An extension's button shows its icon from crx:// (extensions.ts).
  "img-src 'self' data: crx:",
  "font-src 'self' data:",
  // The engine; and the page's own files, as Ghostty fetches its WebAssembly.
  "connect-src 'self' ws://127.0.0.1:*",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ")

const here = app.getAppPath()
const pageFolder = resolve(here, "../web/dist")
const engineBinary =
  process.env.BANDA_ENGINE ??
  (app.isPackaged
    ? join(process.resourcesPath, "banda")
    : resolve(here, "../../target/debug/banda"))

// The window keeps its own state beside the engine's when that moves, so
// a test or a second setup never shares a profile with the first.
// Otherwise it is pinned where it was, `~/.config/@banda/desktop`, before
// the name below can move it.
app.setPath(
  "userData",
  process.env.BANDA_STATE
    ? join(process.env.BANDA_STATE, "window")
    : app.getPath("userData")
)
// The name the desktop's notices and the Web Store show. The window's
// class, `banda-desktop`, still comes from the package's name, so window
// rules that match it keep working.
app.setName("Banda")

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
])

/** Main's services (ADR 0020): the engine and the look, as children.
 * They start with the first effect run, and stop when it is disposed. */
const runtime = ManagedRuntime.make(
  Layer.mergeAll(Engine.layer(engineBinary), Look.layer(engineBinary)).pipe(
    Layer.provide(NodeServices.layer)
  )
)
/** The last look, for what reads it at once; none before the first.
 * The window opens once the runtime is built (`ready`). */
const lookNow = () => runtime.runSync(Look.use((look) => look.current))
const settings = new Settings(engineBinary)
let window: BrowserWindow | null = null
/** The settings window; one at a time (ADR 0016, decision 1). */
let settingsWindow: BrowserWindow | null = null

/**
 * Where the page's notices go: the desktop's notification server, or, for
 * the end-to-end tests, a list they read (`BANDA_DESKTOP=recorded`).
 */
const desktop: Desktop =
  process.env.BANDA_DESKTOP === "recorded"
    ? ((globalThis as { bandaDesktop?: RecordedDesktop }).bandaDesktop =
        new RecordedDesktop())
    : new SystemDesktop()

/** How long the window waits for its look, so it opens in its colours. */
const LOOK_WAIT = 300

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on("second-instance", () => inFront())
  void app.whenReady().then(ready)
}

async function ready(): Promise<void> {
  const blocker = new Blocker()
  const listen = (now: LookValue) => {
    void blocker.set(now.browser.blocker)
    // Native parts (scrollbars, menus) and the page's own
    // prefers-color-scheme follow the look's mode.
    nativeTheme.themeSource = now.mode
    const background = firstFrame(now, nativeTheme.shouldUseDarkColors)
    for (const shown of [window, settingsWindow]) {
      if (background) shown?.setBackgroundColor(background)
      shown?.webContents.send("look", now)
    }
  }
  runtime.runFork(
    Look.use((look) =>
      look.changes.pipe(
        Stream.runForEach((now) => Effect.sync(() => listen(now)))
      )
    )
  )
  protocol.handle("app", page)
  // The page asks for nothing: no camera, no notifications, no location.
  // Its system notifications go through the desktop (notices.ts).
  session.defaultSession.setPermissionRequestHandler(
    (_contents, _permission, answer) => answer(false)
  )
  keepProfile(() => window)
  const extensions = new Extensions(() => window)
  ipcMain.handle("engine", (event) => {
    const from = event.senderFrame?.url ?? ""
    if (!fromPage(from))
      throw new Error("Only Banda's page may ask for the engine.")
    return runtime.runPromise(Engine.use((engine) => engine.address))
  })
  ipcMain.handle("look", (event) => {
    const from = event.senderFrame?.url ?? ""
    if (!fromPage(from))
      throw new Error("Only Banda's page may ask for the look.")
    return lookNow()
  })
  ipcMain.handle("sidebar.preset", async (event, name: unknown) => {
    const from = event.senderFrame?.url ?? ""
    if (!fromPage(from))
      throw new Error("Only Banda's page may change the sidebar.")
    const sidebar = lookNow()?.sidebar
    if (!sidebar) throw new Error("The sidebar's file is not known yet.")
    if (!sidebar.presets.some((preset) => preset.name === name))
      throw new Error(`There is no preset ${JSON.stringify(name)}.`)
    // The one writer (ADR 0016, decision 5).
    const refused = await settings.set(
      "sidebar.toml",
      "preset",
      JSON.stringify(name)
    )
    if (refused.length) throw new Error(refused.join("\n"))
  })
  ipcMain.handle("sidebar.edit", async (event) => {
    const from = event.senderFrame?.url ?? ""
    if (!fromPage(from))
      throw new Error("Only Banda's page may open the sidebar's file.")
    const sidebar = lookNow()?.sidebar
    if (!sidebar) throw new Error("The sidebar's file is not known yet.")
    ensure(sidebar.file)
    const failed = await shell.openPath(sidebar.file)
    if (failed) throw new Error(failed)
  })
  // The browser's (ADR 0013): only Banda's page asks.
  const fromBanda = (
    event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent
  ) => fromPage(event.senderFrame?.url ?? "")
  const browserAsks = (
    event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent
  ) => {
    if (!fromBanda(event))
      throw new Error("Only Banda's page may change the browser.")
  }
  /** Sets `key` in browser.toml, through the one writer (ADR 0016). */
  const setBrowser = async (key: string, value: string) => {
    const refused = await settings.set("browser.toml", key, value)
    if (refused.length) throw new Error(refused.join("\n"))
  }
  /** Pins the extension `id` to the row, or takes it off. */
  const pin = async (id: string, pinned: boolean) => {
    const others = (lookNow()?.browser.pinned ?? []).filter(
      (each) => each !== id
    )
    const list = pinned ? [...others, id] : others
    await setBrowser("pinned", JSON.stringify(list))
  }
  ipcMain.handle("browser.tabs", async (event, where: unknown) => {
    browserAsks(event)
    if (where !== "top" && where !== "left")
      throw new Error(`The tabs go "top" or "left", not ${String(where)}.`)
    await setBrowser("tabs", JSON.stringify(where))
  })
  ipcMain.handle("browser.pin", async (event, id: unknown, pinned: unknown) => {
    browserAsks(event)
    if (!extensions.has(id))
      throw new Error(`There is no extension ${String(id)}.`)
    await pin(id, pinned === true)
  })
  ipcMain.handle("browser.remove", async (event, id: unknown) => {
    browserAsks(event)
    // A removed extension's button leaves the row too.
    if (await extensions.remove(id)) await pin(id as string, false)
  })
  ipcMain.on("browser.reveal", (event, path: unknown) => {
    if (fromBanda(event)) reveal(path)
  })
  ipcMain.on("settings.open", (event, link: unknown) => {
    if (fromPage(event.senderFrame?.url ?? "")) openSettings(linkOf(link))
  })
  ipcMain.on("menu.open", (event, route: unknown) => {
    if (fromPage(event.senderFrame?.url ?? "")) openMenu(route)
  })
  ipcMain.on("settings.close", (event) => {
    if (fromPage(event.senderFrame?.url ?? "")) settingsWindow?.close()
  })
  pageOnly("settings.set", (file, key, value) => settings.set(file, key, value))
  pageOnly("settings.reset", (file, key) => settings.reset(file, key))
  pageOnly("settings.themes", () => settings.themes())
  pageOnly("settings.reveal", (file) => {
    const sidebar = lookNow()?.sidebar
    if (!sidebar) throw new Error("The config folder is not known yet.")
    return settings.reveal(sidebar.file, file)
  })
  ipcMain.on(
    "browser.popup",
    (event, extension: unknown, url: unknown, under: unknown) => {
      if (fromBanda(event)) extensions.popup(extension, url, under)
    }
  )
  ipcMain.on("browser.shown", (event, contents: unknown) => {
    if (fromBanda(event)) extensions.shown(contents)
  })
  ipcMain.on(
    "browser.created",
    (event, request: unknown, contents: unknown) => {
      if (fromBanda(event)) extensions.created(request, contents)
    }
  )
  ipcMain.on("notify:show", (event, notice: Notice) => {
    if (!fromPage(event.senderFrame?.url ?? "")) return
    desktop.show(notice, answered)
    // The workspace that holds the window lights up in the desktop's bar.
    if (window && !window.isFocused()) window.flashFrame(true)
  })
  ipcMain.on("notify:withdraw", (event, key: string) => {
    if (fromPage(event.senderFrame?.url ?? "")) desktop.withdraw(key)
  })
  ipcMain.handle("notify:quiet", (event) => {
    if (!fromPage(event.senderFrame?.url ?? "")) return false
    return desktop.quiet()
  })
  const first = await runtime.runPromise(Look.first(LOOK_WAIT))
  if (first) nativeTheme.themeSource = first.mode
  Menu.setApplicationMenu(process.platform === "darwin" ? macMenu() : null)
  window = openWindow(extensions)
  // `banda menu [route]` opens the Banda menu here, or the settings
  // window at a route of its own (ADR 0017).
  void runtime.runPromise(Engine.use((engine) => engine.door)).then((path) => {
    shutDoor = openDoor(path, { menu: openMenu })
  })
}

/** Shuts the door `banda menu` knocks at. */
let shutDoor: (() => void) | null = null

/** Opens the menu at `route`, or the settings at `settings.<section>.<row>`. */
function openMenu(route: unknown): string {
  if (typeof route !== "string") return "the route is not a string"
  const [first, ...rest] = route.trim().split(".")
  if (first === "settings") {
    openSettings(linkOf(rest.join("/")))
    return "ok"
  }
  const shown = inFront()
  if (!shown) return "no window"
  shown.webContents.send("menu:open", route)
  return "ok"
}

/** The Person clicked a notice: the window comes to the front, and the
 * page goes to what called. */
function answered(key: string) {
  inFront()?.webContents.send("notify:answer", key)
}

/** The window, brought to the front; none when it is closed. */
function inFront(): BrowserWindow | null {
  if (!window) return null
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
  return window
}

/** Serves the built page; nothing outside its folder. */
async function page(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const path = resolve(pageFolder, `.${decodeURIComponent(url.pathname)}`)
  const file = path === pageFolder ? join(pageFolder, "index.html") : path
  if (url.host !== "banda" || !file.startsWith(pageFolder + sep)) {
    return new Response("Not found", { status: 404 })
  }
  const found = await net.fetch(pathToFileURL(file).toString())
  const headers = new Headers(found.headers)
  headers.set("Content-Security-Policy", CSP)
  headers.set("X-Content-Type-Options", "nosniff")
  return new Response(found.body, { status: found.status, headers })
}

/** Answers `channel` for Banda's page alone. */
function pageOnly(channel: string, answer: (...args: unknown[]) => unknown) {
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    if (!fromPage(event.senderFrame?.url ?? ""))
      throw new Error(`Only Banda's page may ask for ${channel}.`)
    return answer(...args)
  })
}

function fromPage(url: string): boolean {
  if (DEV_PAGE) return url.startsWith(DEV_PAGE)
  return url === ORIGIN || url.startsWith(`${ORIGIN}/`)
}

function openWindow(extensions: Extensions): BrowserWindow {
  const opened = pageWindow({
    width: 1280,
    height: 820,
    minWidth: 640,
    minHeight: 420,
    title: "Banda",
  })
  hostPages(opened.webContents, extensions)
  void opened.loadURL(PAGE)
  opened.on("closed", () => {
    window = null
  })
  return opened
}

/** A section and a row, `agents/codex`; nothing else is a link. */
function linkOf(link: unknown): string {
  return typeof link === "string" && /^[a-z0-9./_-]*$/i.test(link) ? link : ""
}

/**
 * Opens the settings at `link`, or brings them forward there: one window,
 * the page at `#settings/<link>`. Hyprland tells it by its title.
 */
function openSettings(link: string) {
  if (settingsWindow) {
    if (settingsWindow.isMinimized()) settingsWindow.restore()
    settingsWindow.focus()
    if (link) settingsWindow.webContents.send("settings:go", link)
    return
  }
  const opened = pageWindow({
    width: 960,
    height: 680,
    minWidth: 560,
    minHeight: 400,
    title: "Banda Settings",
  })
  void opened.loadURL(`${PAGE}#settings/${link}`)
  opened.on("closed", () => {
    settingsWindow = null
  })
  settingsWindow = opened
}

/** A window that shows Banda's page, in the look's first colour. */
function pageWindow(
  size: Pick<
    BrowserWindowConstructorOptions,
    "width" | "height" | "minWidth" | "minHeight" | "title"
  >
): BrowserWindow {
  const current = lookNow()
  const opened = new BrowserWindow({
    ...size,
    show: false,
    backgroundColor:
      (current && firstFrame(current, nativeTheme.shouldUseDarkColors)) ??
      (nativeTheme.shouldUseDarkColors ? "#0a0a0a" : "#ffffff"),
    webPreferences: {
      preload: join(import.meta.dirname, "preload.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // Banda's sounds play before the Person first clicks (ADR 0009).
      autoplayPolicy: "no-user-gesture-required",
      // The browser's pages (browser.ts).
      webviewTag: true,
    },
  })
  opened.once("ready-to-show", () => opened.show())
  opened.on("focus", () => opened.flashFrame(false))
  const contents = opened.webContents
  // The page never leaves: links open in the browser, nothing navigates.
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: "deny" }
  })
  contents.on("will-navigate", (event) => {
    event.preventDefault()
    if (/^https?:\/\//.test(event.url)) void shell.openExternal(event.url)
  })
  if (!app.isPackaged) {
    contents.on("before-input-event", (event, input) => {
      if (input.type === "keyDown" && input.key === "F12") {
        contents.toggleDevTools()
        event.preventDefault()
      }
    })
  }
  return opened
}

function macMenu(): Menu {
  return Menu.buildFromTemplate([{ role: "appMenu" }, { role: "editMenu" }])
}

app.on("window-all-closed", () => app.quit())

let stopped = false
app.on("will-quit", (event) => {
  if (stopped) return
  event.preventDefault()
  shutDoor?.()
  void runtime.dispose().then(() => {
    stopped = true
    app.quit()
  })
})
