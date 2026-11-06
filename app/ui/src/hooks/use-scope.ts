/**
 * A scope (ADR 0071, decision 1): a kind of Pane, or a field in one, where
 * keys run its own actions. Its element says so (`data-scope`); the window
 * matches a key against the scopes the focus is in, narrowest first, and
 * sends the action to the element, whose handler runs it, or leaves the
 * key to the widget, as an arrow inside a text.
 */
import { useCallback, useEffect, useRef } from "react"
import type { Args } from "../module"

/** What the window sends a scope's element for one of its actions. */
const ACTED = "banda:act"

type Acted = { id: string; args?: Args; event?: KeyboardEvent }

/** The scopes `target` is in, narrowest first. */
export function scopesOf(target: Element | null): string[] {
  const scopes: string[] = []
  let at = target?.closest<HTMLElement>("[data-scope]")
  while (at) {
    if (at.dataset.scope) scopes.push(at.dataset.scope)
    at = at.parentElement?.closest<HTMLElement>("[data-scope]")
  }
  return scopes
}

/**
 * Runs action `id` of `scope` where the focus is: the scope's element
 * takes it; whether it did. A key's press comes with it, for a handler
 * that leaves it to a widget, as a field's suggestions.
 */
export function actInScope(
  scope: string,
  id: string,
  args?: Args,
  event?: KeyboardEvent
): boolean {
  const at = document.activeElement?.closest(
    `[data-scope="${CSS.escape(scope)}"]`
  )
  if (!at) return false
  const acted = new CustomEvent<Acted>(ACTED, {
    detail: { id, args, event },
    cancelable: true,
  })
  at.dispatchEvent(acted)
  return acted.defaultPrevented
}

/** A scope's handler for one of its actions: whether it took it. With
 * the key's press when a key ran it, none from the Banda menu. */
export type Handler = (args?: Args, event?: KeyboardEvent) => boolean

/**
 * Makes an element the scope `scope`, with a handler for each of its
 * actions by id: the ref to give it. A key its widgets take first, as
 * Enter in a field's suggestions, `owns` says, and takes: no action runs.
 */
export function useScope(
  scope: string,
  handlers: { readonly [id: string]: Handler },
  owns?: (event: KeyboardEvent) => boolean
): (element: HTMLElement | null) => (() => void) | undefined {
  const latest = useRef({ handlers, owns })
  useEffect(() => {
    latest.current = { handlers, owns }
  })
  return useCallback(
    (element: HTMLElement | null) => {
      if (!element) return undefined
      element.dataset.scope = scope
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
      element.addEventListener(ACTED, onActed)
      return () => element.removeEventListener(ACTED, onActed)
    },
    [scope]
  )
}
