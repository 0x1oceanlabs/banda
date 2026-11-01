/**
 * What the desktop gives the page, on `window.banda`
 * (app/desktop/src/preload.ts). The page reaches the engine only through
 * the address it hands out, gets the look the desktop reads (ADR 0007),
 * and asks it to write the sidebar's preset (ADR 0008) and to show system
 * notifications (ADR 0011). The browser's pages live in it too (ADR 0013).
 */
import type { BrowserHost } from "@banda/browser-pane/desktop"
import type { Address } from "@banda/contract"
import type { Look } from "@banda/contract/look"

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
