/**
 * A browser page's keys in main (ADR 0013, decision 5): Banda's keys,
 * held with the mod, and the browser's own go to the window instead of
 * the page, from a page and an extension's popup alike. Keys Banda's
 * hands send a page reach the page alone: only the Person's gesture runs
 * Banda's actions (ADR 0083, decision 3).
 */
import {
  BROWSER_BRIDGE,
  isModKey,
  type PageKeys,
  type Pressed,
  taken,
} from "@banda/browser-pane/desktop"
import { DEFAULT_KEYS } from "@banda/contract/look"
import { tellPage } from "@banda/desktop-kit"
import type { KeyboardInputEvent, WebContents } from "electron"

/** The keys in force in a page, as the window tells them (ADR 0071,
 * decision 4): none taken until it does. */
let inForce: PageKeys = { mod: DEFAULT_KEYS.mod, keys: [] }

/** Keeps the keys in force in a page, as the window tells them. */
export function keepInForce(keys: PageKeys): void {
  inForce = keys
}

const MAC = process.platform === "darwin"

/** Which of the hands' keys the page is not sent: none, one of Banda's
 * keys in force, or every key, sent only to learn whether it is one. */
type Held = "none" | "bandas" | "all"

/**
 * What Banda's hands send now. Electron tells a page's
 * `before-input-event` of a key it is sent before `sendInputEvent`
 * returns, and no key of the Person's comes in while it runs: a key heard
 * meanwhile is the hands'. `banda` says it was one of Banda's keys, held
 * back.
 */
type Sending = { held: Held; banda?: true }

let sending: Sending | undefined

/** Takes Banda's keys from `page` for `window`, as the Person presses
 * them; the hands' keys stay the page's. */
export function keys(page: WebContents, window: WebContents): void {
  page.on("before-input-event", (event, input) => {
    const key: Pressed = {
      code: input.code,
      altKey: input.alt,
      ctrlKey: input.control,
      shiftKey: input.shift,
      metaKey: input.meta,
    }
    const banda = input.type === "keyDown" && taken(key, inForce.keys, MAC)
    // The window hears none of the hands' keys, not even the mod's.
    if (sending) {
      if (sending.held === "none") return
      if (banda) sending.banda = true
      if (banda || sending.held === "all") event.preventDefault()
      return
    }
    // A key of the mod pressed or let go stays the page's, and the window
    // hears it too: with it held, the mouse moves and sizes Panes over a
    // page as well (ADR 0025, decisions 5 and 6).
    if (isModKey(input.code, inForce.mod)) {
      if (!input.isAutoRepeat) {
        tellPage(window, BROWSER_BRIDGE.key, {
          ...key,
          page: page.id,
          ...(input.type === "keyUp" && { up: true as const }),
        })
      }
      return
    }
    if (!banda) return
    event.preventDefault()
    tellPage(window, BROWSER_BRIDGE.key, { ...key, page: page.id })
  })
}

/** Sends `input` to `page` as the hands do, holding back what `held`
 * says; whether it was one of Banda's keys. */
function sent(page: WebContents, input: KeyboardInputEvent, held: Held) {
  const now: Sending = { held }
  sending = now
  try {
    page.sendInputEvent(input)
  } finally {
    sending = undefined
  }
  return now.banda === true
}

/** Sends `input` to `page` as Banda's hands do: to the page alone. With
 * `refuse`, one of Banda's keys in force there is held back, for the
 * hands to refuse: says whether it was. */
export function sendAlone(
  page: WebContents,
  input: KeyboardInputEvent,
  { refuse }: { refuse: boolean }
): boolean {
  return sent(page, input, refuse ? "bandas" : "none")
}

/** Whether `down`, a key's press, is one of Banda's keys in force in
 * `page`, as Electron reads it: `Alt+!` as Alt+Shift+1 too. The page
 * hears nothing of it. */
export function isBandas(page: WebContents, down: KeyboardInputEvent): boolean {
  return sent(page, down, "all")
}
