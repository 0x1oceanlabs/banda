/**
 * What the desktop gives the page, on `window.banda`
 * (app/desktop/src/preload.ts). The page reaches the engine only through
 * the address it hands out, gets the look the desktop reads (ADR 0007),
 * and asks it to write the sidebar's preset (ADR 0008), to show system
 * notifications (ADR 0011) and to pick a folder (ADR 0026). The browser's
 * pages live in it too (ADR 0013).
 */
import { BROWSER_BRIDGE, type BrowserHost } from "@banda/browser-pane/desktop"
import type { Address, SpaceId } from "@banda/contract"
import type { Args } from "@banda/ui/module"
import type { PaneState, Place } from "@banda/ui/pane"
import { bridge, type HostOf, invoke, push, send } from "@banda/contract/bridge"
import type { Listed, Look } from "@banda/contract/look"

/** A system notification the page asks the desktop for (ADR 0011, decision 3). */
export type Notice = {
  /** One per thing: a new notice of it replaces the last. */
  key: string
  title: string
  body?: string
  /** The mark in the call's state, as a PNG data URL. */
  icon?: string
  /** The words of its button. */
  answer: string
  /** It stays until taken back, as one that waits for the Person does. */
  lasts: boolean
}

/**
 * Where Banda's own update is (ADR 0041, decision 2), as main tells it:
 * nothing to say, a version downloading, one ready to install on quit,
 * or one that cannot install until the Person mends something. `have` is
 * the version that runs.
 */
export type Update = { have: string } & (
  | { state: "none" }
  | { state: "downloading"; version: string; share: number }
  | { state: "ready"; version: string; notes: Note[] }
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
  /** The browser's pages: their tabs, icons and downloads. */
  browser: BROWSER_BRIDGE,
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
  /** What broke in Banda (ADR 0039): the engine keeps it; the desktop
   * shows where its logs are. */
  problems: {
    /** Opens the folder of `engine.log` and `window.log`. */
    logs: invoke(),
  },
  /** The Banda menu, as `banda menu [route]` opens it (ADR 0017). */
  menu: {
    /** Opens the menu at `route` in the window, brought to the front, as
     * `banda menu` does: `actions` is the key sheet. */
    open: send<[route: string]>(),
    /** Calls `listener` with each route the menu is asked to open at. */
    listen: push<string>(),
  },
  /** The desktop's notifications and its quiet. */
  notify: {
    /** Shows a notice; one of the same key goes first. */
    show: send<[notice: Notice]>(),
    /** Takes back the notice of `key`, if it still shows. */
    withdraw: send<[key: string]>(),
    /**
     * Calls `listener` with a notice's key when the Person clicks it; the
     * window is in front by then. Returns how to stop.
     */
    listen: push<string>(),
    /** Whether the desktop is quiet now: its Do Not Disturb is on. */
    quiet: invoke<[], boolean>(),
  },
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
