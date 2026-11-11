/**
 * Keys typed and text pasted in a Thread Pane outside a field go into its
 * composer, as in T3 Code (ADR 0015, decision 4): a click in the Thread
 * leaves the box, and the next words still reach it. A key or a paste
 * something else took, one in a field or on a control, and any while a
 * dialog or a menu is open over it, are left where they were.
 */
import { useEffect, useEffectEvent } from "react"

/** What takes keys of its own. */
const OWN_KEYS = [
  "input",
  "textarea",
  "select",
  "[contenteditable=true]",
  "[contenteditable=plaintext-only]",
  "[role=textbox]",
  "button",
  "a[href]",
  "summary",
  "[role=button]",
  "[role=checkbox]",
  "[role=menuitem]",
  "[role=option]",
  "[role=radio]",
  "[role=switch]",
  "[role=tab]",
  "[role=slider]",
  "[data-takes-keys]",
].join(",")

/** A layer over the window that its keys are for, while it is one: not
 * what a Pane shows in its tile, as a list of files, nor the sidebar's
 * list, which is the window's own and over nothing, nor one lifted or on
 * its way out. */
const OPEN_LAYER =
  ":is([role=dialog],[role=alertdialog],[role=menu],[role=listbox]):not([data-tile] *,aside *,[inert],[data-closed])"

/** Whether `event` is stray in the Pane `box` is in: on it, and no one
 * else's, nor in a field or a control, nor while a layer is open. */
export function stray(event: Event, box: Element): boolean {
  const target = event.target
  if (event.defaultPrevented || !(target instanceof Element)) return false
  if (!box.closest(PANE)?.contains(target) || target.closest(OWN_KEYS))
    return false
  // The Drawer is such a layer, and the Pane in it is under none.
  return [...document.querySelectorAll(OPEN_LAYER)].every((layer) =>
    layer.contains(box)
  )
}

/** A Pane, as the window frames it. */
const PANE = "[data-focused]"

/** The text a stray key types: one character, with no modifier but Shift. */
export function typed(event: KeyboardEvent, box: Element): string | undefined {
  if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey)
    return undefined
  if (event.key.length !== 1 || !stray(event, box)) return undefined
  return event.key
}

/**
 * While `focused`, what is typed or pasted outside a field in the Pane
 * the `box` is in: each key goes to `onKey` first, then a stray one's
 * text to `add`; a stray paste to `onPaste`, and its text to `add`
 * unless `onPaste` took it.
 */
export function useStray(
  box: React.RefObject<Element | null>,
  focused: boolean,
  {
    add,
    onKey,
    onPaste,
  }: {
    add: (text: string) => void
    onKey: (event: KeyboardEvent) => void
    onPaste: (event: ClipboardEvent) => boolean
  }
) {
  const keyed = useEffectEvent((event: KeyboardEvent) => {
    const at = box.current
    if (!at) return
    onKey(event)
    const text = typed(event, at)
    if (text === undefined) return
    event.preventDefault()
    add(text)
  })
  const pasted = useEffectEvent((event: ClipboardEvent) => {
    const at = box.current
    if (!at || !stray(event, at) || onPaste(event)) return
    const text = event.clipboardData?.getData("text/plain")
    if (!text) return
    event.preventDefault()
    add(text)
  })
  useEffect(() => {
    if (!focused) return
    window.addEventListener("keydown", keyed)
    window.addEventListener("paste", pasted)
    return () => {
      window.removeEventListener("keydown", keyed)
      window.removeEventListener("paste", pasted)
    }
  }, [focused])
}
