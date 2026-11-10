/**
 * How keys reach the Window's actions: the keys in force, as the Person
 * binds them (ADR 0071, decision 4); the router, which runs the action a
 * key is bound to before any Pane hears it, or hands the key on to a
 * program (ADR 0005, decision 10); the two keys a popped-out Pane's window
 * takes; and Quick Look's Esc. The Window routes the keys (ADR 0087,
 * decision 1): one matcher, `pressFor`, and no App takes another's keys.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { DEFAULT_KEYS, type Mod } from "@banda/contract/look"
import { scopesOf } from "@banda/ui/hooks/use-scope"
import { aPageSaid, holdsAlone, withMore } from "@banda/ui/lib/keys"
import type { Action } from "@banda/ui/module"
import { IN_PROGRAM } from "@banda/ui/pane"
import {
  actionFor,
  actsAsPerson,
  type Held,
  inScope,
  keysInForce,
  pressFor,
  withKeys,
} from "../actions/actions"
import { useLookKeys } from "../look"
import { modules } from "../modules"
import { windowModule } from "../registry"
import { ACTIONS, type Shell as Parts } from "./actions"

/**
 * The actions with the keys in force, as the look makes them (ADR 0071,
 * decision 4): the Person's over their own (keys.toml), but after the
 * reset chord Banda's own, Alt and no line of the Person's, until the
 * file changes. `binds` are the Person's lines in force, `keys` the keys
 * for what names them (ADR 0068, decision 4), and `own` what the reset
 * chord does.
 */
export function useKeys() {
  const lookKeys = useLookKeys()
  const said = JSON.stringify([lookKeys.mod, lookKeys.binds])
  const [shipped, setShipped] = useState<string>()
  const inForce = shipped === said ? DEFAULT_KEYS : lookKeys
  const { mod } = inForce
  const keyed = useMemo(() => withKeys(ACTIONS, inForce.actions), [inForce])
  const keys = useMemo(() => keysInForce(mod, keyed), [mod, keyed])
  const saidNow = useRef(said)
  useEffect(() => {
    saidNow.current = said
  }, [said])
  const own = useCallback(() => setShipped(saidNow.current), [])
  return { mod, binds: inForce.binds, keyed, keys, own }
}

/** The scopes whose keys work with the mod still held too, as the
 * launcher's letters after Alt+N, with the mod in force (`pressFor`). */
const HELD_SCOPES: ReadonlySet<string> = new Set(
  [...modules, windowModule]
    .flatMap((module) => module.scopes)
    .filter((scope) => scope.modHeld)
    .map((scope) => scope.id)
)

function heldBy(mod: Mod): Held {
  return { mod, scopes: HELD_SCOPES }
}

/** The presses the window made to hand a key on, which it leaves alone. */
const HANDED = new WeakSet<Event>()

/**
 * One key more added to a key the window takes hands that key to a
 * program (ADR 0005, decision 10; ADR 0068, decision 3): with Alt the
 * mod, Ctrl+Alt+W reaches a shell as Alt+W. The program reads the press
 * without the key more, as if Banda took nothing, so it comes in whatever
 * form the program asked its terminal for.
 */
function handOn(
  event: KeyboardEvent,
  target: Element | null,
  actions: readonly Action<Parts>[],
  mod: Mod,
  handing: Mod | undefined
): void {
  if (!handing || !holdsAlone(event, handing)) return
  if (!target?.closest(IN_PROGRAM)) return
  const plain = {
    key: event.key,
    code: event.code,
    altKey: mod.alt,
    shiftKey: event.shiftKey,
    ctrlKey: mod.ctrl,
    metaKey: mod.super,
  }
  if (!actionFor(actions, plain)) return
  event.preventDefault()
  event.stopPropagation()
  const handed = new KeyboardEvent("keydown", {
    ...plain,
    bubbles: true,
    cancelable: true,
  })
  HANDED.add(handed)
  target.dispatchEvent(handed)
}

/**
 * The keys run the actions, before any Pane hears them. An open dialog
 * keeps its keys, as the Banda menu its New Thread key, but for the
 * menu's own.
 */
export function useKeyRouter(
  parts: Parts,
  keyed: readonly Action<Parts>[],
  mod: Mod
): void {
  useEffect(() => {
    // One key more and a key Banda takes hand that key to a program.
    const handing = withMore(mod)
    // The launcher's letters still work with the mod held from Alt+N.
    const stillHeld = heldBy(mod)
    const onKey = (event: KeyboardEvent) => {
      // A press the window handed on is the program's, and one an input
      // method is composing with is the field's.
      if (HANDED.has(event) || event.isComposing) return
      const target = event.target instanceof Element ? event.target : null
      // A field that takes a key to bind takes every key.
      if (target?.closest("[data-takes-keys]")) return
      const pressed = pressFor(keyed, event, scopesOf(target), stillHeld)
      if (!pressed) return handOn(event, target, keyed, mod, handing)
      // A press a page in a frame said, as a Visual's, is none of the
      // Person's: it runs no action that acts as them (ADR 0083, decision
      // 3), whatever key the Person bound it to.
      if (aPageSaid(event) && actsAsPerson(pressed.action, pressed.args)) return
      if (inScope(pressed, event)) return
      const { action } = pressed
      // A key that is not its action's now is the Pane's, as F2 a
      // terminal's program's while no Thread has the focus.
      if (action.when && !action.when(parts)) return
      // A dialog that takes the window's keys, as the overview, has only
      // the plain ones of its own. A dialog on its way out, which keeps the
      // focus while nothing else takes it, as the Banda menu with no Pane
      // focused (#1065), leaves the window its keys again.
      const inDialog =
        target?.closest(
          "[role=dialog]:not([data-window-keys]):not([data-closed])"
        ) != null
      if (inDialog && !action.overDialogs) return
      // A terminal leaves alone a key that was taken.
      event.preventDefault()
      event.stopPropagation()
      // Held, it runs what it says it runs then, as an arrow that stops
      // at an edge.
      const held = event.repeat ? action.whenHeld : undefined
      const running = held
        ? (keyed.find((one) => one.id === held) ?? action)
        : action
      running.run(parts, pressed.args)
    }
    window.addEventListener("keydown", onKey, { capture: true })
    return () => window.removeEventListener("keydown", onKey, { capture: true })
  }, [parts, keyed, mod])
}

/**
 * The keys of a Pane in a window of its own (ADR 0025, decision 9): of
 * the window's keys it takes the two that are its Pane's, `close` and
 * `back` to its place, and its scopes' (ADR 0071), as the Composer's
 * Enter.
 */
export function usePoppedKeys(
  keyed: readonly Action<Parts>[],
  mod: Mod,
  close: () => void,
  back: () => void
): void {
  useEffect(() => {
    const own: Record<string, () => void> = {
      "pane.close": close,
      "pane.pop-out": back,
    }
    const stillHeld = heldBy(mod)
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing) return
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest("[data-takes-keys]")) return
      const pressed = pressFor(keyed, event, scopesOf(target), stillHeld)
      if (!pressed || inScope(pressed, event)) return
      const run = own[pressed.action.id]
      if (!run) return
      event.preventDefault()
      event.stopPropagation()
      run()
    }
    window.addEventListener("keydown", onKey, { capture: true })
    return () => window.removeEventListener("keydown", onKey, { capture: true })
  }, [keyed, mod, close, back])
}

/** What takes an Esc before Quick Look's tile: a menu, a dialog or a
 * list of suggestions over it. */
const OVER_PEEK = "[role=menu], [role=dialog], [role=listbox]"

/** While Quick Look shows (ADR 0073, decision 7), Esc closes it, unless a
 * menu or a dialog over it takes the Esc first. */
export function usePeekEsc(peeking: boolean, close: () => void): void {
  useEffect(() => {
    if (!peeking) return
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null
      if (event.key !== "Escape" || target?.closest(OVER_PEEK)) return
      event.preventDefault()
      close()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [peeking, close])
}
