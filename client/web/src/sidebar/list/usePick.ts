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
import { useStore } from "@banda/core/react"
import type { Tab } from "../model/inbox"
import { pickAfter, pickIn, type Step, stepped } from "../model/pick"
import { pickedOf, type SidebarView, tabInView } from "./view"

/** The attribute of a stop of the pick in the list: its key. A card has
 * `data-card` too, a Project's card among them; a group's header
 * `data-group`, its key, and `aria-expanded`; "+ N more" `data-more`. */
export const PICK = "data-pick"

/** How "+ N more" shows the rest and picks its first card, as `→` does:
 * the pick's, which works on the list as it is drawn; none outside one.
 * The key picked, the items read in the list's view (`pickedOf`). */
export const Expand = createContext<(stop: Element) => void>(() => {})

/** The key of a stop that is no Thread's card, a group's header, "+ N
 * more" or a Project's card: its machine's, as its region's, and its
 * item's in the list. */
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

/** The stops drawn in `list`, in their order. */
function stopsIn(list: Element): HTMLElement[] {
  return [...list.querySelectorAll<HTMLElement>(`[${PICK}]`)]
}

const keyOf = (stop: Element) => stop.getAttribute(PICK)!
const isCard = (stop: Element) => stop.hasAttribute("data-card")
/** Whether `stop` is a group's header that shows what it holds. */
const unfolded = (stop: Element) =>
  stop.getAttribute("aria-expanded") === "true"

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
 * kept in the list's view, which the keys act on; the DOM focus stays on the list, which names it
 * by `aria-activedescendant`. The arrows, Home, End and the pages move it
 * from stop to stop, never round the ends; `←` folds the picked card's
 * group and picks its header, or the header picked; `→` unfolds a folded
 * group, or shows the rest of a cut list, and picks its first card
 * (`expand`), and from an unfolded header goes on to it. Coming in, a pick no
 * longer drawn gives way to the open Thread's card, `open`, else the
 * first; gone to a Pane, the pick goes back to `open`. While the list has
 * no focus, the pick follows what opens a Thread; a card picked that
 * leaves the tab hands the pick on to the one below (`pickAfter`), as an
 * act by key does in the keydown (`goneFrom`). `keyed` says the last
 * input in the list was a key, for its ring; a click picks the card it
 * lands on, with none.
 */
export function usePick({
  view,
  open,
}: {
  /** The list's view, which keeps the pick, folds a group and shows a
   * cut list whole. */
  view: SidebarView
  /** The open Thread's card, by its key. */
  open: string | undefined
}) {
  const { toggle, toggleMore: more } = view
  const list = useRef<HTMLDivElement>(null)
  const tab = useStore(view, tabInView)
  const picked = useStore(view, pickedOf)
  const [keyed, setKeyed] = useState(false)
  const now = useRef({ tab, picked, open })
  useLayoutEffect(() => {
    now.current = { tab, picked, open }
  })
  const pick = useCallback(
    (key: string | undefined) => view.pick(now.current.tab, key),
    [view]
  )
  const stops = () => (list.current ? stopsIn(list.current) : [])
  const stopOf = (key: string | undefined) =>
    key === undefined ? undefined : stops().find((stop) => keyOf(stop) === key)
  // A move by key brings the pick into view, at once.
  const scroll = useRef(false)
  const moveTo = (key: string | undefined) => {
    scroll.current = true
    pick(key)
  }

  /** As an act by key takes the card `gone` out of the tab: the pick
   * goes on, from the order drawn now (§2.7), where it was on it. */
  const goneFrom = (gone: string) => {
    const { picked } = now.current
    if (picked === undefined) return
    const cards = stops().filter(isCard).map(keyOf)
    moveTo(pickAfter(cards, new Set([gone]), picked))
  }

  /** Unfolds a folded group, or shows the rest of a cut list, and picks
   * the first card it shows. */
  const expand = (stop: Element) => {
    const group = stop.getAttribute("data-group")
    // "↳ + N more at work" unfolds its parent's children (decision 24).
    const unfold = stop.getAttribute("data-unfold")
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
    flushSync(() =>
      group !== null ? toggle(group) : unfold !== null ? toggle(unfold) : more()
    )
    const first = stopsIn(own).find(
      (card) =>
        isCard(card) &&
        (!after ||
          after.compareDocumentPosition(card) &
            Node.DOCUMENT_POSITION_FOLLOWING)
    )
    if (first) moveTo(keyOf(first))
  }

  /** Folds the group whose header is `stop`: the pick stays on it. */
  const shut = (stop: Element) => {
    const group = stop.getAttribute("data-group")
    if (group !== null) toggle(group)
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

  /** Moves the pick by `step` among the stops drawn. */
  const to = (step: Step) => {
    moveTo(stepped(stops().map(keyOf), picked, step))
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    setKeyed(true)
    // The list's own keys, while it has the focus itself: a field's or a
    // button's in it are theirs, as is a key the scope took.
    if (event.target !== event.currentTarget || event.defaultPrevented) return
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    const all = stops()
    const at = stopOf(picked)
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
        else if (at && unfolded(at)) shut(at)
        break
      case "ArrowRight":
        if (at && unfolded(at)) to(1)
        else if (at && !isCard(at)) expand(at)
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
  // after a key; a card picked that left the tab hands it on.
  const drawn = useRef<{ tab: Tab; cards: readonly string[] }>(undefined)
  useLayoutEffect(() => {
    const own = list.current
    if (!own) return
    const all = stopsIn(own)
    const cards = all.filter(isCard).map(keyOf)
    const at = all.find((stop) => keyOf(stop) === picked)
    const before = drawn.current
    drawn.current = { tab, cards }
    if (at) own.setAttribute("aria-activedescendant", at.id)
    else own.removeAttribute("aria-activedescendant")
    if (at && scroll.current) at.scrollIntoView({ block: "nearest" })
    scroll.current = false
    if (at || picked === undefined || before?.tab !== tab) return
    if (!before.cards.includes(picked)) return
    const gone = new Set(before.cards.filter((key) => !cards.includes(key)))
    pick(pickAfter(before.cards, gone, picked))
  })

  return {
    /** The stop picked, as drawn. */
    at: () => stopOf(now.current.picked),
    goneFrom,
    expand,
    /** Moves the pick by `step`, as the small inbox puts it on its first
     * card. */
    step: to,
    /** What Enter does on a stop that is no card: a group's header folds
     * or unfolds, and "+ N more" shows the rest (`expand`). */
    enter: (stop: Element) => (unfolded(stop) ? shut(stop) : expand(stop)),
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
