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

/** The desktop's side of the browser, on `window.banda.browser`. */
export type BrowserHost = {
  /** Writes where the tabs are into `browser.toml`; the look brings it back. */
  tabs: (where: Tabs) => Promise<void>
  /** Shows a finished download in its folder. */
  reveal: (path: string) => void
  /** Calls `listener` with each piece of news; returns how to stop. */
  listen: (listener: (news: BrowserNews) => void) => () => void
}
