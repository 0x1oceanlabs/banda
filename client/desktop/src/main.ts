/**
 * The desktop window. It reaches the engine, the session's service on
 * Linux, which it starts when it does not run, or else its child
 * (engine.ts, ADR 0086), serves the page from `app://banda` and hands the
 * page the engine's address. Closing it is not quitting Banda: the engine
 * and its Agents go on, and Quit Banda stops them; on macOS, where the
 * engine is still the app's child, closing it hides it (closing.ts). It also
 * runs `banda look --follow` and hands the page each look (ADR 0007),
 * writes the preset the page picks into `sidebar.toml` (ADR 0008), and
 * opens the system's folder picker for "Add Project" (ADR 0026), and a
 * Pane in a window of its own, the same page at `#pane/<id>` (ADR 0025,
 * decision 9); nothing else crosses from Node to the page (docs/architecture.md,
 * "Processes"). The modules' parts in main run here too, as the
 * browser's pages, kept apart from the page (modules.ts, ADR 0013, ADR
 * 0028). Settings are a Pane of the page; the desktop writes their files
 * (settings.ts, ADR 0016). It updates Banda itself (update.ts, ADR 0041).
 */
import { existsSync } from "node:fs"
import { userInfo } from "node:os"
import { join, resolve, sep } from "node:path"
import { pathToFileURL } from "node:url"
import {
  app,
  BrowserWindow,
  type BrowserWindowConstructorOptions,
  Menu,
  nativeTheme,
  net,
  powerMonitor,
  protocol,
  session,
  shell,
  systemPreferences,
  type WebContents,
} from "electron"
import { type Look as LookValue, WALLPAPER_URL } from "@banda/contract/look"
import { NodeServices } from "@effect/platform-node"
import { Effect, Layer, ManagedRuntime, Schema, Stream } from "effect"
import {
  confirm,
  Engine,
  FileHost,
  PreviewHost,
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
import {
  BRIDGE,
  type PoppedAsk as PoppedAskValue,
  poppedOf,
  poppedRoute,
} from "@banda/web/host"
import { openDoor } from "./door"
import { engineLayer, Stop } from "./engine"
import { loginPath } from "./login"
import { firstFrame, firstLook, lookLayer } from "./look"
import { modules } from "./modules"
import { channel, dataFolder, stateFolder } from "./channel"
import {
  asksOnQuit,
  type Closing,
  hidesOnClose,
  onDock,
  quitAsking,
} from "./closing"
import { listApp, listShortcut } from "./entry"
import { startLog, watchProblems } from "./problems"
import { Editors } from "./editors"
import { dragOut, exists, openFile, showFile } from "./outside"
import { roadLayer } from "./road"
import { settingsLayer } from "./settings"
import { updates } from "./update"
import { ensure } from "./sidebar"
import { NODE_FOLDER, PROGRAM, Program, whereOf } from "./program"

/** What a Pane in its own window asks of the window (`PoppedAsk`). */
const PoppedAsk = Schema.Union([
  Schema.Struct({
    open: Schema.Struct({
      project: Schema.String,
      pane: Schema.Struct({
        kind: Schema.String,
        args: Schema.Record(Schema.String, Schema.MutableJson),
      }),
      from: Schema.String,
      place: Schema.optional(Schema.Literals(["right", "below", "instead"])),
    }),
  }),
  Schema.Struct({
    run: Schema.Struct({
      action: Schema.String,
      args: Schema.optional(Schema.Record(Schema.String, Schema.MutableJson)),
    }),
  }),
]) satisfies Schema.Decoder<PoppedAskValue>

/** The page's origin; the engine lets it in (kernel/src/api.rs, APP_ORIGIN). */
const ORIGIN = "app://banda"
/**
 * In development, the Vite server's address; the page is served from it.
 * A packaged app ignores it: no other page ever gets the engine.
 */
const DEV_PAGE = app.isPackaged ? undefined : process.env.BANDA_PAGE
/** Where the windows load the page from. */
const PAGE = DEV_PAGE ?? `${ORIGIN}/index.html`

/** The hosts of `app://` beside Banda's own page: the files a Pane shows,
 * and the pages among them that run scripts, sandboxed (ADR 0073,
 * decision 5); and the modules' own. */
const hosts = new Map(
  Object.entries({
    ...modules.served,
    files: (request: Request) => FileHost.use((host) => host.serve(request)),
    preview: (request: Request) =>
      PreviewHost.use((host) => host.serve(request)),
  })
)
/** The hosts a frame shows: the modules' and the sandbox host. The byte
 * host serves any file, so no frame shows one. */
const framed = [...Object.keys(modules.served), "preview"].map(
  (host) => `app://${host}`
)

const CSP = [
  "default-src 'self'",
  // Ghostty draws terminals from WebAssembly that ships with the page.
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  // An extension's button shows its icon from crx:// (the browser's
  // extensions, @banda/browser-desktop).
  "img-src 'self' data: crx: app://files",
  "media-src 'self' app://files",
  "font-src 'self' data:",
  // The engine; the page's own files, as Ghostty fetches its WebAssembly;
  // and the byte host's ranges, as a PDF is read (ADR 0073, decision 5).
  "connect-src 'self' ws://127.0.0.1:* app://files",
  // The modules' pages a Pane shows in a frame, each on an origin of its
  // own, as a Thread's Visuals (ADR 0037), and a file's page, sandboxed.
  `frame-src ${framed.join(" ")}`,
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ")

// An Agent's pass for `banda`, which a window started in an Agent's shell
// carries (ADR 0019), goes no further: the window's engine is its own, and
// what it starts is its owner's.
delete process.env.BANDA_TOKEN
delete process.env.BANDA_ENGINE

const here = app.getAppPath()
const pageFolder = resolve(here, "../web/dist")
// Whether the app carries a Node of its own for the ACP adapters, as
// Windows' does (ADR 0090, decision 5): the engine finds it beside its
// program, and its copies carry it (program.ts).
const ownNode =
  app.isPackaged && existsSync(join(process.resourcesPath, NODE_FOLDER))
// The window's `banda` (program.ts).
const where = whereOf({
  named: process.env.BANDA_PROGRAM,
  checkout: resolve(here, "../../target/debug", PROGRAM),
  resources: app.isPackaged ? process.resourcesPath : undefined,
  data: dataFolder(app.getPath("appData")),
  // The copy names this Electron for an engine started with no window,
  // when it stays where it is and the app carries no Node: an AppImage's
  // goes as it stops.
  electron: process.env.APPIMAGE || ownNode ? undefined : process.execPath,
})
// The Node the app provides for the ACP adapters it carries: its own,
// or else this Electron, which the engine it starts runs as Node (ADR
// 0059). The engine finds the adapters itself, beside its program or in
// its checkout; with no Node named, as for a `banda serve` started in a
// shell, it finds one of its own (the harnesses' `carried.rs`).
const node: Record<string, string> = ownNode
  ? {}
  : { BANDA_NODE: process.execPath }

// The window keeps its profile in the engine's state folder, so Banda,
// Banda Dev, a checkout and a test never share one (ADR 0033).
const state = stateFolder(app.getPath("appData"))
app.setPath("userData", join(state, "window"))
// The window's log and crash dumps, beside the engine's (ADR 0039).
const banda = (contents: WebContents) => fromPage(contents.getURL())
startLog(state, banda)
// The name the desktop's notices and the Web Store show, and the
// window's class (Wayland's app ID), which window rules match.
app.setName(channel.name)
app.setDesktopName(`${channel.folder}.desktop`)
// Windows shows the notices of an app ID that a Start menu shortcut
// carries, and none before it is set (ADR 0090, decision 7; entry.ts).
if (process.platform === "win32") app.setAppUserModelId(channel.appId)

// The page reads the byte host's ranges across origins, as its CORS
// allows (`corsEnabled`).
protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
])

/** Set as an update restarts Banda: the engine it stops leaves the quit
 * to the update. */
let updating = false
/** Set once Banda quits: closing the window hides nothing then, and a
 * quit goes through (closing.ts). */
let quitting = false
/** Set for a while as macOS logs out, restarts or shuts down. */
let poweringOff = false
/** How long a logout, restart or shutdown lets a quit through unasked:
 * macOS's quit comes moments after it says so, and a logout another app
 * stops leaves Quit Banda asking again. */
const POWERING_OFF = 60_000

/** Where the app is, for what closing and quitting do. An update's
 * restart counts as quitting: one that closes the windows before it
 * quits, as `quitAndInstall` does, would otherwise only hide the window
 * on macOS, and never install. */
const closingNow = (): Closing => ({
  platform: process.platform,
  quitting: quitting || updating,
  poweringOff,
})

/** Quits Banda, asking nothing. */
function leave(): void {
  quitting = true
  app.quit()
}

/** Main's services (ADR 0020): the engine and the look as children, the
 * settings, all three on the window's `banda` (program.ts), the byte
 * host, over them the modules' own, the browser's and the notifications'
 * (modules.ts), and the road that answers what the modules' engine parts
 * ask (road.ts). They start with the first effect run, and stop when it
 * is disposed. */
const runtime = ManagedRuntime.make(
  roadLayer(modules.asked).pipe(
    Layer.provideMerge(modules.layer),
    Layer.provideMerge(
      Layer.mergeAll(
        engineLayer(
          loginPath({
            platform: process.platform,
            shell: process.env.SHELL ?? userInfo().shell ?? undefined,
            own: process.env.PATH,
            term: process.env.TERM,
          }),
          node,
          // The engine stopped as asked, by Quit Banda here or `banda
          // stop`: the window goes with it, unless an update restarts it.
          () => {
            if (!updating) leave()
          }
        ),
        Stop.layer,
        lookLayer,
        // The settings open their files with `Editors.edit`.
        settingsLayer.pipe(Layer.provideMerge(Editors.layer)),
        Window.layer(() => window),
        FileHost.layer,
        PreviewHost.layer
      )
    ),
    // A packed Banda that cannot run a copy of its own says why.
    Layer.provide(
      Program.layer(where, (why) =>
        keepProblem({
          source: "main",
          kind: "Uncopied",
          message: `The engine runs from inside the app, not a copy of its own: ${why}`,
          frames: [],
        })
      )
    ),
    Layer.provide(NodeServices.layer)
  )
)
// What breaks in main, or crashes, is kept as the page's is (ADR 0039).
const keepProblem = watchProblems(
  (record) =>
    runtime
      .runPromise(Engine.use((engine) => engine.client))
      .then((client) => client.command("problems.record", record)),
  banda
)
/** The last look, for what reads it at once; none before the first.
 * The window opens once the runtime is built (`ready`). */
const lookNow = () => runtime.runSync(Look.use((look) => look.current))
let window: BrowserWindow | null = null
/** The window that lets the desktop through, if one does (ADR 0023). */
let clear: BrowserWindow | null = null
/** The Panes in windows of their own, by their IDs (ADR 0025, decision 9). */
const popped = new Map<string, BrowserWindow>()
/** Set while the window, closed in full screen on macOS, leaves it to
 * hide; showing it again meanwhile keeps it shown. */
let hiding = false

/** How long the window waits for its look, so it opens in its colours. */
const LOOK_WAIT = 300

if (process.env.APPIMAGE_EXIT_AFTER_INSTALL === "true") {
  // electron-updater runs the AppImage it moved in once. It has the old
  // one's APPIMAGE, so the old Banda lists the new file (update.ts), and
  // nothing starts here (ADR 0041, decision 3).
  app.exit(0)
} else if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on("second-instance", () => inFront())
  listApp()
  void app.whenReady().then(ready)
}

async function ready(): Promise<void> {
  listShortcut()
  followAccent()
  const listen = (now: LookValue) => {
    // Native parts (scrollbars, menus) and the page's own
    // prefers-color-scheme follow the look's mode.
    nativeTheme.themeSource = now.mode
    const background = firstFrame(now, nativeTheme.shouldUseDarkColors)
    // The main window's material follows the look where it can; a Pane's
    // own window is solid.
    const glass = systemGlass(now)
    const set = SYSTEM_MATERIAL?.set
    if (window && OWN_FRAME) window.setWindowButtonPosition(buttonsAt(now))
    if (window && set && glass !== (window === clear)) {
      clear = glass ? window : null
      set(window, glass)
      if (glass) window.setBackgroundColor(CLEAR)
    }
    for (const shown of [window, ...popped.values()]) {
      if (!shown) continue
      if (background && shown !== clear) shown.setBackgroundColor(background)
      tellPage(shown.webContents, BRIDGE.look.listen, lookIn(shown, now))
    }
  }
  runtime.runFork(
    Look.use((look) =>
      look.changes.pipe(
        Stream.runForEach((now) => Effect.sync(() => listen(now)))
      )
    )
  )
  protocol.handle("app", (request) => {
    const served = hosts.get(new URL(request.url).host)
    if (served) return runtime.runPromise(served(request))
    return request.url.split("?")[0] === WALLPAPER_URL
      ? wallpaper(request.url)
      : page(request)
  })
  // The page asks for nothing but to write to the clipboard, as "Copy
  // path" and a terminal's copy do: no camera, no notifications, no
  // location, no reading the clipboard. Its system notifications go through the desktop
  // (the notifications module, `@banda/notifications-desktop`).
  session.defaultSession.setPermissionRequestHandler(
    (_contents, permission, answer) =>
      answer(permission === "clipboard-sanitized-write")
  )
  const write = (file: string, key: string, value: unknown) =>
    Settings.use((settings) => settings.write(file, key, value))

  const update = updates(
    (now) => tellPage(window?.webContents, BRIDGE.update.listen, now),
    // The engine restarts with the window, from the new version's copy,
    // until the engine updates by itself (ADR 0086, plan step 6): the
    // restart comes once no Thread works, or as the Person says.
    () => {
      updating = true
      return runtime.runPromise(Stop.use((stop) => stop.engine))
    }
  )
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
    frame: {
      current: [
        none,
        (_, event) =>
          Effect.sync(() =>
            insetOf(BrowserWindow.fromWebContents(event.sender))
          ),
      ],
    },
    accent: { current: [none, () => Effect.sync(accentOf)] },
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
            yield* Editors.use((editors) => editors.edit(sidebar.file))
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
    files: {
      url: [
        Schema.Tuple([Schema.String, Schema.String]),
        ([project, path]) => FileHost.url(project, path),
      ],
      preview: [
        Schema.Tuple([Schema.String, Schema.String]),
        ([project, path]) => PreviewHost.url(project, path),
      ],
      outside: [text, ([path]) => openFile(path)],
      show: [text, ([path]) => Effect.sync(() => showFile(path))],
      exists: [text, ([path]) => Effect.sync(() => exists(path))],
      editors: [
        none,
        () =>
          Editors.use((editors) => editors.list).pipe(
            Effect.map((found) => found.map(({ id, name }) => ({ id, name })))
          ),
      ],
      openIn: [
        Schema.Tuple([
          Schema.String,
          Schema.String,
          Schema.NullOr(Schema.Number),
          Schema.NullOr(Schema.Number),
        ]),
        ([editor, path, line, column]) =>
          Editors.use((editors) => editors.open(editor, path, line, column)),
      ],
      drag: [
        Schema.Tuple([Schema.Array(Schema.String)]),
        ([paths], event) => Effect.promise(() => dragOut(event.sender, paths)),
      ],
    },
    edit: {
      paste: [none, (_, event) => Effect.sync(() => event.sender.paste())],
      pastePlain: [
        none,
        (_, event) => Effect.sync(() => event.sender.pasteAndMatchStyle()),
      ],
      copyImageAt: [
        Schema.Tuple([Schema.Number, Schema.Number]),
        ([x, y], event) =>
          Effect.sync(() =>
            event.sender.copyImageAt(Math.round(x), Math.round(y))
          ),
      ],
    },
    problems: {
      logs: [
        none,
        () =>
          Effect.asVoid(
            Effect.promise(() => shell.openPath(join(state, "logs")))
          ),
      ],
      reopen: [none, (_, event) => Effect.sync(() => event.sender.reload())],
    },
    menu: {
      open: [text, ([route]) => Effect.sync(() => openMenu(route))],
    },
    // Quit Banda (ADR 0086, decision 3): the page asked first when Agents
    // are working.
    quit: [none, () => quitBanda],
    // Banda's own update (ADR 0041).
    update: {
      current: [none, () => Effect.sync(update.current)],
      check: [none, () => Effect.sync(update.check)],
      restart: [none, () => Effect.sync(update.restart)],
      now: [none, () => Effect.sync(update.now)],
      later: [none, () => Effect.sync(update.later)],
      wait: [none, () => Effect.sync(update.wait)],
      seen: [none, () => Effect.sync(update.seen)],
    },
    // Panes in windows of their own (ADR 0025, decision 9): the window
    // pops them out; what they ask goes to it.
    popped: {
      open: [
        Schema.Tuple([Schema.String, Schema.Number, Schema.Number]),
        ([pane, width, height], event) =>
          Effect.sync(() => {
            if (event.sender === window?.webContents)
              popOut(pane, width, height)
          }),
      ],
      close: [text, ([pane]) => Effect.sync(() => popped.get(pane)?.close())],
      current: [none, () => Effect.succeed([...popped.keys()])],
      ask: [
        Schema.Tuple([PoppedAsk]),
        ([asked], event) =>
          Effect.sync(() => {
            const from = BrowserWindow.fromWebContents(event.sender)
            if (!from || ![...popped.values()].includes(from)) return
            tellPage(inFront()?.webContents, BRIDGE.popped.asked, asked)
          }),
      ],
    },
    // "Add Project"'s folder picker (ADR 0026).
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
  // The Dock's icon shows the window again, hidden as it closed on macOS
  // (closing.ts).
  app.on("activate", () => {
    const does = onDock(closingNow(), window !== null)
    if (does === "show") inFront()
    else if (does === "open") window = openWindow()
  })
  // macOS says it logs out, restarts or shuts down before it asks Banda
  // to quit (Electron's `shutdown`, on NSWorkspaceWillPowerOffNotification):
  // that quit goes through unasked, as nobody may be there to answer and
  // macOS would give up waiting, and the engine, the app's child, stops
  // with it. Only there: on Linux the event holds the session's shutdown
  // for Banda (a logind delay lock).
  if (process.platform === "darwin")
    powerMonitor.on("shutdown", () => {
      poweringOff = true
      setTimeout(() => {
        poweringOff = false
      }, POWERING_OFF)
    })
  // `banda menu [route]` opens the Banda menu here, or the settings at a
  // route of their own (ADR 0017): the page tells them apart.
  void runtime.runPromise(Engine.use((engine) => engine.door)).then((path) => {
    shutDoor = openDoor(path, { menu: openMenu })
  })
}

/** Shuts the door `banda menu` knocks at. */
let shutDoor: (() => void) | null = null

/**
 * Quit Banda (ADR 0086, decision 3): the engine stops (engine.ts), which
 * stops its Agents, Harnesses and Terminals, and the window quits once it
 * has gone. Its follower hears the engine stop as asked and quits the
 * window too; one that cannot be stopped in time still leaves the window
 * to quit.
 */
const quitBanda = Effect.sync(() => {
  quitting = true
}).pipe(
  Effect.andThen(Stop.use((stop) => stop.engine)),
  Effect.ensuring(Effect.sync(leave))
)

/**
 * Quit Banda as macOS's Quit runs it (closing.ts): `banda stop` with no
 * terminal to ask in stops the engine where no Agent works, and Banda
 * quits. Where some do, the window comes to the front and its page's Quit
 * Banda asks first, as on Ctrl+Q, told on the channel that runs what a
 * Pane in its own window asks; a page that crashed or loads, or a quit
 * that comes again soon after, asks in a system dialog instead.
 */
const askToQuit = quitAsking({
  working: Stop.use((stop) => stop.unlessWorking),
  pageCan: Effect.sync(() => {
    const contents = window?.webContents
    return !!contents && !contents.isCrashed() && !contents.isLoadingMainFrame()
  }),
  askPage: Effect.sync(() =>
    tellPage(inFront()?.webContents, BRIDGE.popped.asked, {
      run: { action: "banda.quit" },
    })
  ),
  askSystem: Effect.suspend(() =>
    confirm(inFront(), {
      message: "Quit Banda?",
      detail: "Quitting stops every Agent at work.",
      yes: "Stop and quit",
      no: "Cancel",
    })
  ),
  quitBanda,
  leave: Effect.sync(leave),
})

/** Opens the menu at `route` in the window, brought to the front; the
 * page tells the routes apart, the settings' too. */
function openMenu(route: unknown): string {
  if (typeof route !== "string") return "the route is not a string"
  const shown = inFront()
  if (!shown) return "no window"
  tellPage(shown.webContents, BRIDGE.menu.listen, route)
  return "ok"
}

/** The window, or `shown`, brought to the front; none when it is closed. */
function inFront(shown = window): BrowserWindow | null {
  if (!shown) return null
  if (shown === window) hiding = false
  if (shown.isMinimized()) shown.restore()
  shown.show()
  shown.focus()
  return shown
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
 * The picture Banda's glass is made of: the look's wallpaper, or its dark
 * one when the address asks for it, and no other file, whatever the
 * address asks (ADR 0023, ADR 0030).
 */
async function wallpaper(address: string): Promise<Response> {
  const desk = lookNow()?.desk
  const asked = new URL(address).searchParams.get("of")
  const pictures = [desk?.wallpaper, desk?.wallpaper_dark].flatMap((one) =>
    one ? [one.path] : []
  )
  const file = pictures.find((path) => path === asked) ?? pictures[0]
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

/**
 * How a window lets the system's material through (ADR 0030): vibrancy
 * under the whole window on macOS, acrylic on Windows 11 from 22H2 (build
 * 22621), and on Linux a transparent window for the compositor to blur.
 * Windows 10 has no material: `null`, and the desk is solid there.
 * `made` is what the window is made with; `set` changes it while the
 * window shows, so the glass follows the look, even one that comes after
 * the window opened, as on a Mac's first start. Linux's transparent window
 * is made once: turning it on shows from the next start.
 */
const SYSTEM_MATERIAL: {
  made: BrowserWindowConstructorOptions
  set?: (shown: BrowserWindow, on: boolean) => void
} | null =
  process.platform === "darwin"
    ? {
        made: { vibrancy: "under-window" },
        set: (shown, on) => shown.setVibrancy(on ? "under-window" : null),
      }
    : process.platform !== "win32"
      ? { made: { transparent: true } }
      : Number(process.getSystemVersion().split(".")[2]) >= 22621
        ? {
            made: { backgroundMaterial: "acrylic" },
            set: (shown, on) =>
              shown.setBackgroundMaterial(on ? "acrylic" : "none"),
          }
        : null

/** The background of a window that lets the system's material through. */
const CLEAR = "#00000000"

/**
 * On macOS the window draws its own title bar (ADR 0030): the system's is
 * hidden, and its window buttons sit at the start of Banda's bar, in the
 * middle of its height, `INSET` px with the room around them.
 */
const OWN_FRAME = process.platform === "darwin"
const BUTTONS = { x: 12, width: 54, height: 14 }
const INSET = 2 * BUTTONS.x + BUTTONS.width
/** Banda's bar's height before the first look comes (platform/look/src/lib.rs). */
const BAR_HEIGHT = 36

/** Where the window buttons sit, for a bar as high as the look says. */
function buttonsAt(now: LookValue | null): { x: number; y: number } {
  const bar = Number.parseFloat(now?.vars["--bar-height"] ?? "") || BAR_HEIGHT
  return { x: BUTTONS.x, y: Math.round((bar - BUTTONS.height) / 2) }
}

/** The room the window buttons take at the bar's start (`frame`):
 * none in full screen, and `null` where the system draws the frame, as it
 * does for a Pane's own window. */
function insetOf(shown: BrowserWindow | null): number | null {
  if (!OWN_FRAME || !shown || shown !== window) return null
  return shown.isFullScreen() ? 0 : INSET
}

/** The accent set in the system's settings, as `#rrggbb` (ADR 0075,
 * decision 6): macOS's and Windows' only. */
function accentOf(): string | null {
  if (process.platform !== "darwin" && process.platform !== "win32") return null
  const rgba = systemPreferences.getAccentColor()
  return /^[0-9a-f]{6}/i.test(rgba)
    ? `#${rgba.slice(0, 6).toLowerCase()}`
    : null
}

/** Tells every window the accent when the Person changes it. */
function followAccent(): void {
  const tell = () => {
    const accent = accentOf()
    for (const shown of [window, ...popped.values()])
      tellPage(shown?.webContents, BRIDGE.accent.listen, accent)
  }
  if (process.platform === "darwin")
    systemPreferences.subscribeNotification(
      "AppleColorPreferencesChangedNotification",
      tell
    )
  else if (process.platform === "win32")
    systemPreferences.on("accent-color-changed", tell)
}

/** The look asks for the system's glass. */
function systemGlass(now: LookValue | null): boolean {
  return now?.desk.glass === true && now.desk.material === "system"
}

/** The look as `shown` can show it. The system's glass shows only where
 * the window lets the desktop through, so a solid window's page paints
 * itself; Banda's own glass shows in every window (ADR 0023). */
function lookIn(shown: BrowserWindow | null, now: LookValue): LookValue {
  return systemGlass(now) && (SYSTEM_MATERIAL === null || shown !== clear)
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
      ...(OWN_FRAME && {
        titleBarStyle: "hidden",
        trafficLightPosition: buttonsAt(lookNow()),
      }),
    },
    // The system's glass lets its material through (ADR 0023, ADR 0030).
    SYSTEM_MATERIAL !== null && systemGlass(lookNow())
  )
  if (OWN_FRAME) {
    // In full screen the system hides the window buttons: the bar takes
    // back their room.
    const tellFrame = () =>
      tellPage(opened.webContents, BRIDGE.frame.listen, insetOf(opened))
    opened.on("enter-full-screen", tellFrame)
    opened.on("leave-full-screen", tellFrame)
  }
  void opened.loadURL(PAGE)
  // On macOS it hides as it closes, unless Banda quits (closing.ts). Its
  // Panes in windows of their own close, back to their places, as they do
  // when it closes.
  opened.on("close", (event) => {
    if (!hidesOnClose(closingNow())) return
    event.preventDefault()
    for (const one of popped.values()) one.close()
    if (!opened.isFullScreen()) {
      opened.hide()
      return
    }
    // A window hidden in full screen would leave its Space black: it
    // leaves full screen first, and comes back windowed.
    hiding = true
    opened.once("leave-full-screen", () => {
      if (hiding) opened.hide()
      hiding = false
    })
    opened.setFullScreen(false)
  })
  opened.on("closed", () => {
    window = null
    if (clear === opened) clear = null
    // Their Panes are the window's: they go with it.
    for (const one of popped.values()) one.close()
  })
  return opened
}

/**
 * Opens Pane `pane` in a window of its own, `width` by `height`, the page
 * at `#pane/<id>` drawing it alone; or brings its window to the front.
 * The window keeps the Pane's place; closing this one brings it back.
 */
function popOut(pane: string, width: number, height: number): void {
  const route = poppedRoute(pane)
  if (poppedOf(route) !== pane) return
  const shown = popped.get(pane)
  if (shown) {
    inFront(shown)
    return
  }
  const size = (at: number, least: number) =>
    Math.max(least, Math.min(Math.round(at) || least, 4096))
  const opened = pageWindow({
    width: size(width, 480),
    height: size(height, 360),
    minWidth: 320,
    minHeight: 240,
    title: "Banda",
  })
  void opened.loadURL(`${PAGE}${route}`)
  opened.on("closed", () => {
    popped.delete(pane)
    tellPopped()
  })
  popped.set(pane, opened)
  tellPopped()
}

/** Tells the window which Panes are in windows of their own. */
function tellPopped(): void {
  tellPage(window?.webContents, BRIDGE.popped.listen, [...popped.keys()])
}

/** A window that shows Banda's page, in the look's first colour. */
function pageWindow(
  options: Omit<
    BrowserWindowConstructorOptions,
    "show" | "backgroundColor" | "webPreferences"
  >,
  glass = false
): BrowserWindow {
  const current = lookNow()
  const opened = new BrowserWindow({
    ...options,
    show: false,
    ...(glass ? SYSTEM_MATERIAL?.made : {}),
    backgroundColor: glass
      ? CLEAR
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
  // The modules' parts hear of each window that shows the page.
  runtime.runSync(modules.opened(opened.webContents))
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

/** The app menu, with its Quit (⌘Q); File's Close Window (⌘W); Edit; and
 * Window, whose Banda shows the main window hidden as it closed: ⌘Tab
 * back to Banda does not show it, as the Dock's icon does. */
function macMenu(): Menu {
  return Menu.buildFromTemplate([
    { role: "appMenu" },
    { role: "fileMenu" },
    { role: "editMenu" },
    {
      role: "windowMenu",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { type: "separator" },
        { label: "Banda", click: () => inFront() },
        { type: "separator" },
        { role: "front" },
      ],
    },
  ])
}

// Closing the last window closes the window only: an engine that is the
// session's service goes on, and its Agents with it (ADR 0086, decision
// 3). One that is the window's child, as on Windows, on a Linux without
// systemd and in Banda Local, stops with it. On macOS, where the engine
// is still the app's child, the main window hides as it closes instead
// (closing.ts), so this comes on Linux and Windows.
app.on("window-all-closed", () => app.quit())

// On macOS a quit the app is asked for, by the app menu's or the Dock's
// Quit, or by ⌘Q where the page leaves the key (in a terminal, over a
// dialog, with the window hidden), is Quit Banda (ADR 0086, decision 3;
// closing.ts): it asks first while Agents work (`askToQuit`). Elsewhere
// ⌘Q is the page's own Quit Banda key. A quit Banda makes itself goes
// through, as does a logout, restart or shutdown, and every quit on Linux
// and Windows.
app.on("before-quit", (event) => {
  if (!asksOnQuit(closingNow(), window !== null)) {
    quitting = true
    return
  }
  event.preventDefault()
  // A runtime that cannot run it has no engine to ask about.
  void runtime.runPromise(askToQuit).catch(() => leave())
})

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
