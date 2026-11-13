/**
 * The Top layer's one stack (ADR 0110, step 3): what shows over the
 * Panes, which of it is on top, what Esc takes away, and where the keys
 * go back as a part of it goes. Each part says its layer and how it
 * closes; nothing but the stack works out who is over whom.
 *
 * Esc. The stack hears an Esc last, at the window, so whoever keeps one
 * for itself stops it and the stack never hears it: a field, as a find
 * bar; a Pane's own key, which the keys' router stops; a terminal's
 * program; a menu, a select or a dialog of Banda UI, which closes itself
 * and stops the Esc it took. All of Banda UI's are on the layer `top`,
 * over every part the stack closes, so they go first. An Esc an input
 * method composes with is the field's. The rest takes away the part on
 * top, one for each Esc.
 *
 * The keys. The stack remembers where they last were on each level: in
 * each part that takes them, and under them all, in a Pane's tile or a
 * field of the Sidebar. As a part goes while it has the focus, or left it
 * nowhere, they go back to the level now on top, at that place, with the
 * caret where it was: a field in the Sheet under a menu, the message of
 * the Thread in front. With the place gone, they go to the part's root,
 * or to the Pane in front. What took the focus meanwhile, as a Pane a
 * menu's row opened, keeps it.
 */
import { FIELDS } from "@banda/ui/lib/keys"
import { tileInFront } from "@banda/ui/pane"
import { heightOf, type Layer } from "./layers"

/** What a part of the Top layer says of itself while it shows. */
export type Shown = {
  /** Its name, which its root on the page says too, as `data-top`. */
  part: string
  /** The layer it lies on. */
  layer: Layer
  /** Whether it takes the keys while it shows. Quick Look does not: the
   * Pane it was opened from keeps them. */
  keys: boolean
  /** Takes it away, as Esc does. A part that closes on its own Esc and
   * stops it, as a dialog of Banda UI, gives none. */
  close?: () => void
}

/** A part's root says its name. */
const PART = "[data-top]"

/** Under the Top layer the keys stay in a Pane's tile, or in a field of
 * the Sidebar; a button pressed on the way, as its gear, is not a place
 * they stay. */
function staysAt(element: HTMLElement): boolean {
  return (
    element.closest("[data-tile]") !== null ||
    (element.matches(FIELDS) && inSidebar(element))
  )
}

function inSidebar(element: HTMLElement): boolean {
  return element.closest("[data-sidebar]") !== null
}

/** The overview while it is open: under it the tiles take no keys. */
const OPEN_OVERVIEW = '[data-overview-state="open"]'

function rootOf(part: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-top="${CSS.escape(part)}"]`)
}

/** Who has the keys under the Top layer: the open overview, else the
 * tile of the Pane in front. The lifted Drawer's own is inert. */
function under(): HTMLElement | null {
  return document.querySelector<HTMLElement>(OPEN_OVERVIEW) ?? tileInFront()
}

/** What has the focus; none while it is nowhere. */
function focusNow(): Element | null {
  const at = document.activeElement
  return at && at !== document.body ? at : null
}

/** A place the keys were: the element as the page has it, the one in it
 * that had the focus, where it draws in a tree of its own, as the file
 * tree does, and the caret as it was when the focus left a text edited
 * in place, as a message: a field that takes the focus takes the page's
 * selection too. */
type Place = { at: HTMLElement; inner: HTMLElement; caret?: Range }

/** Puts the caret back where it was, if that text is still there. */
function putCaret(caret: Range | undefined) {
  if (!caret?.startContainer.isConnected) return
  const selection = document.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(caret)
}

export class Stack {
  /** What shows, in the order it came. */
  #shown: Shown[] = []
  /** Where the keys last were in each part. */
  #places = new Map<string, Place>()
  /** Where they last were under them all (`staysAt`). */
  #home: Place | undefined

  /** Follows the page for as long as the Window lives: where the keys
   * go, and Esc, which it hears last. Gives what stops it. */
  follow(): () => void {
    this.#heard(document.activeElement, document.activeElement)
    const onFocus = (event: FocusEvent) =>
      this.#heard(event.target, event.composedPath()[0] ?? null)
    const onBlur = (event: FocusEvent) => this.#left(event.target)
    const onKey = (event: KeyboardEvent) => this.esc(event)
    document.addEventListener("focusin", onFocus, true)
    document.addEventListener("focusout", onBlur, true)
    window.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("focusin", onFocus, true)
      document.removeEventListener("focusout", onBlur, true)
      window.removeEventListener("keydown", onKey)
    }
  }

  /** A part shows. Gives what it calls as it goes, which gives the keys
   * back where they were. */
  show(shown: Shown): () => void {
    this.#shown.push(shown)
    return () => {
      this.#shown = this.#shown.filter((one) => one !== shown)
      this.#back(rootOf(shown.part))
      this.#places.delete(shown.part)
    }
  }

  /** The part on top: on the highest layer, the last that came there. */
  onTop(): Shown | undefined {
    return this.#highest(this.#shown)
  }

  /** An Esc nothing kept takes the part on top away; one that closes
   * itself has taken its own already. */
  esc(event: KeyboardEvent): void {
    if (event.key !== "Escape" || event.isComposing) return
    const close = this.onTop()?.close
    if (!close) return
    event.preventDefault()
    close()
  }

  /** Where the keys are, by the stack: the place they last were in the
   * highest part that takes them, else under them all, if it is still
   * there; and what they fall to with that place gone: the part's root,
   * or the tile of the Pane in front, none with no Pane. */
  #level(): { place?: Place; root: HTMLElement | null } {
    const holder = this.#highest(this.#shown.filter((one) => one.keys))
    const root = holder ? rootOf(holder.part) : under()
    const place = holder ? this.#places.get(holder.part) : this.#home
    const there =
      place?.at.isConnected &&
      (root?.contains(place.at) || (!holder && inSidebar(place.at)))
    return { place: there ? place : undefined, root }
  }

  #highest(parts: readonly Shown[]): Shown | undefined {
    return parts.reduce<Shown | undefined>(
      (top, one) =>
        top && heightOf(top.layer) > heightOf(one.layer) ? top : one,
      undefined
    )
  }

  #heard(target: EventTarget | null, inner: EventTarget | null) {
    if (!(target instanceof HTMLElement)) return
    const place = {
      at: target,
      inner: inner instanceof HTMLElement ? inner : target,
    }
    const part = target.closest(PART)?.getAttribute("data-top")
    if (part) this.#places.set(part, place)
    else if (staysAt(target)) this.#home = place
  }

  /** The focus leaves `target`: the place there keeps its caret. */
  #left(target: EventTarget | null) {
    const place = [this.#home, ...this.#places.values()].find(
      (one) => one?.at === target
    )
    const selection = document.getSelection()
    if (!place || !selection || selection.rangeCount === 0) return
    const caret = selection.getRangeAt(0)
    if (place.inner.contains(caret.startContainer))
      place.caret = caret.cloneRange()
  }

  /** As the part at `root` goes, the keys go back, unless something
   * outside it has them. With nowhere to go, they stay in it while it
   * fades, so the window's keys work meanwhile (#1065). */
  #back(root: HTMLElement | null) {
    const lost = () => {
      const at = focusNow()
      return !at || root?.contains(at) === true
    }
    if (!lost()) return
    const { place, root: level } = this.#level()
    for (const to of [place?.inner, place?.at, level, root]) {
      to?.focus({ preventScroll: true })
      if (lost()) continue
      if (to === place?.inner) putCaret(place?.caret)
      return
    }
  }
}

/** The Window's stack: one Window is one page. */
export const top = new Stack()
