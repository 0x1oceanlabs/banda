/**
 * The keys of a page (ADR 0013, decision 5). Banda's left Alt binds work in
 * a page as in a terminal, and the browser's own keys are Chrome's, with
 * Ctrl. Electron's main process takes these from the page before it hears
 * them and hands them to the window, where Banda's actions and the browser
 * Pane run them; every other key stays the page's.
 */

import { type Key, matches, type Pressed } from "@banda/ui/lib/keys"
import type { TabKey } from "./tabs"

export type { Pressed }

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

const PLACES = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const

const BINDS: readonly (Key & { does: Does })[] = [
  { code: "KeyT", ctrl: true, does: "tab-new" },
  { code: "KeyW", ctrl: true, does: "tab-close" },
  { code: "F4", ctrl: true, does: "tab-close" },
  { code: "KeyT", ctrl: true, shift: true, does: "tab-reopen" },
  { code: "Tab", ctrl: true, does: "tab-next" },
  { code: "PageDown", ctrl: true, does: "tab-next" },
  { code: "Tab", ctrl: true, shift: true, does: "tab-previous" },
  { code: "PageUp", ctrl: true, does: "tab-previous" },
  ...PLACES.map((n) => ({
    code: `Digit${n}`,
    ctrl: true,
    does: `tab-${n}` as const,
  })),
  { code: "KeyL", ctrl: true, does: "address" },
  { code: "KeyR", ctrl: true, does: "reload" },
  { code: "F5", does: "reload" },
  { code: "KeyR", ctrl: true, shift: true, does: "reload-hard" },
  { code: "BracketLeft", ctrl: true, does: "back" },
  { code: "BracketRight", ctrl: true, does: "forward" },
  { code: "Equal", ctrl: true, does: "zoom-in" },
  { code: "Equal", ctrl: true, shift: true, does: "zoom-in" },
  { code: "Minus", ctrl: true, does: "zoom-out" },
  { code: "Digit0", ctrl: true, does: "zoom-reset" },
  { code: "F12", does: "devtools" },
]

/** What a key does in the browser; none for a key that is the page's. */
export function browserKey(key: Pressed): Does | undefined {
  return BINDS.find((bind) => matches(key, bind))?.does
}

const MODIFIER = /^(Alt|Control|Shift|Meta|OS)(Left|Right)$/

/**
 * Whether the window takes a key from the page: one held with Alt, which
 * is Banda's, or one of the browser's. Alt alone stays the page's.
 */
export function taken(key: Pressed): boolean {
  if (MODIFIER.test(key.code)) return false
  return key.altKey || browserKey(key) !== undefined
}

/** Whether `does` is a key of the tabs, not of the page. */
export function isTabKey(does: Does): does is TabKey {
  return does.startsWith("tab-")
}
