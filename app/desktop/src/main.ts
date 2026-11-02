/**
 * The desktop window. It runs the engine as its child, serves the page
 * from `app://banda` and hands the page the engine's address. It also
 * runs `banda look --follow` and hands the page each look (ADR 0007),
 * writes the preset the page picks into `sidebar.toml` (ADR 0008), and
 * opens the system's folder picker for "Add Space" (ADR 0026); nothing
 * else crosses from Node to the page (docs/architecture.md,
 * "Processes"). The modules' parts in main run here too, as the
 * browser's pages, kept apart from the page (modules.ts, ADR 0013, ADR
 * 0028). Settings are a Pane of the page; the desktop writes their files
 * (settings.ts, ADR 0016).
 */
import { join, resolve, sep } from "node:path"
import { pathToFileURL } from "node:url"
import {
  app,
  BrowserWindow,
  type BrowserWindowConstructorOptions,
  Menu,
  nativeTheme,
  net,
  protocol,
  session,
  shell,
} from "electron"
import { type Look as LookValue, WALLPAPER_URL } from "@banda/contract/look"
import { NodeServices } from "@effect/platform-node"
import { Effect, Layer, ManagedRuntime, Schema, Stream } from "effect"
import {
  Engine,
  Look,
  none,
  pickFolder,
  Refused,
  serve,
  Settings,
  tellPage,
  text,
  Window,
} from "@banda/desktop-kit"
import { BRIDGE } from "@banda/web/host"
import { openDoor } from "./door"
import { engineLayer } from "./engine"
import { firstFrame, firstLook, lookLayer } from "./look"
import { modules } from "./modules"
import { NoticeArg, Notices, RecordedDesktop } from "./notices"
import { settingsLayer } from "./settings"
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
  // An extension's button shows its icon from crx:// (the browser's
  // extensions, @banda/browser-desktop).
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

/**
 * Where the page's notices go: the desktop's notification server, or, for
 * the end-to-end tests, a list they read (`BANDA_DESKTOP=recorded`).
 */
const notices =
  process.env.BANDA_DESKTOP === "recorded"
    ? Notices.recorded(
        ((globalThis as { bandaDesktop?: RecordedDesktop }).bandaDesktop =
          new RecordedDesktop())
      )
    : Notices.system

/** Main's services (ADR 0020): the engine and the look as children, the
 * settings, the notices, and over them the modules' own, the browser's
 * (modules.ts). They start with the first effect run, and stop when it is
 * disposed. */
const runtime = ManagedRuntime.make(
  modules.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        engineLayer(engineBinary),
        lookLayer(engineBinary),
        settingsLayer(engineBinary),
        notices,
        Window.layer(() => window)
      )
    ),
    Layer.provide(NodeServices.layer)
  )
)
/** The last look, for what reads it at once; none before the first.
 * The window opens once the runtime is built (`ready`). */
const lookNow = () => runtime.runSync(Look.use((look) => look.current))
let window: BrowserWindow | null = null
/** The window that lets the desktop through, if one does (ADR 0023). */
let clear: BrowserWindow | null = null

/** How long the window waits for its look, so it opens in its colours. */
const LOOK_WAIT = 300

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on("second-instance", () => inFront())
  void app.whenReady().then(ready)
}

async function ready(): Promise<void> {
  const listen = (now: LookValue) => {
    // Native parts (scrollbars, menus) and the page's own
    // prefers-color-scheme follow the look's mode.
    nativeTheme.themeSource = now.mode
    const background = firstFrame(now, nativeTheme.shouldUseDarkColors)
    if (!window) return
    if (background && window !== clear) window.setBackgroundColor(background)
    tellPage(window.webContents, BRIDGE.look.listen, lookIn(window, now))
  }
  runtime.runFork(
    Look.use((look) =>
      look.changes.pipe(
        Stream.runForEach((now) => Effect.sync(() => listen(now)))
      )
    )
  )
  protocol.handle("app", (request) =>
    request.url.split("?")[0] === WALLPAPER_URL ? wallpaper() : page(request)
  )
  // The page asks for nothing but to write to the clipboard, as "Copy
  // path" and a terminal's copy do: no camera, no notifications, no
  // location, no reading the clipboard. Its system notifications go through the desktop
  // (notices.ts).
  session.defaultSession.setPermissionRequestHandler(
    (_contents, permission, answer) =>
      answer(permission === "clipboard-sanitized-write")
  )
  const write = (file: string, key: string, value: unknown) =>
    Settings.use((settings) => settings.write(file, key, value))

  serve(runtime, fromPage, BRIDGE, {
    engine: [none, () => Engine.use((engine) => engine.address)],
    look: {
      current: [
        none,
        (_, event) =>
          Effect.map(
            Look.use((look) => look.current),
            (now) =>
              now
                ? lookIn(BrowserWindow.fromWebContents(event.sender), now)
                : now
          ),
      ],
    },
    sidebar: {
      preset: [
        text,
        ([name]) =>
          Effect.gen(function* () {
            const sidebar = yield* Look.part("sidebar", "The sidebar's file")
            if (!sidebar.presets.some((preset) => preset.name === name))
              return yield* new Refused({
                message: `There is no preset ${JSON.stringify(name)}.`,
              })
            yield* write("sidebar.toml", "preset", name)
          }),
      ],
      edit: [
        none,
        () =>
          Effect.gen(function* () {
            const sidebar = yield* Look.part("sidebar", "The sidebar's file")
            ensure(sidebar.file)
            const failed = yield* Effect.promise(() =>
              shell.openPath(sidebar.file)
            )
            if (failed) return yield* new Refused({ message: failed })
          }),
      ],
    },
    // The modules' own: the browser's (ADR 0013).
    ...modules.answers,
    // The settings' (ADR 0016) and the Banda menu's (ADR 0017).
    settings: {
      set: [
        Schema.Tuple([Schema.String, Schema.String, Schema.String]),
        ([file, key, value]) =>
          Settings.use((settings) => settings.set(file, key, value)),
      ],
      reset: [
        Schema.Tuple([Schema.String, Schema.String]),
        ([file, key]) => Settings.use((settings) => settings.reset(file, key)),
      ],
      rename: [
        Schema.Tuple([Schema.String, Schema.String, Schema.String]),
        ([file, key, to]) =>
          Settings.use((settings) => settings.rename(file, key, to)),
      ],
      reveal: [
        text,
        ([file]) =>
          Effect.flatMap(Look.part("config", "The config folder"), (config) =>
            Settings.use((settings) => settings.reveal(config, file))
          ),
      ],
      themes: [none, () => Settings.use((settings) => settings.themes)],
    },
    menu: {
      open: [text, ([route]) => Effect.sync(() => openMenu(route))],
    },
    // Calls (ADR 0011).
    notify: {
      show: [
        Schema.Tuple([NoticeArg]),
        ([notice]) =>
          Effect.andThen(
            Notices.use((notices) => notices.show(notice, answered)),
            // The workspace that holds the window lights up in the
            // desktop's bar.
            Effect.sync(() => {
              if (window && !window.isFocused()) window.flashFrame(true)
            })
          ),
      ],
      withdraw: [
        text,
        ([key]) => Notices.use((notices) => notices.withdraw(key)),
      ],
      quiet: [none, () => Notices.use((notices) => notices.quiet)],
    },
    // "Add Space"'s folder picker (ADR 0026).
    folder: {
      pick: [
        Schema.Tuple([Schema.NullOr(Schema.String)]),
        ([at], event) =>
          pickFolder(BrowserWindow.fromWebContents(event.sender), at),
      ],
    },
  })
  const first = await runtime.runPromise(firstLook(LOOK_WAIT))
  if (first) nativeTheme.themeSource = first.mode
  Menu.setApplicationMenu(process.platform === "darwin" ? macMenu() : null)
  window = openWindow()
  // `banda menu [route]` opens the Banda menu here, or the settings at a
  // route of their own (ADR 0017): the page tells them apart.
  void runtime.runPromise(Engine.use((engine) => engine.door)).then((path) => {
    shutDoor = openDoor(path, { menu: openMenu })
  })
}

/** Shuts the door `banda menu` knocks at. */
let shutDoor: (() => void) | null = null

/** Opens the menu at `route` in the window, brought to the front; the
 * page tells the routes apart, the settings' too. */
function openMenu(route: unknown): string {
  if (typeof route !== "string") return "the route is not a string"
  const shown = inFront()
  if (!shown) return "no window"
  tellPage(shown.webContents, BRIDGE.menu.listen, route)
  return "ok"
}

/** The Person clicked a notice: the window comes to the front, and the
 * page goes to what called. */
function answered(key: string) {
  tellPage(inFront()?.webContents, BRIDGE.notify.listen, key)
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
  return served(file, { "Content-Security-Policy": CSP })
}

/**
 * The picture Banda's glass is made of: the look's wallpaper, and no other
 * file, whatever the address asks (ADR 0023).
 */
async function wallpaper(): Promise<Response> {
  const file = lookNow()?.desk.wallpaper
  if (!file) return new Response("Not found", { status: 404 })
  return served(file)
}

/** A file of the machine's, as a page may take it: never sniffed. */
async function served(
  file: string,
  more: Record<string, string> = {}
): Promise<Response> {
  const found = await net.fetch(pathToFileURL(file).toString())
  const headers = new Headers(found.headers)
  headers.set("X-Content-Type-Options", "nosniff")
  for (const [name, value] of Object.entries(more)) headers.set(name, value)
  return new Response(found.body, { status: found.status, headers })
}

/** The system makes the glass: the window lets the desktop through. */
function systemGlass(now: LookValue | null): boolean {
  return now?.desk.glass === true && now.desk.material === "system"
}

/** The look as `shown` can show it. The system's glass shows only where
 * the window lets the desktop through, so a solid window's page paints
 * itself; Banda's own glass shows in every window (ADR 0023). */
function lookIn(shown: BrowserWindow | null, now: LookValue): LookValue {
  return systemGlass(now) && shown !== clear
    ? { ...now, desk: { ...now.desk, glass: false } }
    : now
}

function fromPage(url: string): boolean {
  if (DEV_PAGE) return url.startsWith(DEV_PAGE)
  return url === ORIGIN || url.startsWith(`${ORIGIN}/`)
}

function openWindow(): BrowserWindow {
  const opened = pageWindow(
    {
      width: 1280,
      height: 820,
      minWidth: 640,
      minHeight: 420,
      title: "Banda",
    },
    // The system's glass lets the desktop through (ADR 0023). Electron
    // sets this once, so turning it on shows from the next start.
    systemGlass(lookNow())
  )
  runtime.runSync(modules.opened(opened.webContents))
  void opened.loadURL(PAGE)
  opened.on("closed", () => {
    window = null
    if (clear === opened) clear = null
  })
  return opened
}

/** A window that shows Banda's page, in the look's first colour. */
function pageWindow(
  size: Pick<
    BrowserWindowConstructorOptions,
    "width" | "height" | "minWidth" | "minHeight" | "title"
  >,
  glass = false
): BrowserWindow {
  const current = lookNow()
  const opened = new BrowserWindow({
    ...size,
    show: false,
    transparent: glass,
    backgroundColor: glass
      ? "#00000000"
      : ((current && firstFrame(current, nativeTheme.shouldUseDarkColors)) ??
        (nativeTheme.shouldUseDarkColors ? "#0a0a0a" : "#ffffff")),
    webPreferences: {
      preload: join(import.meta.dirname, "preload.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // Banda's sounds play before the Person first clicks (ADR 0009).
      autoplayPolicy: "no-user-gesture-required",
      // The browser's pages (@banda/browser-desktop).
      webviewTag: true,
    },
  })
  if (glass) clear = opened
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
