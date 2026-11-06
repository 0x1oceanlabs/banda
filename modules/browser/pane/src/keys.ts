/**
 * The keys of a page (ADR 0013, decision 5). Banda's keys, held with the
 * mod, work in a page as in a terminal, and the browser's own keys are
 * Chrome's, with Ctrl: actions of the scope `browser` (ADR 0071, decision
 * 1), which work while the focus is in a browser Pane or its page.
 * Electron's main process takes the keys in force from the page before it
 * hears them and hands them to the window, where Banda's actions and the
 * browser Pane run them; every other key stays the page's.
 */

import { type Key, matches, type Pressed } from "@banda/ui/lib/keys"
import type { TabKey } from "./tabs"

/** The scope of the browser's keys: its Pane, and the page in it. */
export const BROWSER = "browser"

/** What the browser Pane does on one of its keys. */
export type Does =
  | "address"
  | "reload"
  | "reload-hard"
  | "back"
  | "forward"
  | "zoom-in"
  | "zoom-out"
  | "zoom-reset"
  | "devtools"
  | TabKey

/** The id of the browser's action that does `does`. */
export function actionOf(does: Does): string {
  return `${BROWSER}.${does}`
}

/** A key with Ctrl, or ⌘ on a Mac, as Chrome's are. */
const ctrl = (code: string, shift = false): Key => ({
  code,
  primary: true,
  ...(shift && { shift }),
})

const PLACES = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const

/** The browser's keys, in the key sheet's order: what each does, its
 * title there, and its keys as Chrome has them. */
export const BROWSER_KEYS: readonly {
  does: Does
  title: string
  family?: string
  keys: Key[]
}[] = [
  { does: "tab-new", title: "New tab", keys: [ctrl("KeyT")] },
  {
    does: "tab-close",
    title: "Close the tab",
    keys: [ctrl("KeyW"), ctrl("F4")],
  },
  {
    does: "tab-reopen",
    title: "Open the tab closed last",
    keys: [ctrl("KeyT", true)],
  },
  {
    does: "tab-next",
    title: "Next tab",
    keys: [ctrl("Tab"), ctrl("PageDown")],
  },
  {
    does: "tab-previous",
    title: "Previous tab",
    keys: [ctrl("Tab", true), ctrl("PageUp")],
  },
  ...PLACES.map((n) => ({
    does: `tab-${n}` as const,
    // Chrome's Ctrl+9 is always the last.
    title: n === 9 ? "Go to the last tab" : `Go to tab ${n}`,
    family: "Go to a tab",
    keys: [ctrl(`Digit${n}`)],
  })),
  { does: "address", title: "Go to the address", keys: [ctrl("KeyL")] },
  {
    does: "reload",
    title: "Reload the page",
    keys: [ctrl("KeyR"), { code: "F5" }],
  },
  {
    does: "reload-hard",
    title: "Reload the page, not from the cache",
    keys: [ctrl("KeyR", true)],
  },
  { does: "back", title: "Back", keys: [ctrl("BracketLeft")] },
  { does: "forward", title: "Forward", keys: [ctrl("BracketRight")] },
  {
    does: "zoom-in",
    title: "Zoom the page in",
    keys: [ctrl("Equal"), ctrl("Equal", true)],
  },
  { does: "zoom-out", title: "Zoom the page out", keys: [ctrl("Minus")] },
  {
    does: "zoom-reset",
    title: "The page at its own size",
    keys: [ctrl("Digit0")],
  },
  {
    does: "devtools",
    title: "The page's developer tools",
    keys: [{ code: "F12" }],
  },
]

/**
 * Whether the window takes a key from the page: one of the keys in force
 * there, the window's and the browser's (ADR 0071, decision 4). A key
 * `keys.toml` frees, and the mod's keys alone, stay the page's.
 */
export function taken(
  key: Pressed,
  inForce: readonly Key[],
  mac?: boolean
): boolean {
  return inForce.some((one) => matches(key, one, mac))
}

/** Whether `does` is a key of the tabs, not of the page. */
export function isTabKey(does: Does): does is TabKey {
  return does.startsWith("tab-")
}
