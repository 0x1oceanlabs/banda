import {
  type KeyboardEvent,
  type UIEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  type WheelEvent,
} from "react"
import type { ProjectSummary } from "@banda/contract"
import { useLaterClock, useLists } from "../../calls/stores"
import { type SidebarInput, sidebarOf } from "../model/drawn"
import type { Item } from "../model/flat"
import { useElsewhere } from "../model/order"
import type { Settings } from "../model/settings"
import { stillOf } from "../model/still"
import { useNotNow } from "../../trust/not-now"

/** How long no card shows its actions by the pointer after a wheel, a
 * scroll or a key that moves in the list, in ms (spec S7a): a card that
 * comes under a still pointer is not one it went to. */
const CALM = 300

/** The keys that move in the list, by their codes. */
const MOVING_KEYS: ReadonlySet<string> = new Set([
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
])

/**
 * What the sidebar draws (`sidebarOf`) of what the Window's stores hold:
 * what every module lists, read by the Later clock; the other machines
 * the order places; and this machine's Projects that wait for the Person,
 * but those whose trust they put off on this device; as `settings` and
 * `view` have it. The bar's counts read it as the list does.
 */
export function useDrawn(
  projects: readonly ProjectSummary[],
  settings: SidebarInput["settings"],
  { tab, more, folded, someday }: SidebarInput["view"]
) {
  // What every module lists, from the Window's items.
  const lists = useLists()
  // Where each Thread stands is read by the Later clock (ADR 0074).
  const now = useLaterClock()
  // The other machines of `hosts.toml` (ADR 0081): the rows of those the
  // order places, as Alt+U places them.
  const elsewhere = useElsewhere()
  const putOff = useNotNow()
  const drawn = useMemo(
    () =>
      sidebarOf({
        lists,
        now,
        projects,
        elsewhere,
        settings,
        putOff,
        view: { tab, more, folded, someday },
      }),
    [
      lists,
      now,
      projects,
      elsewhere,
      settings,
      putOff,
      tab,
      more,
      folded,
      someday,
    ]
  )
  return { drawn, now, putOff }
}

/**
 * The sidebar list as it is drawn (`useDrawn`), as the Person has it in
 * view: the tab, a cut list whole (`more`), the groups folded, and when
 * inbox zero last told of Someday. It is drawn as it is, but for one rule
 * (ADR 0098, decision 6; `still.ts`): while the pointer is over the list,
 * its order stays as it was drawn, so no card runs out from under a
 * click. Another view by the Person's hand is drawn at once, under the
 * pointer too. `list` goes on the list's scroller, which is calm for a
 * moment after a wheel, a scroll or a key that moves in it; `now` is the
 * Later clock its words read.
 */
export function useOrdered(
  projects: readonly ProjectSummary[],
  settings: Settings,
  view: SidebarInput["view"]
) {
  const { tab, more, folded } = view
  const { drawn: fresh, now, putOff } = useDrawn(projects, settings, view)
  // The list as it was drawn when the pointer came over it; none while
  // the pointer is elsewhere.
  const [under, setUnder] = useState<readonly Item[]>()
  // Another view, by the Person's hand, draws its order straight away;
  // so does a Project's trust they put off, which only their hand does.
  const [scene, setScene] = useState({ tab, more, folded, settings, putOff })
  if (
    scene.tab !== tab ||
    scene.more !== more ||
    scene.folded !== folded ||
    scene.settings !== settings ||
    scene.putOff !== putOff
  ) {
    setScene({ tab, more, folded, settings, putOff })
    if (under) setUnder(fresh.items)
  }
  // The window blurred or hidden lets go, so the order never sticks; the
  // pointer that moves over the list again keeps it again.
  useEffect(() => {
    const away = () => setUnder(undefined)
    const hidden = () => document.hidden && away()
    addEventListener("blur", away)
    document.addEventListener("visibilitychange", hidden)
    return () => {
      removeEventListener("blur", away)
      document.removeEventListener("visibilitychange", hidden)
    }
  }, [])
  const items = useMemo(
    () => (under ? stillOf(under, fresh.items) : fresh.items),
    [under, fresh]
  )
  // After a wheel, a scroll or a key that moves in it, the list is calm
  // for a moment (spec S7a). Its attribute alone says so, to the CSS, and
  // nothing is drawn again.
  const calm = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(calm.current), [])
  const settle = (list: Element) => {
    list.setAttribute("data-calm", "")
    clearTimeout(calm.current)
    calm.current = setTimeout(() => list.removeAttribute("data-calm"), CALM)
  }
  const over = () => {
    if (!under) setUnder(items)
  }
  return {
    ordered: { ...fresh, items },
    now,
    /** What the list's scroller listens to. */
    list: {
      "data-sidebar-list": "",
      onPointerEnter: over,
      onPointerMove: over,
      onPointerLeave: () => setUnder(undefined),
      onWheel: (event: WheelEvent) => settle(event.currentTarget),
      onScrollCapture: (event: UIEvent) => settle(event.currentTarget),
      onKeyDownCapture: (event: KeyboardEvent) => {
        if (MOVING_KEYS.has(event.code)) settle(event.currentTarget)
      },
    },
  }
}
