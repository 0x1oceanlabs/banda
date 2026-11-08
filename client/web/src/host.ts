/**
 * What the desktop gives the page, on `window.banda`
 * (client/desktop/src/preload.ts). The page reaches the engine only through
 * the address it hands out, gets the look the desktop reads (ADR 0007),
 * and asks it to write the sidebar's preset (ADR 0008), to show system
 * notifications (ADR 0011) and to pick a folder (ADR 0026). The browser's
 * pages live in it too (ADR 0013).
 */
import { AGENTS_BRIDGE } from "@banda/agents-pane/desktop"
import { BROWSER_BRIDGE, type BrowserHost } from "@banda/browser-pane/desktop"
import { NOTIFY_BRIDGE } from "@banda/notifications-pane/desktop"
import type { Address, ProjectId } from "@banda/contract"
import { FILES_BRIDGE } from "@banda/ui/desktop"
import type { Args } from "@banda/ui/module"
import type { PaneState, Place } from "@banda/ui/pane"
import { bridge, type HostOf, invoke, push, send } from "@banda/contract/bridge"
import type { Listed, Look } from "@banda/contract/look"

export type { Notice } from "@banda/notifications-pane/desktop"

/**
 * Where Banda's own update is (ADR 0041, decision 2), as main tells it:
 * nothing to say, a look the Person asked for, a version downloading, one
 * ready to install on quit (or once the Threads stop), one out that the Person installs with
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
      /** Banda restarts into it once it is down (`update.now`), and
       * once no Thread works (ADR 0072, decision 3). */
      restarts: boolean
      /** Bytes down, and of how many, when electron-updater says. */
      down?: number
      size?: number
    }
  | {
      state: "ready"
      version: string
      notes: Note[]
      /** Banda waits for the Threads to stop, then restarts into it
       * (ADR 0072, decision 3); the window asks for the restart. */
      waits: boolean
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
 * Another machine's engine, as the window reaches it over ssh (ADR 0081,
 * decision 4; `hosts.toml`): starting; waiting for the Person to sign in
 * to Tailscale at `url`; live, with its build and this window's own
 * (`own`), which may differ; away, and tried again soon; stopped as asked
 * there, and started again only when the page asks (`hostStart`); or
 * refused, and tried again every ten minutes or when the page asks. `why`
 * is the window's words, never what the other machine said, and names no
 * machine: the page puts the machine's name before it (ADR 0095, decision
 * 2).
 */
export type HostState = { name: string } & (
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
 * nothing there (ADR 0095, decision 9; #837): found, with what its `uname`
 * says the machine is, the `banda` found there and this window's own, and
 * its engine while one runs, by what it says of itself (`banda status`),
 * whether it speaks this window's protocol; waiting for the Person to
 * sign in to Tailscale at `url`, Test asked again once they have; away; or
 * refused. `why` is as a host's state's.
 */
export type HostTest =
  | {
      state: "found"
      system: "Linux" | "macOS" | null
      banda: { build: string | null; version: string | null }
      own: { build: string | null; version: string | null }
      engine: {
        build: string | null
        version: string | null
        speaks: boolean
      } | null
    }
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
 * Every channel between the page and the desktop (ADR 0028), by where it
 * sits on `window.banda`; its path is its name. The preload builds
 * `window.banda` from it, and main answers it (client/desktop/src).
 */
export const BRIDGE = bridge({
  /** Where the engine listens now; it waits while the engine starts. */
  engine: invoke<[], Address>(),
  /** The other machines in `hosts.toml`, as the window reaches them over
   * ssh (ADR 0081, decision 4), with no secret. */
  hosts: {
    current: invoke<[], HostState[]>(),
    /** Calls `listener` with them each time one changes. */
    listen: push<HostState[]>(),
  },
  /** Where host `name`'s engine listens, through the window's forward:
   * it waits while the host connects or is stopped, tries a refused one
   * again, and fails for one refused or not in `hosts.toml`. */
  hostEngine: invoke<[name: string], Address>(),
  /** Starts host `name` again when its engine is stopped there or it is
   * refused; fails for one not in `hosts.toml`. */
  hostStart: invoke<[name: string]>(),
  /** Adds a machine to `hosts.toml`, its comments and other hosts kept,
   * and reaches it at once: `name` is made from `ssh` when not given, and
   * an empty `banda` is none. The entry written; fails for one Banda
   * refuses, or whose name or address is there already. */
  hostAdd: invoke<
    [machine: { name?: string; ssh: string; banda?: string }],
    HostEntry
  >(),
  /** Takes host `name` out of `hosts.toml`, the rest kept, and ends its
   * ssh; its Projects stay there. */
  hostRemove: invoke<[name: string]>(),
  /** What is at `ssh`, with `banda` or this build's own, starting nothing
   * there: Test connection, and Add's Connect. An empty `banda` is none. */
  hostTest: invoke<[ssh: string, banda: string | null], HostTest>(),
  /** Stop Banda on host `name`: its own `banda stop` there, which stops
   * its engine; the host shows stopped, live or away before, and nothing
   * starts it until `hostStart`. `working` while Agents work there and
   * `force` is not set: nothing was stopped, and the page asks first. */
  hostStop: invoke<[name: string, force: boolean], "stopped" | "working">(),
  /** The Hosts of `~/.ssh/config` to suggest in Add a machine: no
   * pattern, none `hosts.toml` reaches already. */
  sshSuggestions: invoke<[], string[]>(),
  /** `banda look --follow --with-parent`, as the desktop hears it. */
  look: {
    /** The last look; none before the first. */
    current: invoke<[], Look | null>(),
    /** Calls `listener` with each new look; returns how to stop. */
    listen: push<Look>(),
  },
  /** `sidebar.toml`, which the desktop writes; the look brings it back. */
  sidebar: {
    /** Names the preset in the file, keeping the Person's other keys. */
    preset: invoke<[name: string]>(),
    /** Opens the file in the Person's editor, from the template if new. */
    edit: invoke(),
  },
  /**
   * The window's frame (ADR 0030). Where Banda draws its own title bar, as
   * on macOS, the room in px the system's window buttons take at the start
   * of the bar: 0 in full screen, where the system hides them. `null`
   * where the system draws the frame.
   */
  frame: {
    current: invoke<[], number | null>(),
    listen: push<number | null>(),
  },
  /**
   * The accent set in the system's settings, as `#rrggbb` (ADR 0075,
   * decision 6): macOS's and Windows', and `null` elsewhere. Told again
   * when the Person changes it.
   */
  accent: {
    current: invoke<[], string | null>(),
    listen: push<string | null>(),
  },
  /** The browser's pages: their tabs, icons and downloads. */
  browser: BROWSER_BRIDGE,
  agents: AGENTS_BRIDGE,
  /**
   * The settings' files (ADR 0016): the desktop changes them through
   * `banda settings`; the look brings each change back.
   */
  settings: {
    /** Sets `key` in `file` to `value`, TOML; what was wrong, if refused. */
    set: invoke<[file: string, key: string, value: string], string[]>(),
    /** Takes `key` out of `file`; what was wrong, if refused. */
    reset: invoke<[file: string, key: string], string[]>(),
    /** Names `key` in `file` `to` instead, where it is, its value and
     * comments kept; what was wrong, if refused. */
    rename: invoke<[file: string, key: string, to: string], string[]>(),
    /** Opens `file` in the Person's editor; its folder when it is not there. */
    reveal: invoke<[file: string]>(),
    /** The themes there are. */
    themes: invoke<[], Listed[]>(),
  },
  /** Editing in the page. */
  edit: {
    /** The focused field takes what the clipboard holds, as the system's
     * paste does: the page never reads the clipboard itself. */
    paste: send<[]>(),
    /** As `paste`, the clipboard's text alone, as the system's "paste
     * and match style" does (ADR 0063, decision 3). */
    pastePlain: send<[]>(),
    /** Copies the image at a point of the page, as the system's menu
     * does: a Thread's "Copy image" (ADR 0063, decision 3). */
    copyImageAt: send<[x: number, y: number]>(),
  },
  /** Files on the machine, as links name them and any Pane shows them
   * (ADR 0073, decision 14). */
  files: FILES_BRIDGE,
  /** What broke in Banda (ADR 0039): the engine keeps it; the desktop
   * shows where its logs are. */
  problems: {
    /** Opens the folder of `engine.log` and `window.log`. */
    logs: invoke(),
    /** Opens the page that asks again, as it opened, after it broke
     * (decision 2). */
    reopen: invoke(),
  },
  /** The Banda menu, as `banda menu [route]` opens it (ADR 0017). */
  menu: {
    /** Opens the menu at `route` in the window, brought to the front, as
     * `banda menu` does: `actions` is the key sheet. */
    open: send<[route: string]>(),
    /** Calls `listener` with each route the menu is asked to open at. */
    listen: push<string>(),
  },
  /** The desktop's notifications and its quiet: the notifications
   * module's (ADR 0056). */
  notifications: NOTIFY_BRIDGE,
  /**
   * Panes in windows of their own (ADR 0025, decision 9). The window keeps
   * each in its place; main opens its own window on the page at
   * `#pane/<id>`, and tells the window when it closes.
   */
  popped: {
    /** Opens Pane `pane` in a window of its own, as big as its tile, or
     * brings that window to the front. */
    open: send<[pane: string, width: number, height: number]>(),
    /** Closes Pane `pane`'s window: it is back in its place. */
    close: send<[pane: string]>(),
    /** The Panes in windows of their own now. */
    current: invoke<[], string[]>(),
    /** Calls `listener` with them each time they change. */
    listen: push<string[]>(),
    /** What a Pane in its own window asks of the window: main hands it on
     * and brings the window to the front. */
    ask: send<[asked: PoppedAsk]>(),
    /** Calls `listener` with each thing a popped Pane asked. */
    asked: push<PoppedAsk>(),
  },
  /** Quits Banda: stops the engine, which stops its Agents, Harnesses and
   * Terminals, and closes the window (ADR 0086, decision 3). The page
   * asks first when Agents are working. Closing the window only closes
   * it. */
  quit: send<[]>(),
  /** Banda's own update (ADR 0041): main looks, downloads and installs
   * it on quit. */
  update: {
    /** Where it is now. */
    current: invoke<[], Update>(),
    /** Calls `listener` each time that changes. */
    listen: push<Update>(),
    /** Looks for a new version now. */
    check: send<[]>(),
    /** Looks, downloads and restarts into a new version as soon as it is
     * down; restarts at once into one that is ready (ADR 0045). */
    now: send<[]>(),
    /** Keeps the version that downloads for the quit, with no restart. */
    later: send<[]>(),
    /** Installs the version that is ready and starts it; nothing if none
     * is. */
    restart: send<[]>(),
    /** Restarts into the version that is ready once no Thread works: the
     * window asks for the restart then (ADR 0072, decision 3). */
    wait: send<[]>(),
    /** The Person saw that Banda updated: the update is `none` again. */
    seen: send<[]>(),
  },
  /** The system's folder picker, which "Add Project" opens (ADR 0026). */
  folder: {
    /** The folder the Person picks, the picker opened at `at`, a whole
     * path, or at home; none if they cancel. */
    pick: invoke<[at: string | null], string | null>(),
  },
})

/** What the desktop gives the page: the table's channels, and the
 * browser's buttons beside them. */
export type Host = Omit<HostOf<typeof BRIDGE>, "browser"> & {
  browser: BrowserHost
}

declare global {
  interface Window {
    banda?: Host
  }
}
