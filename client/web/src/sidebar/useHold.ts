import {
  createContext,
  type KeyboardEvent,
  type UIEvent,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type WheelEvent,
} from "react"
import { useKeyOf } from "@banda/ui/hooks/use-key-of"
import { actionFor } from "../actions/actions"
import type { Row } from "./arrange"
import {
  type By,
  CALM,
  heldUntil,
  type Holders,
  holdersAfter,
  HOLDING_KEYS,
  MOVING_KEYS,
  NO_HOLDERS,
} from "./hold"
import { itemActionsOf } from "./items"
import { useLaterAnchor } from "./LaterPicker"
import type { Undoable } from "./undo"

/** Where the list's scroller says it is the list, for what holds it. */
export const LIST = "data-sidebar-list"

/** What the list's parts hold it by: a popup anchored in it holds it
 * while open (`take` gives back how to let go); an act on a card is the
 * Person's own (`act`), with what takes it back where its ghost line
 * offers Undo; and for a moment after one by key closed a slot, the card
 * actions under the pointer take no click (`quiet`). None outside the
 * Sidebar. */
export type Holding = {
  take: () => () => void
  act: (row: Row, by?: By, undo?: Undoable) => void
  quiet: () => boolean
}

export const HoldingContext = createContext<Holding | undefined>(undefined)

/** Holds the list while `open`, as a popup anchored in it does. */
export function useHoldWhile(open: boolean): void {
  const holding = useContext(HoldingContext)
  useEffect(
    () => (open && holding ? holding.take() : undefined),
    [open, holding]
  )
}

/**
 * The Person's keys on the Thread they look at, as Alt+S archives it, are
 * their own acts on its card too, which the list draws at once (ADR 0098,
 * decision 6): `act` is told of each, by its key; one that leaves the
 * card where it stands, as F2, moves nothing (`hold`). `current` is that
 * Thread's row, in whichever tab it stands.
 */
export function useOwnKeys(current: Row | undefined, holding: Holding): void {
  const keyOf = useKeyOf()
  const now = useRef({ current, keyOf })
  useLayoutEffect(() => {
    now.current = { current, keyOf }
  })
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      const { current: row, keyOf: keyFor } = now.current
      if (!row || event.isComposing) return
      // Its item actions, with the keys in force: the one the press runs.
      const own = actionFor(
        itemActionsOf(row.listed).map((action) => {
          const key = keyFor(action.id)
          return { ...action, keys: key ? [key] : [] }
        }),
        event
      )
      if (own) holding.act(row, "key")
    }
    window.addEventListener("keydown", onKey, { capture: true })
    return () => window.removeEventListener("keydown", onKey, { capture: true })
  }, [holding])
}

/**
 * Whether the list holds still (ADR 0098, decision 6; `hold.ts`): while
 * the pointer is over its scroller, a popup anchored in it is open, for
 * 2 s after a list key while it has the focus, and in check mode
 * (`checking`, S10b); until 150 ms after the last of those ends, and not
 * once the window is blurred or hidden, until the pointer comes back over
 * the list. `list` goes on the scroller, which is calm for a moment
 * after a wheel, a scroll or a key that moves in it; `by` says how the
 * Person last acted in it, by a key or the pointer.
 */
export function useHold(checking = false) {
  const holders = useRef<Holders>(NO_HOLDERS)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const by = useRef<By>("pointer")
  const calm = useRef<ReturnType<typeof setTimeout>>(undefined)
  const [holding, setHolding] = useState(false)
  // Each change of what holds says again whether the list holds, and
  // until when: with no other change by then, it lets go then.
  const change = useCallback((made: Partial<Holders>) => {
    const now = performance.now()
    holders.current = holdersAfter(holders.current, made, now)
    clearTimeout(timer.current)
    const until = heldUntil(holders.current)
    setHolding(until > now)
    if (until > now && until < Infinity)
      timer.current = setTimeout(() => setHolding(false), until - now)
  }, [])
  const take = useCallback(() => {
    change({ popups: holders.current.popups + 1 })
    let held = true
    return () => {
      if (held) change({ popups: holders.current.popups - 1 })
      held = false
    }
  }, [change])
  // The window blurred or hidden lets go at once, as when a browser Pane
  // takes the focus, until the pointer comes back over the list; the
  // pointer that left the window, as after a drag out of it, has left
  // the list.
  useEffect(() => {
    const away = () => change({ away: true, pointer: false })
    const back = () => change({ away: false })
    const shown = () => (document.hidden ? away() : back())
    const out = (event: MouseEvent) => {
      if (!event.relatedTarget) change({ pointer: false })
    }
    addEventListener("blur", away)
    addEventListener("focus", back)
    document.addEventListener("visibilitychange", shown)
    document.addEventListener("mouseout", out)
    return () => {
      removeEventListener("blur", away)
      removeEventListener("focus", back)
      document.removeEventListener("visibilitychange", shown)
      document.removeEventListener("mouseout", out)
      clearTimeout(timer.current)
      clearTimeout(calm.current)
    }
  }, [change])
  // After a wheel, a scroll or a key that moves in it, the list is calm
  // for a moment: a card the pointer did not go to, come under it, shows
  // no actions (spec S7a). Its attribute alone says so, to the CSS, and
  // nothing is drawn again.
  const settle = useCallback((list: Element) => {
    list.setAttribute("data-calm", "")
    clearTimeout(calm.current)
    calm.current = setTimeout(() => list.removeAttribute("data-calm"), CALM)
  }, [])
  // The Later picker, open at a card, holds the list while it is.
  const anchor = useLaterAnchor()
  const picking = !!anchor?.closest(`[${LIST}]`)
  useEffect(() => (picking ? take() : undefined), [picking, take])
  useEffect(() => change({ checking }), [checking, change])
  const byNow = useCallback(() => by.current, [])
  return {
    holding,
    take,
    by: byNow,
    /** What the list's scroller listens to. */
    list: {
      [LIST]: "",
      onPointerEnter: () => change({ pointer: true, away: false }),
      onPointerMove: () => {
        if (!holders.current.pointer) change({ pointer: true, away: false })
      },
      onPointerLeave: () => change({ pointer: false }),
      onPointerDownCapture: () => {
        by.current = "pointer"
      },
      onWheel: (event: WheelEvent) => settle(event.currentTarget),
      onScrollCapture: (event: UIEvent) => settle(event.currentTarget),
      onKeyDownCapture: (event: KeyboardEvent) => {
        by.current = "key"
        const plain = !event.altKey && !event.ctrlKey && !event.metaKey
        if (plain && HOLDING_KEYS.has(event.code))
          change({ keyed: performance.now() })
        if (MOVING_KEYS.has(event.code)) settle(event.currentTarget)
      },
    },
  }
}
