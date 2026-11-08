/**
 * A scope (ADR 0071, decision 1): a kind of Pane, or a field in one, where
 * keys run its own actions. Its element says so (`data-scope`); the window
 * matches a key against the scopes the focus is in, narrowest first, and
 * sends the action to the element, whose handler runs it, or leaves the
 * key to the widget, as an arrow inside a text.
 */
import { useCallback, useEffect, useRef } from "react"
import type { Args } from "../module"
import { focusedTile } from "../pane"

/** What the window sends a scope's element for one of its actions. */
const ACTED = "banda:act"

type Acted = { id: string; args?: Args; event?: KeyboardEvent }

/** Where a press's scopes are found: its target, or with nothing
 * focused, as after a button that went away, the focused Pane's tile. */
function originOf(target: Element | null): Element | null {
  return target && target !== document.body ? target : focusedTile()
}

/** The scopes `target` is in, narrowest first. */
export function scopesOf(target: Element | null): string[] {
  const scopes: string[] = []
  let at = originOf(target)?.closest<HTMLElement>("[data-scope]")
  while (at) {
    if (at.dataset.scope) scopes.push(at.dataset.scope)
    at = at.parentElement?.closest<HTMLElement>("[data-scope]")
  }
  return scopes
}

/**
 * Runs action `id` of `scope` where its key was pressed, or else where
 * the focus is: the scope's element takes it; whether it did. A key's
 * press comes with it, for a handler that leaves it to a widget, as a
 * field's suggestions.
 */
export function actInScope(
  scope: string,
  id: string,
  args?: Args,
  event?: KeyboardEvent
): boolean {
  const from = originOf(
    event?.target instanceof Element ? event.target : document.activeElement
  )
  const at = from?.closest(`[data-scope="${CSS.escape(scope)}"]`)
  return at ? sent(at, { id, args, event }) : false
}

/** Sends `at`, a scope's element, one of its actions; whether its
 * handler took it. */
function sent(at: Element, detail: Acted): boolean {
  const acted = new CustomEvent<Acted>(ACTED, { detail, cancelable: true })
  at.dispatchEvent(acted)
  return acted.defaultPrevented
}

/**
 * Runs action `id` of `scope` as `actInScope` does, else on the focused
 * Pane's tile when it is the scope's: as an action that is not the
 * scope's asks for it, from wherever the focus is, as git's Switch branch
 * the focused Thread's card. Whether it was taken. `scoped()` has no such
 * fallback yet (#865).
 */
export function actOnTile(scope: string, id: string, args?: Args): boolean {
  if (actInScope(scope, id, args)) return true
  const tile = focusedTile()
  return tile?.dataset.scope === scope ? sent(tile, { id, args }) : false
}

/** A scope's handler for one of its actions: whether it took it. With
 * the key's press when a key ran it, none from the Banda menu. */
export type Handler = (args?: Args, event?: KeyboardEvent) => boolean

/** How a scope takes its keys. */
type Taking = {
  /** A key its widgets take first, as Enter in a field's suggestions:
   * taken, and no action runs. */
  owns?: (event: KeyboardEvent) => boolean
  /** A Pane's scope is its whole tile, which the window marks with
   * `data-tile`: a key pressed with the tile itself focused, as after a
   * click on its header, is the Pane's too. */
  tile?: boolean
}

/**
 * Makes an element the scope `scope`, with a handler for each of its
 * actions by id: the ref to give it.
 */
export function useScope(
  scope: string,
  handlers: { readonly [id: string]: Handler },
  { owns, tile = false }: Taking = {}
): (element: HTMLElement | null) => (() => void) | undefined {
  const latest = useRef({ handlers, owns })
  useEffect(() => {
    latest.current = { handlers, owns }
  })
  return useCallback(
    (element: HTMLElement | null) => {
      if (!element) return undefined
      const at = tile
        ? (element.closest<HTMLElement>("[data-tile]") ?? element)
        : element
      at.dataset.scope = scope
      const onActed = (event: Event) => {
        const {
          id,
          args,
          event: pressed,
        } = (event as CustomEvent<Acted>).detail
        const { handlers, owns } = latest.current
        const handler = handlers[id]
        if (!handler) return
        if ((pressed && owns?.(pressed)) || handler(args, pressed))
          event.preventDefault()
      }
      at.addEventListener(ACTED, onActed)
      return () => {
        at.removeEventListener(ACTED, onActed)
        if (at !== element) delete at.dataset.scope
      }
    },
    [scope, tile]
  )
}
