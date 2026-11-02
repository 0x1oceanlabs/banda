/**
 * What the desktop gives the page, on `window.banda`
 * (app/desktop/src/preload.ts). The page reaches the engine only through
 * the address it hands out, gets the look the desktop reads (ADR 0007),
 * and asks it to write the sidebar's preset (ADR 0008) and to show system
 * notifications (ADR 0011). The browser's pages live in it too (ADR 0013).
 */
import type { BrowserHost } from "@banda/browser-pane/desktop"
import type { Address } from "@banda/contract"
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

export type Host = {
  /** Where the engine listens now; it waits while the engine starts. */
  engine: () => Promise<Address>
  /** `banda look --follow`, as the desktop hears it. */
  look: {
    /** The last look; none before the first. */
    current: () => Promise<Look | null>
    /** Calls `listener` with each new look; returns how to stop. */
    listen: (listener: (look: Look) => void) => () => void
  }
  /** `sidebar.toml`, which the desktop writes; the look brings it back. */
  sidebar: {
    /** Names the preset in the file, keeping the Person's other keys. */
    preset: (name: string) => Promise<void>
    /** Opens the file in the Person's editor, from the template if new. */
    edit: () => Promise<void>
  }
  /** The browser's pages: their tabs, icons and downloads. */
  browser: BrowserHost
  /**
   * The settings window (ADR 0016): the desktop opens it, and changes the
   * files through `banda settings`; the look brings each change back.
   */
  settings: {
    /** Opens the window at `link`, a section and a row: `appearance/radius`. */
    open: (link?: string) => void
    /** Closes the window. */
    close: () => void
    /** Sets `key` in `file` to `value`, TOML; what was wrong, if refused. */
    set: (file: string, key: string, value: string) => Promise<string[]>
    /** Takes `key` out of `file`; what was wrong, if refused. */
    reset: (file: string, key: string) => Promise<string[]>
    /** Opens `file` in the Person's editor; its folder when it is not there. */
    reveal: (file: string) => Promise<void>
    /** The themes there are. */
    themes: () => Promise<Listed[]>
    /** Calls `go` with each link the window is opened at again. */
    listen: (go: (link: string) => void) => () => void
  }
  /** The Banda menu, as `banda menu [route]` opens it (ADR 0017). */
  menu: {
    /** Opens the menu at `route` in the window, brought to the front, as
     * `banda menu` does: `actions` is the key sheet. */
    open: (route: string) => void
    /** Calls `open` with each route the menu is asked to open at. */
    listen: (open: (route: string) => void) => () => void
  }
  /** The desktop's notifications and its quiet. */
  notify: {
    /** Shows a notice; one of the same key goes first. */
    show: (notice: Notice) => void
    /** Takes back the notice of `key`, if it still shows. */
    withdraw: (key: string) => void
    /**
     * Calls `listener` with a notice's key when the Person clicks it; the
     * window is in front by then. Returns how to stop.
     */
    listen: (listener: (key: string) => void) => () => void
    /** Whether the desktop is quiet now: its Do Not Disturb is on. */
    quiet: () => Promise<boolean>
  }
}

declare global {
  interface Window {
    banda?: Host
  }
}
