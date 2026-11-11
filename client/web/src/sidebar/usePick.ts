import {
  createContext,
  type FocusEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { flushSync } from "react-dom"
import type { Tab } from "./inbox"
import { pickAfter, pickIn, type Picks, type Step, stepped } from "./pick"

/** The attribute of a stop of the pick in the list: its key. A card has
 * `data-card` too; a folded group `data-group`, its key; "+ N more"
 * `data-more`. */
export const PICK = "data-pick"

/** What the list's items read of the pick: the key picked in the tab in
 * view, to say so, and how "+ N more" shows the rest and picks its first
 * card, as `→` does. */
export const PickContext = createContext<{
  picked?: string
  expand: (stop: Element) => void
}>({ expand: () => {} })

/** The key of a stop that is no card, a folded group or "+ N more": its
 * machine's, as its region's, and its item's in the list. */
export function pieceKey(host: string | undefined, item: string): string {
  return `${host ?? ""}#${item}`
}

/** What a stop of the pick carries, a card or a piece: an id, which
 * `aria-activedescendant` names, its role, its key, and whether it is the
 * one picked, which its ring reads (`globals.css`). */
export function pickProps(key: string, picked: boolean) {
  return {
    id: `sb-p-${key.replace(/[^\w-]/g, "_")}`,
    role: "option",
    "aria-selected": picked,
    [PICK]: key,
    "data-picked": picked ? "" : undefined,
  } as const
}

/** The stops drawn in `list`, in their order: a ghost line, or a card
 * deleted while the list held, is none. */
function stopsIn(list: Element): HTMLElement[] {
  return [...list.querySelectorAll<HTMLElement>(`[${PICK}]`)].filter(
    (stop) => !stop.closest("[inert]")
  )
}

const keyOf = (stop: Element) => stop.getAttribute(PICK)!
const isCard = (stop: Element) => stop.hasAttribute("data-card")

/** How many stops a page moves: those whole in `view`, less one. */
function pageOf(view: Element | null, stops: readonly Element[]): number {
  if (!view) return 1
  const { top, bottom } = view.getBoundingClientRect()
  const whole = stops.filter((stop) => {
    const box = stop.getBoundingClientRect()
    return box.top >= top && box.bottom <= bottom
  }).length
  return Math.max(1, whole - 1)
}

/**
 * The pick in the list (ADR 0098, decision 13; spec §2.7): a key per tab,
 * which the keys act on; the DOM focus stays on the list, which names it
 * by `aria-activedescendant`. The arrows, Home, End and the pages move it
 * from stop to stop, never round the ends; `←` folds the picked card's
 * group and picks it, `→` unfolds a folded group, or shows the rest of a
 * cut list, and picks its first card (`expand`). Coming in, a pick no
 * longer drawn gives way to the open Thread's card, `open`, else the
 * first; gone to a Pane, the pick goes back to `open`. While the list has
 * no focus, the pick follows what opens a Thread; a card picked that
 * leaves the tab hands the pick on to the one below (`pickAfter`), as an
 * act by key does in the keydown (`goneFrom`). `keyed` says the last
 * input in the list was a key, for its ring; a click picks the card it
 * lands on, with none.
 */
export function usePick({
  tab,
  open,
  toggle,
  more,
}: {
  tab: Tab
  /** The open Thread's card, by its key. */
  open: string | undefined
  /** Folds or unfolds the group of that key. */
  toggle: (group: string) => void
  /** Shows a cut list whole. */
  more: () => void
}) {
  const list = useRef<HTMLDivElement>(null)
  const [picks, setPicks] = useState<Picks>({})
  const [keyed, setKeyed] = useState(false)
  const picked = picks[tab]
  const now = useRef({ tab, picked, open })
  useLayoutEffect(() => {
    now.current = { tab, picked, open }
  })
  const pick = useCallback((key: string | undefined) => {
    const { tab } = now.current
    setPicks((was) => (was[tab] === key ? was : { ...was, [tab]: key }))
  }, [])
  const stops = () => (list.current ? stopsIn(list.current) : [])
  const stopOf = (key: string | undefined) =>
    key === undefined ? undefined : stops().find((stop) => keyOf(stop) === key)
  // A move by key brings the pick into view, at once.
  const scroll = useRef(false)
  const moveTo = (key: string | undefined) => {
    scroll.current = true
    pick(key)
  }

  // The card Undo brings back, which takes the pick as it draws.
  const coming = useRef<string>(undefined)

  /** As an act by key takes the card `key` out of the tab: the pick goes
   * on, from the order drawn now (§2.7). */
  const goneFrom = (key: string) => {
    const cards = stops().filter(isCard).map(keyOf)
    moveTo(pickAfter(cards, new Set([key]), key))
  }

  /** Unfolds a folded group, or shows the rest of a cut list, and picks
   * the first card it shows. */
  const expand = (stop: Element) => {
    const group = stop.getAttribute("data-group")
    const own = list.current
    if (!own) return
    // The card it follows: the group's head, or the last before "+ N more".
    const after =
      group !== null
        ? stop
        : stops()
            .filter(isCard)
            .findLast(
              (card) =>
                card.compareDocumentPosition(stop) &
                Node.DOCUMENT_POSITION_FOLLOWING
            )
    flushSync(() => (group !== null ? toggle(group) : more()))
    const first = stopsIn(own).find(
      (card) =>
        isCard(card) &&
        (!after ||
          after.compareDocumentPosition(card) &
            Node.DOCUMENT_POSITION_FOLLOWING)
    )
    if (first) moveTo(keyOf(first))
  }

  /** Folds the group of the card `stop`, where it has one, and picks it. */
  const fold = (stop: Element) => {
    const own = list.current
    if (!own) return
    const head = [...own.querySelectorAll("[data-group]")].findLast(
      (one) =>
        one.compareDocumentPosition(stop) & Node.DOCUMENT_POSITION_FOLLOWING
    )
    const group = head?.getAttribute("data-group")
    if (!head || group == null) return
    flushSync(() => toggle(group))
    const folded = head.getAttribute(PICK)
    if (folded) moveTo(folded)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    setKeyed(true)
    // The list's own keys, while it has the focus itself: a field's or a
    // button's in it are theirs, as is a key the scope took.
    if (event.target !== event.currentTarget || event.defaultPrevented) return
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    const all = stops()
    const at = stopOf(picked)
    const to = (step: Step) => {
      coming.current = undefined
      moveTo(stepped(all.map(keyOf), picked, step))
    }
    // A page is so many stops.
    const page = () =>
      pageOf(
        event.currentTarget.closest("[data-slot=scroll-area-viewport]"),
        all
      )
    switch (event.key) {
      case "ArrowDown":
        to(1)
        break
      case "ArrowUp":
        to(-1)
        break
      case "Home":
        to("first")
        break
      case "End":
        to("last")
        break
      case "PageDown":
        to(page())
        break
      case "PageUp":
        to(-page())
        break
      case "ArrowLeft":
        if (at && isCard(at)) fold(at)
        break
      case "ArrowRight":
        if (at && !isCard(at)) expand(at)
        break
      default:
        return
    }
    // The list's own: the page does nothing else with it.
    event.preventDefault()
  }

  // Coming in from outside, a pick no longer drawn gives way; by Tab, the
  // ring shows at once.
  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return
    setKeyed(event.currentTarget.matches(":focus-visible"))
    if (stopOf(picked)) return
    const keys = stops().map(keyOf)
    pick(pickIn(keys, open, undefined))
  }

  // Gone to a Pane, the pick goes back to the open Thread's card, where
  // the way in takes it (§2.7); one of the list's own popups keeps it.
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    const to = event.relatedTarget
    const { open } = now.current
    if (to instanceof Element && to.closest("[data-tile]") && stopOf(open))
      pick(open)
  }

  // A click picks what it lands on, and the ring goes.
  const onPointerDown = (event: { target: EventTarget }) => {
    setKeyed(false)
    coming.current = undefined
    const stop =
      event.target instanceof Element && event.target.closest(`[${PICK}]`)
    if (stop) pick(keyOf(stop))
  }

  // While the list has no focus, the pick follows what opens a Thread: a
  // click, Alt+U, a toast's button.
  useEffect(() => {
    const own = list.current
    if (!open || !own || own.contains(document.activeElement)) return
    if (stopsIn(own).some((stop) => keyOf(stop) === open)) pick(open)
  }, [open, pick])

  // After each drawing: the list names its pick, which comes into view
  // after a key; a card picked that left the tab hands it on, and one Undo
  // brings back into it takes it.
  const drawn = useRef<{ tab: Tab; cards: readonly string[] }>(undefined)
  useLayoutEffect(() => {
    const own = list.current
    if (!own) return
    const all = stopsIn(own)
    const cards = all.filter(isCard).map(keyOf)
    const at = all.find((stop) => keyOf(stop) === picked)
    const before = drawn.current
    drawn.current = { tab, cards }
    const back = coming.current
    if (before?.tab !== tab) coming.current = undefined
    else if (back !== undefined && cards.includes(back)) {
      coming.current = undefined
      return moveTo(back)
    }
    if (at) {
      own.setAttribute("aria-activedescendant", at.id)
      if (scroll.current) at.scrollIntoView({ block: "nearest" })
    } else own.removeAttribute("aria-activedescendant")
    scroll.current = false
    if (at || picked === undefined || before?.tab !== tab) return
    if (!before.cards.includes(picked)) return
    const gone = new Set(before.cards.filter((key) => !cards.includes(key)))
    pick(pickAfter(before.cards, gone, picked))
  })

  return {
    picked,
    /** The stop picked, as drawn. */
    at: () => stopOf(now.current.picked),
    goneFrom,
    /** As Undo brings the card `key` back: it takes the pick as it draws
     * in this tab, unless a key or a click moves the pick first. */
    back: (key: string) => {
      coming.current = key
    },
    expand,
    /** What goes on the list. */
    list: {
      ref: list,
      "data-keyed": keyed ? "" : undefined,
      onKeyDown,
      onFocus,
      onBlur,
      onPointerDown,
    },
  }
}
