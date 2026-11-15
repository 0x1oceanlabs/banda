/**
 * The words the page and the desktop say to each other (ADR 0089,
 * decision 2): what the bridge's channels carry, which the page's device
 * adapter (`client/web/src/boot/desktop.ts`) and Electron main both read.
 * The channels themselves are the desktop's table (`BRIDGE`, in
 * `client/desktop/src/bridge.ts`). The port's interface is here too
 * (`Device`), written once: the device object the Window reaches them by
 * satisfies it, and stays with its desktop adapter in
 * `client/web/src/boot/` (decision 4).
 */
import type { Address, Named, ProjectId } from "@banda/contract"
import type { Listed } from "@banda/contract/look"
import type { HostsDevice } from "./hosts"
import type { PaneState, Place } from "./pane"
import type { PaneDevice } from "./route"
import type { Args } from "./run"

/**
 * Where Banda's own update is (ADR 0041, decision 2), as main tells it:
 * nothing to say, a look the Person asked for, a version downloading, one
 * ready to install on quit or on Restart, one out that the Person installs with
 * `command` (on macOS, through brew: ADR 0033, decision 6), or one that
 * cannot install until the Person mends something. `name` is the app's, `Banda Dev`, and `have` the
 * version that runs. `always` keeps the widget on the bar with nothing to
 * say, as Banda Dev's is (ADR 0045).
 */
export type Update = { name: string; have: string; always: boolean } & (
  | {
      state: "none"
      /** When the last look ended, in ms since the epoch. */
      looked?: number
      /** Why the last look the Person asked for failed. */
      missed?: string
    }
  | { state: "looking" }
  | {
      state: "downloading"
      version: string
      share: number
      notes: Note[]
      /** Banda restarts into it once it is down (`update.now`). */
      restarts: boolean
      /** Bytes down, and of how many, when electron-updater says. */
      down?: number
      size?: number
    }
  | {
      /** Down: Restart starts it at once, and the engine and its Agents
       * go on (ADR 0119, decision 4); or the quit installs it. */
      state: "ready"
      version: string
      notes: Note[]
    }
  | {
      /** The first moments of a Banda that restarted into a new version
       * (ADR 0072, decision 4), until the window says it was seen. */
      state: "updated"
      from: string
      notes: Note[]
    }
  | { state: "out"; version: string; notes: Note[]; command: string }
  | { state: "failed"; reason: string }
)

/** What one release since the Person's changed: a Dev's commit title,
 * a Stable's PRs (ADR 0033, decision 4). */
export type Note = { version: string; text: string }

/**
 * Where the window's page finds this machine's engine, as the desktop
 * tells it (ADR 0124, decision 5): at its door, as the device this
 * machine paired this window as, with the host key the engine must
 * prove, where the engine has a door; the desktop holds the device's key
 * and signs for the page (`sign`). An engine with no door yet is reached
 * as before, by its owner's secret.
 */
export type EngineAt = { url: string; latency?: number } & (
  { secret: string } | { door: { device: string; hostKey: string } }
)

/**
 * Another machine's engine, as the window reaches it over ssh (ADR 0081,
 * decision 4; `hosts.toml`): starting; waiting for the Person to sign in
 * to Tailscale at `url`; live, with its build and this window's own
 * (`own`), which may differ; away, and tried again soon; stopped as asked
 * there, and started again only when the page asks (`hostStart`); or
 * refused, and tried again every ten minutes or when the page asks. `why`
 * is the window's words, never what the other machine said, and names no
 * machine: the page puts the machine's name before it (ADR 0095, decision
 * 2). `name` is its key in `hosts.toml`, this device's own: the name and
 * icon the window draws are what the machine says on its own engine.
 * `ssh` and `banda` are its entry there, as Settings → Machines shows and
 * changes them (`hostSet`).
 */
export type HostState = {
  name: string
  /** Where ssh goes, as `hosts.toml` says it. */
  ssh: string
  /** The `banda` it runs there; none to find this build's own there. */
  banda?: string
} & (
  | { state: "connecting" }
  | { state: "signin"; url: string }
  | {
      state: "live"
      build: string | null
      version: string | null
      own: { build: string | null; version: string | null }
    }
  | { state: "away"; why: string }
  | { state: "stopped" }
  | { state: "refused"; why: string }
)

/** A machine of `hosts.toml`: this device's key for it, where ssh goes,
 * and the `banda` it runs there, or none to find this build's own there
 * (ADR 0081, decision 4; ADR 0095, decision 2). */
export type HostEntry = { name: string; ssh: string; banda?: string }

/**
 * What Test, and Add's Connect, find at an address over ssh, starting
 * nothing there (ADR 0095, decision 9; #837): found, with the system the
 * machine runs, its own name and icon, the `banda` found there and this
 * window's own, and its engine while one runs, by what it says of itself
 * (`banda status`), whether it speaks this window's protocol; waiting for
 * the Person to sign in to Tailscale at `url`, Test asked again once they
 * have; away; or refused. `why` is as a host's state's.
 */
export type HostTest =
  | {
      state: "found"
      /** As its `banda status` says it, "Arch Linux", "macOS 26.1"; from
       * a banda before that, "Linux" or "macOS", as its `uname` says;
       * none when neither does. Plain text, cut short. */
      system: string | null
      /** Its own name and icon, as its `machine.toml` says them over what
       * Banda finds there (ADR 0095, decisions 2 and 3), cleaned as the
       * page cleans a Welcome's; none from a banda before them. */
      named: Named | null
      banda: { build: string | null; version: string | null }
      own: { build: string | null; version: string | null }
      engine: {
        build: string | null
        version: string | null
        speaks: boolean
      } | null
    }
  /** Reachable, with no Banda there: what Install would put there, this
   * window's own `version`, by what the machine's `install.sh --check`
   * says of it (ADR 0119, decision 8): its system, as found, and `arch`,
   * "x86_64" or "arm64". */
  | { state: "missing"; system: string | null; arch: string; version: string }
  | { state: "signin"; url: string }
  | { state: "away"; why: string }
  | { state: "refused"; why: string }

/** The page's route that draws Pane `pane` alone, in a window of its
 * own (ADR 0025, decision 9). */
export const poppedRoute = (pane: string) => `#pane/${pane}`

/** The Pane the page at `hash` draws alone, if it is such a window's: an
 * ID as the engine makes them. */
export function poppedOf(hash: string): string | undefined {
  return /^#pane\/([\w-]{1,64})$/.exec(hash)?.[1]
}

/**
 * What a Pane in its own window asks of the window, which has the
 * workspaces: to open a Pane beside it, as a Thread its terminal, or to
 * run an action.
 */
export type PoppedAsk =
  | {
      open: { project: ProjectId; pane: PaneState; from: string; place?: Place }
    }
  | { run: { action: string; args?: Args } }

/**
 * An action the device asks the Window to run, as its key does, for who
 * asks from outside the page (ADR 0127, decision 2): the engine, for
 * `banda act` and an Agent's `act` tool, or the device itself, as its
 * menu bar. `id` names the ask in its answer.
 */
export type ActAsk = { id: number; action: string; args?: Args }

/** The Window's answer to an `ActAsk`: it ran the action, or `refused`
 * says why not, in words: it has no such action, the focus is not in the
 * action's scope, or the action did not run there. */
export type ActAnswer = { id: number; refused?: string }

/**
 * Takes a channel's current value, then each new one it tells. A value
 * told while the first answer was on its way is the newer, so it wins.
 */
export function follow<T>(
  channel: {
    current: () => Promise<T>
    listen: (listener: (value: T) => void) => unknown
  },
  take: (value: T) => void
): void {
  let told = false
  void channel.current().then((first) => told || take(first))
  channel.listen((value) => {
    told = true
    take(value)
  })
}

/**
 * What a device can do for a Pane, the closed list of capabilities (ADR
 * 0082, decision 12, as ADR 0106 decision 6 amends it): tell, sound, the
 * clipboard, pick a file, open outside Banda, draw a page, drag out,
 * save a copy, and open another machine's port here (ADR 0120, decision
 * 2). A web client has no `webview`, no `drag_out` and no `forward_port`.
 */
export type Cap =
  | "notify"
  | "sound"
  | "clipboard"
  | "pick_file"
  | "open_outside"
  | "webview"
  | "drag_out"
  | "save_file"
  | "forward_port"

/** How to stop hearing what a part tells; none where no desktop tells. */
type Stop = (() => void) | undefined

/**
 * The device port (ADR 0089, decision 2): the one way from the Window to
 * the device it runs on, part by part as `client/web/src/boot/desktop.ts`
 * answers it, where each part says what it does. One object satisfies
 * it: without the desktop, as in a browser at a machine's door, the same
 * object answers, its engine and its hosts from the browser's own
 * (`boot/browser.ts`) and the rest with nothing or a refusal. What a Pane
 * holds of it is `PaneDevice`, whose `has` is this one's.
 */
export interface Device extends Pick<PaneDevice, "has"> {
  /** Where this machine's engine listens now (ADR 0124, decision 5). */
  engine: () => Promise<Address>
  /** The other machines: what the hosts store reads (`HostsDevice`), and
   * what Settings → Machines does to `hosts.toml` and at an address. */
  hosts: HostsDevice & {
    stop: (name: string, force: boolean) => Promise<"stopped" | "working">
    forward: (
      name: string,
      port: number,
      same?: boolean
    ) => Promise<number | "away" | "taken">
    add: (machine: { ssh: string; banda?: string }) => Promise<HostEntry>
    set: (
      name: string,
      change: { ssh?: string; banda?: string }
    ) => Promise<HostEntry>
    remove: (name: string) => Promise<void>
    test: (ssh: string, banda: string | null) => Promise<HostTest>
    install: (
      ssh: string,
      told: (line: string) => void
    ) => Promise<{ version: string; path: string }>
    cancelInstall: (ssh: string) => Promise<void>
    terminalArgs: (ssh: string, remote: string) => Promise<string[]>
    suggestions: () => Promise<string[]>
  }
  /** Panes in windows of their own (ADR 0025, decision 9). */
  popped: {
    open: (pane: string, width: number, height: number) => void
    close: (pane: string) => void
    follow: (take: (panes: ReadonlySet<string>) => void) => Stop
    ask: (asked: PoppedAsk) => void
    asked: (listener: (asked: PoppedAsk) => void) => Stop
  }
  /** Actions asked of the Window from outside the page (ADR 0127,
   * decision 2). */
  act: {
    asked: (listener: (asked: ActAsk) => void) => Stop
    answer: (answer: ActAnswer) => void
  }
  /** The Banda menu, as `banda menu ROUTE` opens it (ADR 0017). */
  menu: {
    open: (route: string) => void
    listen: (listener: (route: string) => void) => Stop
  }
  /** `sidebar.toml` (ADR 0008). */
  sidebar: { edit: () => void }
  /** The settings' files (ADR 0016): each change answers what was wrong,
   * if it was refused. */
  settings: {
    set: (file: string, key: string, value: string) => Promise<string[]>
    reset: (file: string, key: string) => Promise<string[]>
    rename: (file: string, key: string, to: string) => Promise<string[]>
    reveal: (file: string) => void
    writes: () => boolean
    themes: () => Promise<Listed[]>
  }
  /** What broke in Banda (ADR 0039). */
  problems: { logs: () => void }
  /** A folder of this device, as its own dialog picks one (ADR 0026). */
  folder: { pick: (at: string | null) => Promise<string | null> }
  /** Files on the machine, by their full path (ADR 0073, decision 14). */
  files: {
    exists: (file: string) => Promise<boolean> | undefined
    outside: (file: string) => void
    show: (file: string) => void
    save: (
      url: string,
      name: string
    ) => Promise<"saved" | "canceled" | "away"> | undefined
  }
  /** Editing in the page, as the system's menu does (ADR 0063, decision
   * 3). */
  edit: {
    paste: () => void
    pastePlain: () => void
    copyImageAt: (x: number, y: number) => void
  }
  /** Banda's own update (ADR 0041). */
  update: {
    follow: (take: (update: Update) => void) => () => void
    seen: () => void
    now: () => void
    check: () => void
    restart: () => void
  }
  /** Quits Banda (ADR 0086, decision 3). */
  quit: () => void
}
