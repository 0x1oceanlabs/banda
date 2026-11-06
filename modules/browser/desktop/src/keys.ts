/**
 * A browser page's keys in main (ADR 0013, decision 5): Banda's keys,
 * held with the mod, and the browser's own go to the window instead of
 * the page, from a page and an extension's popup alike. Keys a page
 * hears while Banda's hands act in it are theirs, and reach the page
 * alone: only the Person's gesture runs Banda's actions (ADR 0083,
 * decision 3).
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

/**
 * The key Banda's hands send a page now, as they act in it, and what of
 * it the page is not sent: one of Banda's keys in force, or, `all`, any
 * key, sent only to learn whether it is one. `banda` says it was one of
 * Banda's keys. Electron tells a page's `before-input-event` of a key it
 * is sent before `sendInputEvent` returns.
 */
type Holding = { page: number; all: boolean; banda?: true }

let holding: Holding | undefined

/**
 * Takes Banda's keys from `page` for `window`, as the Person presses
 * them. The keys `page` hears while Banda's hands act in it, `byHands`,
 * are theirs, as an Agent's press: they stay the page's, and the window
 * hears none, the mod's either.
 */
export function keys(
  page: WebContents,
  window: WebContents,
  byHands: (page: number) => boolean = () => false
): void {
  page.on("before-input-event", (event, input) => {
    const key: Pressed = {
      code: input.code,
      altKey: input.alt,
      ctrlKey: input.control,
      shiftKey: input.shift,
      metaKey: input.meta,
    }
    const banda = input.type === "keyDown" && taken(key, inForce.keys, MAC)
    if (byHands(page.id)) {
      if (holding?.page !== page.id) return
      if (banda) holding.banda = true
      if (banda || holding.all) event.preventDefault()
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

/** Sends `input` to `page` as Banda's hands act in it, holding back what
 * `all` says; whether it was one of Banda's keys. */
function held(page: WebContents, input: KeyboardInputEvent, all: boolean) {
  const now: Holding = { page: page.id, all }
  holding = now
  try {
    page.sendInputEvent(input)
  } finally {
    holding = undefined
  }
  return now.banda === true
}

/** Sends `input`, a key of a press of Banda's hands, to `page` as they
 * act in it (`byHands`): one of Banda's keys in force there is held back,
 * for the hands to refuse. Says whether it was. */
export function sendPress(
  page: WebContents,
  input: KeyboardInputEvent
): boolean {
  return held(page, input, false)
}

/** Whether `down`, a key's press, is one of Banda's keys in force in
 * `page`, as Electron reads it: `Alt+!` as Alt+Shift+1 too. Sent as
 * Banda's hands act in `page` (`byHands`), the page hears nothing of it. */
export function isBandas(page: WebContents, down: KeyboardInputEvent): boolean {
  return held(page, down, true)
}
