/**
 * The keys of a page (ADR 0013, decision 5). Banda's keys, held with the
 * mod, work in a page as in a terminal, and the browser's own keys are
 * Chrome's, with Ctrl. Electron's main process takes these from the page before it hears
 * them and hands them to the window, where Banda's actions and the browser
 * Pane run them; every other key stays the page's.
 */

import {
  holdsAlone,
  isModKey,
  type Key,
  matches,
  type Mod,
  type Pressed,
  withMore,
} from "@banda/ui/lib/keys"
import type { TabKey } from "./tabs"

export { isModKey, type Mod, type Pressed }

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
  { code: "KeyT", primary: true, does: "tab-new" },
  { code: "KeyW", primary: true, does: "tab-close" },
  { code: "F4", primary: true, does: "tab-close" },
  { code: "KeyT", primary: true, shift: true, does: "tab-reopen" },
  { code: "Tab", primary: true, does: "tab-next" },
  { code: "PageDown", primary: true, does: "tab-next" },
  { code: "Tab", primary: true, shift: true, does: "tab-previous" },
  { code: "PageUp", primary: true, does: "tab-previous" },
  ...PLACES.map((n) => ({
    code: `Digit${n}`,
    primary: true,
    does: `tab-${n}` as const,
  })),
  { code: "KeyL", primary: true, does: "address" },
  { code: "KeyR", primary: true, does: "reload" },
  { code: "F5", does: "reload" },
  { code: "KeyR", primary: true, shift: true, does: "reload-hard" },
  { code: "BracketLeft", primary: true, does: "back" },
  { code: "BracketRight", primary: true, does: "forward" },
  { code: "Equal", primary: true, does: "zoom-in" },
  { code: "Equal", primary: true, shift: true, does: "zoom-in" },
  { code: "Minus", primary: true, does: "zoom-out" },
  { code: "Digit0", primary: true, does: "zoom-reset" },
  { code: "F12", does: "devtools" },
]

/** What a key does in the browser; none for a key that is the page's. */
export function browserKey(key: Pressed): Does | undefined {
  return BINDS.find((bind) => matches(key, bind))?.does
}

const MODIFIER = /^(Alt|Control|Shift|Meta|OS)(Left|Right)$/

/**
 * Whether the window takes a key from the page: one held with the mod,
 * or with the mod and one key more, which are Banda's (ADR 0068); or one
 * of the browser's. The mod's keys alone stay the page's.
 */
export function taken(key: Pressed, mod: Mod): boolean {
  if (MODIFIER.test(key.code)) return false
  const more = withMore(mod)
  return (
    holdsAlone(key, mod) ||
    (more !== undefined && holdsAlone(key, more)) ||
    browserKey(key) !== undefined
  )
}

/** Whether `does` is a key of the tabs, not of the page. */
export function isTabKey(does: Does): does is TabKey {
  return does.startsWith("tab-")
}
