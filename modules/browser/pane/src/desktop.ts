/**
 * What Banda's desktop and the browser Pane say to each other
 * (app/desktop/src/browser.ts): the profile pages live in, the keys the
 * desktop takes from them, and the bridge on `window.banda.browser`.
 */
import type { Tabs } from "@banda/contract/look"

export { type Pressed, taken } from "./keys"

/** The profile every page shares (ADR 0013, decision 2). */
export const PARTITION = "persist:browser"

/** A download, as the row shows it while it runs and once it ended. */
export type Download = {
  id: string
  name: string
  /** Where it is saved, in the Person's Downloads. */
  path: string
  received: number
  /** Its size; 0 when the site does not say. */
  total: number
  state: "running" | "done" | "failed"
}

/**
 * What the desktop tells the browser of its pages, each by the ID of the
 * page's web contents (`<webview>`'s `getWebContentsId()`).
 */
export type BrowserNews =
  /** A page opens another in a tab of its own, as a link with Ctrl does. */
  | { kind: "open"; from: number; url: string; background: boolean }
  /** A page's icon, as a data URL: Banda's page shows no other images. */
  | { kind: "icon"; from: number; icon: string }
  | { kind: "download"; download: Download }
  /** An extension opens a tab: the Pane in front takes it, and answers
   * `created` with its page's ID. */
  | { kind: "create"; request: string; url: string }
  /** An extension shows a tab, or closes one. */
  | { kind: "select"; from: number }
  | { kind: "close"; from: number }

/** An extension's button, as Chrome's `action` says it, for every tab and
 * for some tabs alone (electron-chrome-extensions' `getState`). */
export type Action = ActionLook & {
  id: string
  tabs: Partial<Record<string, ActionLook>>
}

export type ActionLook = {
  title?: string
  /** The popup's page, from the extension's folder or a whole address. */
  popup?: string
  /** The badge's words and colour. */
  text?: string
  color?: string
  /** Changes when the icon does, to fetch it again. */
  iconModified?: number
}

/** A place in Banda's window, in its page's pixels. */
export type Box = { x: number; y: number; width: number; height: number }

/** The extensions' buttons. */
export type Actions = { actions: Action[] }

/** The desktop's side of the browser, on `window.banda.browser`. */
export type BrowserHost = {
  /** Writes where the tabs are into `browser.toml`; the look brings it back. */
  tabs: (where: Tabs) => Promise<void>
  /** Shows a finished download in its folder. */
  reveal: (path: string) => void
  /** Calls `listener` with each piece of news; returns how to stop. */
  listen: (listener: (news: BrowserNews) => void) => () => void
  /** The page the Person looks at, for the extensions' active tab. */
  shown: (contents: number) => void
  /** The page made for a `create`; none when no browser could take it. */
  created: (request: string, contents: number | null) => void
  /** The extensions' buttons. */
  actions: {
    state: () => Promise<Actions>
    /** Clicks a button without a popup: the extension hears it. */
    click: (extension: string, tab: number) => Promise<void>
    /** Shows the button's popup, `url`, under `under`, the button's place
     * in the window; or closes it when it shows. */
    popup: (extension: string, url: string, under: Box) => void
    /** Calls `listener` when any button changes; returns how to stop. */
    listen: (listener: () => void) => () => void
  }
  /** Pins an extension's button to the row, or takes it off, in
   * `browser.toml`. */
  pin: (extension: string, pinned: boolean) => Promise<void>
  /** Removes an extension, once the Person says so. */
  remove: (extension: string) => Promise<void>
}
