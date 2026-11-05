/**
 * What the desktop gives the page, on `window.banda`
 * (app/desktop/src/preload.ts). The page reaches the engine only through
 * the address it hands out, gets the look the desktop reads (ADR 0007),
 * and asks it to write the sidebar's preset (ADR 0008), to show system
 * notifications (ADR 0011) and to pick a folder (ADR 0026). The browser's
 * pages live in it too (ADR 0013).
 */
import { AGENTS_BRIDGE } from "@banda/agents-pane/desktop"
import { BROWSER_BRIDGE, type BrowserHost } from "@banda/browser-pane/desktop"
import { NOTIFY_BRIDGE } from "@banda/notifications-pane/desktop"
import type { Address, SpaceId } from "@banda/contract"
import type { Args } from "@banda/ui/module"
import type { PaneState, Place } from "@banda/ui/pane"
import { bridge, type HostOf, invoke, push, send } from "@banda/contract/bridge"
import type { Listed, Look } from "@banda/contract/look"

export type { Notice } from "@banda/notifications-pane/desktop"

/**
 * Where Banda's own update is (ADR 0041, decision 2), as main tells it:
 * nothing to say, a look the Person asked for, a version downloading, one
 * ready to install on quit, one out that the Person installs with
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
    }
  | { state: "ready"; version: string; notes: Note[] }
  | { state: "out"; version: string; notes: Note[]; command: string }
  | { state: "failed"; reason: string }
)

/** What one release since the Person's changed: a Dev's commit title,
 * a Stable's PRs (ADR 0033, decision 4). */
export type Note = { version: string; text: string }

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
  | { open: { space: SpaceId; pane: PaneState; from: string; place?: Place } }
  | { run: { action: string; args?: Args } }

/**
 * Every channel between the page and the desktop (ADR 0028), by where it
 * sits on `window.banda`; its path is its name. The preload builds
 * `window.banda` from it, and main answers it (app/desktop/src).
 */
export const BRIDGE = bridge({
  /** Where the engine listens now; it waits while the engine starts. */
  engine: invoke<[], Address>(),
  /** `banda look --follow`, as the desktop hears it. */
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
  /** Files on the machine, as links name them. */
  files: {
    /** Opens the file at the full `path` in the app the system has for
     * it; a program it only shows in its folder, so it never runs. */
    outside: send<[path: string]>(),
    /** Shows the file at the full `path` in its folder, in the system's
     * file manager (ADR 0063, decision 3). */
    show: send<[path: string]>(),
    /** Whether a file, or a folder, is at the full `path`. */
    exists: invoke<[path: string], boolean>(),
  },
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
  },
  /** The system's folder picker, which "Add Space" opens (ADR 0026). */
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
