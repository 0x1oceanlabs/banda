/**
 * What Banda's desktop and the browser Pane say to each other
 * (app/desktop/src/browser.ts): the profile pages live in, the keys the
 * desktop takes from them, and the bridge on `window.banda.browser`.
 */
import { type HostOf, invoke, push, send } from "@banda/contract/bridge"
import type { Tabs } from "@banda/contract/browser"

import type { Pressed } from "./keys"

export { isAlt, type Pressed, taken } from "./keys"

/** What the row shows of a page's address: its site, without `www.`. */
export function siteOf(address: string): string {
  try {
    const url = new URL(address)
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.host.replace(/^www\./, "")
    }
    if (url.protocol === "about:") return address
    return url.protocol === "file:"
      ? decodeURIComponent(url.pathname.split("/").pop() || url.pathname)
      : url.protocol.slice(0, -1)
  } catch {
    return address
  }
}

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
  /** An extension opens a tab, or an Agent, which names itself: a Pane
   * takes it, and answers `created` with its page's ID. */
  | { kind: "create"; request: string; url: string; agent?: string }
  /** An extension shows a tab, or closes one. */
  | { kind: "select"; from: number }
  | { kind: "close"; from: number }
  /** An Agent drives the tab over CDP, or no longer does. */
  | { kind: "driven"; from: number; driven: boolean }
  /** A Thread's Agent drives the tab with Banda's tools, by its ID: the
   * step it takes, and where its hands went last; or none does now (ADR
   * 0029, decision 4). */
  | { kind: "driver"; from: number; driver: Driver | null }
  /** The Threads that wait for the Person on the tab (ADR 0029,
   * decision 6). */
  | { kind: "waits"; from: number; waits: readonly Wait[] }

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

/** A Thread that drives a tab, by its Agent: the step it takes, and
 * where its hands went last, in the page's CSS pixels from the top left
 * corner of its view. */
export type Driver = { agent: string; step: string; at?: Point }
export type Point = { x: number; y: number }

/**
 * A Thread that waits for the Person on a tab, by its Agent, and why (ADR
 * 0029, decision 6). Its calls on the tab are refused until the Person
 * answers. It `asked` the Person since then: one they stopped asks once
 * it calls there again and is refused; one that handed the tab over asks
 * at once. A new site waits too, in a later step.
 */
export type Wait = { agent: string; asked?: number } &
  /** The Person stopped it there; they let it drive again. */
  (
    | { reason: "stopped" }
    /** It handed the tab to the Person for a step that is theirs, `why`;
     * they hand it back once done. */
    | { reason: "handoff"; why: string }
  )
export type Handed = Extract<Wait, { reason: "handoff" }>

/** What main answers a call of a Thread's Agent on a tab where a Thread
 * waits for the Person, `wait`: `own` when it is that Thread's own. */
export function refusalOf(tab: number, wait: Wait, own: boolean): string {
  if (!own)
    return `Tab ${tab} is the Person's now, for a step of theirs. Do not use it until they hand it back.`
  switch (wait.reason) {
    case "stopped":
      return `The Person stopped you on tab ${tab}. Do not use it until they let you drive again: say where you stopped and end your turn, and they will tell you.`
    case "handoff":
      return `You handed tab ${tab} to the Person: "${wait.why}". Do not use it until they hand it back: end your turn, and their message says when.`
  }
}

/** What the sidebar's row of a Thread that waits for the Person on a tab
 * says: one they stopped, once it called there again; one that handed the
 * tab over, at once. */
export function callOf(wait: Wait): string {
  switch (wait.reason) {
    case "stopped":
      return "Stopped on a tab: let it drive again there"
    case "handoff":
      return `Your turn in a tab: ${wait.why}`
  }
}

/** A place in Banda's window, in its page's pixels. */
export type Box = { x: number; y: number; width: number; height: number }

/** The extensions' buttons. */
export type Actions = { actions: Action[] }

/**
 * The browser's part of the desktop bridge, on `window.banda.browser`
 * (ADR 0028). The window's table takes it in, which names its leaves
 * (app/web/src/host.ts).
 */
export const BROWSER_BRIDGE = {
  /** Writes where the tabs are into `browser.toml`; the look brings it back. */
  tabs: invoke<[where: Tabs]>(),
  /** Shows a finished download in its folder. */
  reveal: send<[path: string]>(),
  /** Calls `listener` with each piece of news; returns how to stop. */
  listen: push<BrowserNews>(),
  /** The page the Person looks at, for the extensions' active tab. */
  shown: send<[contents: number]>(),
  /** The page made for a `create`; none when no browser could take it. */
  created: send<[request: string, contents: number | null]>(),
  /** Stops the Agents that drive the page: their sessions on it end. */
  stop: send<[contents: number]>(),
  /** Stops the Thread that drives the page with Banda's tools, which
   * then waits until `answered`; the Person's own programs on it go on. */
  release: send<[contents: number]>(),
  /** The Person answered what the Thread of `agent` waits for on the
   * page: it may use the page again. False when it waited no more, as
   * after an answer already given. */
  answered: invoke<[contents: number, agent: string], boolean>(),
  /** The turn of the Thread of `agent` ended: it drives no tab now. */
  settled: send<[agent: string]>(),
  /** Pins an extension's button to the row, or takes it off, in
   * `browser.toml`. */
  pin: invoke<[extension: string, pinned: boolean]>(),
  /** Removes an extension, once the Person says so. */
  remove: invoke<[extension: string]>(),
  actions: {
    /** Shows the button's popup, `url`, under `under`, the button's place
     * in the window; or closes it when it shows. */
    popup: send<[extension: string, url: string, under: Box]>(),
  },
  /** A key main took from a browser page: the preload presses it in the
   * window, so Banda's actions and the Pane hear it as their own; Alt let
   * go is `up`. */
  key: push<Pressed & { up?: true }>(),
}

/** The desktop's side of the browser, on `window.banda.browser`. */
export type BrowserHost = Omit<HostOf<typeof BROWSER_BRIDGE>, "key"> & {
  /** The extensions' buttons, which electron-chrome-extensions answers
   * itself (app/desktop/src/preload.ts). */
  actions: {
    state: () => Promise<Actions>
    /** Clicks a button without a popup: the extension hears it. */
    click: (extension: string, tab: number) => Promise<void>
    /** Calls `listener` when any button changes; returns how to stop. */
    listen: (listener: () => void) => () => void
  }
}
