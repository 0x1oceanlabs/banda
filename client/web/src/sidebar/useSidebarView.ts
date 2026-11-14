import {
  createContext,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import type { Tab } from "./inbox"
import { tabId } from "./Tabs"

/** Where this device keeps when inbox zero last told of Someday. */
const SOMEDAY = "banda.sidebar.someday"

/** When inbox zero last told of Someday on this device; none where the
 * browser keeps nothing. */
function toldSomeday(): number | undefined {
  try {
    const told = Number(localStorage.getItem(SOMEDAY))
    return told > 0 ? told : undefined
  } catch {
    return undefined
  }
}

/** This device keeps that inbox zero told of Someday at `at`. */
function tellSomeday(at: number) {
  try {
    localStorage.setItem(SOMEDAY, String(at))
  } catch {
    // A browser that keeps nothing tells of it each time; no harm.
  }
}

/** How inbox zero says it told of Someday: the Sidebar's view, which
 * keeps it; none outside one. */
export const ToldSomeday = createContext<((at: number) => void) | undefined>(
  undefined
)

/** The element a list scrolls in, inside the sidebar's `ScrollArea`. */
const scrollerOf = (list: HTMLElement | null) =>
  list?.querySelector<HTMLElement>("[data-slot=scroll-area-viewport]")

/**
 * How the Person has the sidebar list in view, while the window draws it:
 * the tab (ADR 0098, decision 2), each where it was scrolled to; a cut
 * list whole (`more`), until the tab changes; the groups (`folded`) and the
 * other machines (`foldedHosts`) folded, each flipped by its key; when
 * inbox zero last told of Someday. Another `preset` starts afresh, on the
 * same tab.
 */
export function useSidebarView(preset: string) {
  const [tab, setTab] = useState<Tab>("inbox")
  const [more, setMore] = useState(false)
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set())
  const [foldedHosts, setFoldedHosts] = useState<ReadonlySet<string>>(new Set())
  const [someday, setSomeday] = useState(toldSomeday)
  // Inbox zero told of Someday at `at`: this device keeps it, and this
  // window's next inbox zero this week says no more (ADR 0098, decision
  // 12). The one that told keeps its line while it shows.
  const told = useCallback((at: number) => {
    tellSomeday(at)
    setSomeday(at)
  }, [])
  // Where each tab was left, and the list that scrolls, once drawn: a tab
  // comes back where it was, at once, or at the block it is shown at.
  const [list, setList] = useState<HTMLElement | null>(null)
  const scrolls = useRef(new Map<Tab, number>())
  const at = useRef<string | undefined>(undefined)
  useLayoutEffect(() => {
    const scroller = scrollerOf(list)
    if (!scroller) return
    const block = at.current
      ? scroller.querySelector(`[data-block="${at.current}"]`)
      : null
    at.current = undefined
    scroller.scrollTop = block
      ? scroller.scrollTop +
        block.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top
      : (scrolls.current.get(tab) ?? 0)
  }, [tab, list])
  // Another preset starts afresh: nothing folded by hand.
  const [arrangedBy, setArrangedBy] = useState(preset)
  if (arrangedBy !== preset) {
    setArrangedBy(preset)
    setMore(false)
    setFolded(new Set())
    setFoldedHosts(new Set())
  }
  return {
    tab,
    more,
    folded,
    foldedHosts,
    someday,
    told,
    /** Takes the list that scrolls, as it is drawn. */
    scrollsIn: setList,
    /**
     * Shows `next`, the tab, as it was left, or with the block keyed
     * `block` at its top; a cut list shows cut again. A switch from the
     * list keeps the focus there, on the tab's own pick; from elsewhere in
     * the sidebar it takes the focus to the tab it shows, as the control
     * that had it may go with the tab it was in: the focus never falls to
     * the page.
     */
    show: (next: Tab, block?: string) => {
      if (next === tab) return
      const scroller = scrollerOf(list)
      if (scroller) scrolls.current.set(tab, scroller.scrollTop)
      at.current = block
      setTab(next)
      setMore(false)
      const focused = document.activeElement
      if (
        list?.closest("aside")?.contains(focused) &&
        focused?.getAttribute("role") !== "listbox"
      )
        document.getElementById(tabId(next))?.focus()
    },
    toggle: (key: string) => setFolded((set) => flip(set, key)),
    toggleMore: () => setMore((was) => !was),
    foldHost: (name: string) => setFoldedHosts((set) => flip(set, name)),
  }
}

/** `set` with `key` taken out, or put in where it was not. */
function flip(set: ReadonlySet<string>, key: string) {
  const next = new Set(set)
  if (!next.delete(key)) next.add(key)
  return next
}
