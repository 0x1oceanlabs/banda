/**
 * The desktop window. It reaches the engine, the session's service (a
 * systemd unit on Linux, a launchd job on macOS), which it starts when it
 * does not run, or else its child (engine.ts, ADR 0086), serves the page
 * from `app://banda` (os-window/page.ts) and hands the page the engine's
 * address. Closing it
 * is not quitting Banda: the engine and its Agents go on, and Quit Banda
 * stops them; where Banda lives in the menu bar or the tray closing it
 * hides it, its icon there saying who works and who waits (closing.ts,
 * menubar.ts, tray.ts). It also
 * runs `banda look --follow` and hands the page each look (ADR 0007),
 * opens `sidebar.toml` in the Person's editor (sidebar.ts), and
 * answers for the device's files, clipboard and pickers (device/), and a
 * Pane in a window of its own, the same page at `#pane/<id>` (ADR 0025,
 * decision 9); nothing else crosses from Node to the page (docs/architecture.md,
 * "Processes"). The modules' parts in main run here too, as the
 * browser's pages, kept apart from the page (modules.ts, ADR 0013, ADR
 * 0028). Settings are a Pane of the page; the desktop writes their files
 * (settings.ts, ADR 0016). It swaps its own app for the release its
 * engine says is newest (`@banda/updates-desktop`, ADR 0119), writes
 * what the system says of itself for the theme (os-window/system.ts), and
 * opens its windows (os-window/windows.ts), made of what the look says
 * (os-window/material.ts), a Pane's own over them (os-window/popped.ts).
 * Whether it quits, its icon in the Dock, what the app is asked from
 * outside its windows, and its menus there with the door `banda menu`
 * knocks at are parts too (os-window/quitting.ts, dock.ts, asked.ts,
 * menus.ts).
 * It reaches the engines of the machines in `hosts.toml` over ssh, and
 * hands the page their addresses too; it adds, takes out, tests and stops
 * those machines as the page asks (hosts.ts, ADR 0081, ADR 0095).
 */
import { existsSync } from "node:fs"
import { userInfo } from "node:os"
import { join, resolve } from "node:path"
import { app, nativeTheme, powerMonitor, type WebContents } from "electron"
import { NodeServices } from "@effect/platform-node"
import { Effect, Layer, ManagedRuntime, Schema, Stream } from "effect"
import { Engine, none, serve, tellPage, text } from "@banda/desktop-kit"
import { actsAnswers } from "./acts"
import { BRIDGE } from "./bridge"
import { engineLayer, OwnEngine, Stop } from "./engine"
import { windowKey } from "./key"
import { loginPath } from "./login"
import { firstLook, lookLayer } from "./look"
import { appUpdates, modules } from "./modules"
import {
  CHANNELS,
  channel,
  configFolder,
  dataFolder,
  REPOSITORY,
  stateFolder,
} from "./channel"
import { listApp, listedImage, listShortcut } from "./entry"
import { hasIcon } from "./tray"
import { statusLayer } from "./status"
import { forwardAnswer, reaching, signedHello } from "./forward"
import { Hosts, terminalArgs } from "./hosts"
import { problemsAnswers, startLog, watchProblems } from "./problems"
import { Editors } from "./editors"
import { roadLayer } from "./road"
import { settingsAnswers, settingsLayer } from "./settings"
import { sidebarAnswers } from "./sidebar"
import { clipboardAnswers } from "./device/clipboard"
import { filesAnswers } from "./device/files"
import { pickAnswers } from "./device/pick"
import { frameAnswers, lookAnswers, Material } from "./os-window/material"
import { Popped, poppedAnswers } from "./os-window/popped"
import { Windows } from "./os-window/windows"
import { askedLayer } from "./os-window/asked"
import { Dock, thisDock } from "./os-window/dock"
import { menuAnswers, menusLayer, thisMenus } from "./os-window/menus"
import { quitAnswer, Quitting, thisApp } from "./os-window/quitting"
import { appScheme, DEV_PAGE, fromPage, pageLayer } from "./os-window/page"
import { systemLayer, thisSystem } from "./os-window/system"
import { NODE_FOLDER, PROGRAM, Program, whereOf } from "./program"

/**
 * For tests only: how many ms late the page hears what the engine says,
 * as from a host far away (`Address.latency`). A packaged app ignores it.
 */
const TEST_LATENCY = app.isPackaged
  ? 0
  : Number(process.env.BANDA_TEST_LATENCY) || 0

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
// What Install runs on another machine (ADR 0119, decision 8): the app's
// own copy, or the checkout's.
const installScript = app.isPackaged
  ? join(process.resourcesPath, "install.sh")
  : resolve(here, "../../scripts/install.sh")
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
const key = windowKey(state, DEV_PAGE)
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

// `app:` is named to Chromium before the app is ready (os-window/page.ts).
appScheme()

/** Main's services (ADR 0020): the engine and the look as children, the
 * settings, all three on the window's `banda` (program.ts), over them the
 * modules' own, the browser's and the notifications' (modules.ts), and
 * the road that answers what the modules' engine parts ask (road.ts).
 * Beside them, not under them, the other machines' engines (hosts.ts):
 * only the page reaches those. Over them all, the page's server
 * (os-window/page.ts), which is built last, so `app://` is answered once
 * the runtime is built: before the first window loads its page (`ready`).
 * Under them all, whether Banda quits (os-window/quitting.ts) and, built
 * first, its icon in the Dock (os-window/dock.ts): a launch the engine
 * made loses it before anything else starts.
 * They start with the first effect run, and stop when it is disposed. */
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
          // Quit Banda stopped the engine, here or by `banda stop`: the
          // window goes with it, unless an update restarts it. Stopped by
          // anything else, the window stays (engine.ts).
          () =>
            runtime.runSync(
              Quitting.use((quitting) => Effect.sync(quitting.engineStopped))
            ),
          key
        ),
        // The windows (os-window/windows.ts), over what they are made of
        // (os-window/material.ts), over the look. What the system says of
        // itself is written before the look starts, so the first look has
        // it too (os-window/system.ts).
        Windows.layer({
          opened: (contents) => runtime.runSync(modules.opened(contents)),
          closePopped: () => popped?.closeAll(),
        }).pipe(
          Layer.provideMerge(Material.layer()),
          Layer.provideMerge(
            lookLayer.pipe(
              Layer.provide(
                systemLayer(join(state, "device.json"), thisSystem())
              )
            )
          )
        ),
        // Who works and who waits here, for the menu bar and the tray.
        statusLayer(hasIcon()),
        // The settings open their files with `Editors.edit`.
        settingsLayer.pipe(Layer.provideMerge(Editors.layer))
      ).pipe(
        Layer.provideMerge(
          Quitting.layer(thisApp()).pipe(Layer.provideMerge(Stop.layer))
        )
      )
    ),
    Layer.merge(
      reaching(configFolder(app.getPath("appData")), installScript, key, state)
    ),
    // The Panes' own windows, over the windows (os-window/popped.ts).
    (services) => Popped.layer.pipe(Layer.provideMerge(services)),
    // What the app is asked from outside its windows (os-window/asked.ts).
    (services) => askedLayer(thisApp()).pipe(Layer.provideMerge(services)),
    // Its menus outside the page, and `banda menu`'s door (os-window/menus.ts).
    (services) => menusLayer(thisMenus()).pipe(Layer.provideMerge(services)),
    // Over them all, what answers `app://`: the page, and the hosts beside
    // it, the modules' too (os-window/page.ts).
    (services) =>
      pageLayer(pageFolder, modules.served).pipe(Layer.provideMerge(services)),
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
    Layer.provide(NodeServices.layer),
    Layer.provideMerge(Dock.layer(thisDock()))
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
/** Banda's windows (os-window/windows.ts), once main's runtime has built
 * them (`ready`): none is open before, so what asks before finds none. */
let windows: Windows["Service"] | null = null
/** The Panes' own windows (os-window/popped.ts), built with them. */
let popped: Popped["Service"] | null = null
/** Whether Banda quits, and its icon in the Dock, built with them. */
let quitting: Quitting["Service"] | null = null
let dock: Dock["Service"] | null = null

/** How long the window waits for its look, so it opens in its colours. */
const LOOK_WAIT = 300

if (process.env.APPIMAGE_EXIT_AFTER_INSTALL === "true") {
  // electron-updater runs the AppImage it moved in once. It has the old
  // one's APPIMAGE, so the old Banda lists the new file (@banda/updates-desktop), and
  // nothing starts here (ADR 0041, decision 3).
  app.exit(0)
} else if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on("second-instance", () => windows?.inFront())
  powerMonitor.on("resume", () =>
    runtime.runFork(Hosts.use((hosts) => hosts.woke))
  )
  listApp()
  void app.whenReady().then(ready)
}

async function ready(): Promise<void> {
  listShortcut()
  // Each window hears how the other machines are (hosts.ts).
  runtime.runFork(
    Hosts.use((hosts) =>
      hosts.changes.pipe(
        Stream.runForEach((now) =>
          Effect.sync(() => {
            for (const shown of [windows?.main(), ...(popped?.windows() ?? [])])
              tellPage(shown?.webContents, BRIDGE.hosts.listen, now)
          })
        )
      )
    )
  )
  // The app's own update, the updates module's part here (ADR 0119,
  // decision 2; ADR 0137): the engine's updates module says what is
  // newest and when to restart, this window swaps its app, and says each
  // step to the engine. Its restart leaves the engine and its Agents
  // running: the engine moves onto its new copy once nothing runs.
  const engineClient = () =>
    runtime.runPromise(Engine.use((engine) => engine.client))
  const update = appUpdates.updates(
    {
      name: channel.name,
      folder: channel.folder,
      which:
        channel === CHANNELS.dev
          ? "dev"
          : channel === CHANNELS.stable
            ? "stable"
            : "local",
      repository: REPOSITORY,
      listApp,
      listedImage,
      alone: () => !!dock?.unseen(),
      quits: () => !!quitting?.quits(),
    },
    {
      check: () =>
        engineClient().then((client) => client.call("updates.check", {})),
      // The engine says it on `updates.state`, where the page reads it
      // (ADR 0137, decision 2).
      app: (said) =>
        engineClient().then((client) => client.call("updates.app", said)),
    },
    () => quitting?.updating()
  )
  void engineClient().then((client) =>
    appUpdates.followEngine(client, app.getVersion(), update.heard)
  )
  /** An engine's address, with the tests' latency. */
  const late = <A extends { url: string }, E, R>(
    address: Effect.Effect<A, E, R>
  ) =>
    TEST_LATENCY
      ? Effect.map(address, (at) => ({ ...at, latency: TEST_LATENCY }))
      : address
  serve(runtime, fromPage, BRIDGE, {
    // Stopped, not by Quit Banda, it says so: the page's Panes do too.
    engine: [none, () => OwnEngine.use((engine) => late(engine.reached))],
    // The other machines' engines, through ssh (hosts.ts, ADR 0081), as
    // far as this one's in a test.
    hosts: { current: [none, () => Hosts.use((hosts) => hosts.current)] },
    hostEngine: [
      text,
      ([name]) => Hosts.use((hosts) => late(hosts.address(name))),
    ],
    // No name is this machine's own engine, stopped (ADR 0124).
    sign: [text, ([message]) => signedHello(message)],
    hostStart: [
      text,
      ([name]) =>
        name === ""
          ? OwnEngine.use((engine) => engine.start)
          : Hosts.use((hosts) => hosts.start(name)),
    ],
    hostAdd: [
      Schema.Tuple([
        Schema.Struct({
          name: Schema.optionalKey(Schema.String),
          ssh: Schema.String,
          banda: Schema.optionalKey(Schema.String),
        }),
      ]),
      ([machine]) => Hosts.use((hosts) => hosts.add(machine)),
    ],
    hostSet: [
      Schema.Tuple([
        Schema.String,
        Schema.Struct({
          ssh: Schema.optionalKey(Schema.String),
          banda: Schema.optionalKey(Schema.String),
        }),
      ]),
      ([name, change]) => Hosts.use((hosts) => hosts.set(name, change)),
    ],
    hostRemove: [text, ([name]) => Hosts.use((hosts) => hosts.remove(name))],
    hostTest: [
      Schema.Tuple([Schema.String, Schema.NullOr(Schema.String)]),
      // An empty `banda` is none, as Add's.
      ([ssh, banda]) =>
        Hosts.use((hosts) => hosts.test(ssh, banda || undefined)),
    ],
    hostInstall: [
      text,
      ([ssh], event) =>
        Hosts.use((hosts) =>
          hosts.install(ssh, (line) =>
            tellPage(event.sender, BRIDGE.hostInstalling.listen, {
              ssh,
              line,
            })
          )
        ),
    ],
    hostInstallCancel: [
      text,
      ([ssh]) => Hosts.use((hosts) => hosts.cancelInstall(ssh)),
    ],
    hostTerminal: [
      Schema.Tuple([Schema.String, Schema.String]),
      ([ssh, remote]) => Effect.sync(() => terminalArgs(ssh, remote)),
    ],
    // Its lines go to the page that asked, as they come.
    hostInstalling: {},
    hostStop: [
      Schema.Tuple([Schema.String, Schema.Boolean]),
      ([name, force]) => Hosts.use((hosts) => hosts.stop(name, force)),
    ],
    hostForward: forwardAnswer,
    sshSuggestions: [none, () => Hosts.use((hosts) => hosts.suggestions)],
    // What the windows are made of (os-window/material.ts): the look as
    // a window can show it, and the room its frame takes.
    look: lookAnswers,
    frame: frameAnswers,
    sidebar: sidebarAnswers,
    // The modules' own: the browser's (ADR 0013).
    ...modules.answers,
    // The settings' (ADR 0016) and the Banda menu's (ADR 0017).
    settings: settingsAnswers,
    // What broke in Banda: its logs, and the page opened again (ADR 0039).
    problems: problemsAnswers(state),
    // The device's capabilities (device/; ADR 0089, decision 9): its
    // files, its clipboard, and "Add Project"'s folder picker (ADR 0026).
    files: filesAnswers,
    edit: clipboardAnswers,
    folder: pickAnswers,
    menu: menuAnswers,
    // Quit Banda (ADR 0086, decision 3): the page asked first when Agents
    // are working.
    quit: quitAnswer,
    // The page's answers to the actions it was asked to run (acts.ts).
    act: actsAnswers,
    // Panes in windows of their own (ADR 0025, decision 9): the window
    // pops them out; what they ask goes to it (os-window/popped.ts).
    popped: poppedAnswers,
  })
  const first = await runtime.runPromise(firstLook(LOOK_WAIT))
  if (first) nativeTheme.themeSource = first.mode
  // The runtime is built, and its windows with it.
  const built = runtime.runSync(Windows.use(Effect.succeed))
  windows = built
  popped = runtime.runSync(Popped.use(Effect.succeed))
  quitting = runtime.runSync(Quitting.use(Effect.succeed))
  dock = runtime.runSync(Dock.use(Effect.succeed))
  // A launch the engine made, as it found no app, shows no window and no
  // Dock icon: only the menu bar's (closing.ts).
  runtime.runSync(built.open(!dock.startsHidden))
}

let stopped = false
app.on("will-quit", (event) => {
  if (stopped) return
  event.preventDefault()
  void runtime.dispose().then(() => {
    stopped = true
    app.quit()
  })
})
