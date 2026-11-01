/**
 * The desktop window. It runs the engine as its child, serves the page
 * from `app://bandaso` and hands the page the engine's address. It also
 * runs `bandaso look --follow` and hands the page each look (ADR 0007);
 * nothing else crosses from Node to the page (docs/architecture.md,
 * "Processes").
 */
import { join, resolve, sep } from "node:path"
import { pathToFileURL } from "node:url"
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeTheme,
  net,
  protocol,
  session,
  shell,
} from "electron"
import { EngineProcess } from "./engine"
import { firstFrame, LookProcess } from "./look"

/** The page's origin; the engine lets it in (kernel/src/api.rs, APP_ORIGIN). */
const ORIGIN = "app://bandaso"
/**
 * In development, the Vite server's address; the page is served from it.
 * A packaged app ignores it: no other page ever gets the engine.
 */
const DEV_PAGE = app.isPackaged ? undefined : process.env.BANDASO_PAGE

const CSP = [
  "default-src 'self'",
  // Ghostty draws terminals from WebAssembly that ships with the page.
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
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
  process.env.BANDASO_ENGINE ??
  (app.isPackaged
    ? join(process.resourcesPath, "bandaso")
    : resolve(here, "../../target/debug/bandaso"))

// The window keeps its own state beside the engine's when that moves, so
// a test or a second setup never shares a profile with the first.
if (process.env.BANDASO_STATE) {
  app.setPath("userData", join(process.env.BANDASO_STATE, "window"))
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
])

const engine = new EngineProcess(engineBinary)
const look = new LookProcess(engineBinary)
let window: BrowserWindow | null = null

/** How long the window waits for its look, so it opens in its colours. */
const LOOK_WAIT = 300

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on("second-instance", () => {
    if (window?.isMinimized()) window.restore()
    window?.focus()
  })
  void app.whenReady().then(ready)
}

async function ready(): Promise<void> {
  engine.start()
  look.start()
  look.listen((now) => {
    // Native parts (scrollbars, menus) and the page's own
    // prefers-color-scheme follow the look's mode.
    nativeTheme.themeSource = now.mode
    const background = firstFrame(now, nativeTheme.shouldUseDarkColors)
    if (background) window?.setBackgroundColor(background)
    window?.webContents.send("look", now)
  })
  protocol.handle("app", page)
  // The page asks for nothing: no camera, no notifications, no location.
  session.defaultSession.setPermissionRequestHandler(
    (_contents, _permission, answer) => answer(false)
  )
  ipcMain.handle("engine", (event) => {
    const from = event.senderFrame?.url ?? ""
    if (!fromPage(from))
      throw new Error("Only Bandaso's page may ask for the engine.")
    return engine.address()
  })
  ipcMain.handle("look", (event) => {
    const from = event.senderFrame?.url ?? ""
    if (!fromPage(from))
      throw new Error("Only Bandaso's page may ask for the look.")
    return look.current()
  })
  const first = await look.first(LOOK_WAIT)
  if (first) nativeTheme.themeSource = first.mode
  Menu.setApplicationMenu(process.platform === "darwin" ? macMenu() : null)
  window = openWindow()
}

/** Serves the built page; nothing outside its folder. */
async function page(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const path = resolve(pageFolder, `.${decodeURIComponent(url.pathname)}`)
  const file = path === pageFolder ? join(pageFolder, "index.html") : path
  if (url.host !== "bandaso" || !file.startsWith(pageFolder + sep)) {
    return new Response("Not found", { status: 404 })
  }
  const found = await net.fetch(pathToFileURL(file).toString())
  const headers = new Headers(found.headers)
  headers.set("Content-Security-Policy", CSP)
  headers.set("X-Content-Type-Options", "nosniff")
  return new Response(found.body, { status: found.status, headers })
}

function fromPage(url: string): boolean {
  if (DEV_PAGE) return url.startsWith(DEV_PAGE)
  return url === ORIGIN || url.startsWith(`${ORIGIN}/`)
}

function openWindow(): BrowserWindow {
  const current = look.current()
  const opened = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 640,
    minHeight: 420,
    show: false,
    title: "Bandaso",
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
    },
  })
  opened.once("ready-to-show", () => opened.show())
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
  void opened.loadURL(DEV_PAGE ?? `${ORIGIN}/index.html`)
  opened.on("closed", () => {
    window = null
  })
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
  look.stop()
  void engine.stop().then(() => {
    stopped = true
    app.quit()
  })
})
