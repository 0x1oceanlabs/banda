/**
 * How the Person has a sidebar list in view (the window's rule 1): one
 * store for each list, the Sidebar's and the small inbox's, which its
 * parts read by selector (`useView`) and change only by what it offers.
 * It holds the tab (ADR 0098, decision 2), each where it was scrolled to;
 * a cut list whole (`more`), until the tab changes; the groups and the
 * other machines folded; when inbox zero last told of Someday; the pick
 * in each tab (decision 13), which `usePick` moves over the list as
 * drawn; and the card whose Thread Delete asks about.
 */
import { createContext, useContext, useLayoutEffect, useState } from "react"
import { type Readable, Store, useStore } from "@banda/core/react"
import type { Tab } from "../model/inbox"
import type { Picks } from "../model/pick"
import type { Row } from "../model/rows"

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

/** The tab's element's id, which the list and the panel are labelled by. */
export const tabId = (tab: Tab) => `sb-tab-${tab}`

/** The element a list scrolls in, inside the sidebar's `ScrollArea`. */
const scrollerOf = (list: HTMLElement | null) =>
  list?.querySelector<HTMLElement>("[data-slot=scroll-area-viewport]")

/** How the Person has a list in view. */
export type ViewState = {
  tab: Tab
  /** A cut list shown whole. */
  more: boolean
  /** The groups folded, by their keys. */
  folded: ReadonlySet<string>
  /** The other machines folded, by their names. */
  foldedHosts: ReadonlySet<string>
  /** When inbox zero last told of Someday. */
  someday: number | undefined
  /** The pick in each tab, by its key. */
  picks: Picks
  /** The card whose Thread Delete asks about: the list's own popup. */
  deleting: Row | undefined
}

const NONE: ReadonlySet<string> = new Set()

/** The view a list starts with. */
const FIRST: ViewState = {
  tab: "inbox",
  more: false,
  folded: NONE,
  foldedHosts: NONE,
  someday: undefined,
  picks: {},
  deleting: undefined,
}

/**
 * One list's view, kept outside React. The small inbox's (`small`, ADR
 * 0098, decision 22) is its Inbox alone: it shows no other tab, folds
 * nothing, shows no cut list whole, and tells nothing of Someday.
 */
export class SidebarView implements Readable<ViewState> {
  readonly #held: Store<ViewState>
  readonly small: boolean
  // The element the list scrolls in, once drawn; where each tab was
  // left; the block a tab is shown at, until it is drawn.
  #list: HTMLElement | null = null
  readonly #scrolls = new Map<Tab, number>()
  #at: string | undefined

  constructor(small = false) {
    this.small = small
    this.#held = new Store<ViewState>({
      ...FIRST,
      someday: small ? Date.now() : toldSomeday(),
    })
  }

  readonly get = (): ViewState => this.#held.get()
  readonly subscribe = (listener: () => void) => this.#held.subscribe(listener)

  #change(change: Partial<ViewState>) {
    this.#held.set({ ...this.get(), ...change })
  }

  /** Takes the element the list scrolls in, as it is drawn. */
  readonly scrollsIn = (list: HTMLElement | null) => {
    this.#list = list
  }

  /** As the tab in view is drawn: it comes back where it was, at once,
   * or at the block it is shown at. */
  readonly scrollBack = () => {
    const scroller = scrollerOf(this.#list)
    if (!scroller) return
    const at = this.#at
    const block = at ? scroller.querySelector(`[data-block="${at}"]`) : null
    this.#at = undefined
    scroller.scrollTop = block
      ? scroller.scrollTop +
        block.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top
      : (this.#scrolls.get(this.get().tab) ?? 0)
  }

  /**
   * Shows `next`, the tab, as it was left, or with the block keyed
   * `block` at its top; a cut list shows cut again. A switch from the
   * list keeps the focus there, on the tab's own pick; from elsewhere in
   * the sidebar it takes the focus to the tab it shows, as the control
   * that had it may go with the tab it was in: the focus never falls to
   * the page.
   */
  readonly show = (next: Tab, block?: string) => {
    const { tab } = this.get()
    if (this.small || next === tab) return
    const list = this.#list
    const scroller = scrollerOf(list)
    if (scroller) this.#scrolls.set(tab, scroller.scrollTop)
    this.#at = block
    this.#change({ tab: next, more: false })
    const focused = document.activeElement
    if (
      list?.closest("aside")?.contains(focused) &&
      focused?.getAttribute("role") !== "listbox"
    )
      document.getElementById(tabId(next))?.focus()
  }

  /** Folds or unfolds the group of that key. */
  readonly toggle = (key: string) => {
    if (!this.small) this.#change({ folded: flip(this.get().folded, key) })
  }

  /** Shows a cut list whole, or cut again. */
  readonly toggleMore = () => {
    if (!this.small) this.#change({ more: !this.get().more })
  }

  /** Folds or unfolds another machine's part, by its name. */
  readonly foldHost = (name: string) => {
    if (!this.small)
      this.#change({ foldedHosts: flip(this.get().foldedHosts, name) })
  }

  /** Inbox zero told of Someday at `at`: this device keeps it, and this
   * window's next inbox zero this week says no more (ADR 0098, decision
   * 12). The one that told keeps its line while it shows. */
  readonly told = (at: number) => {
    if (this.small) return
    tellSomeday(at)
    this.#change({ someday: at })
  }

  /** Picks `key` in `tab`. */
  readonly pick = (tab: Tab, key: string | undefined) => {
    const { picks } = this.get()
    if (picks[tab] !== key) this.#change({ picks: { ...picks, [tab]: key } })
  }

  /** Asks whether to delete the Thread of `row`'s card; none takes the
   * question away. */
  readonly ask = (row: Row | undefined) => {
    this.#change({ deleting: row })
  }
}

/** `set` with `key` taken out, or put in where it was not. */
function flip(set: ReadonlySet<string>, key: string) {
  const next = new Set(set)
  if (!next.delete(key)) next.add(key)
  return next
}

/** The view of the list a part is drawn in; none outside one. */
export const ViewContext = createContext<SidebarView | undefined>(undefined)

/** The view outside any list: the first, which nothing changes. */
const STILL: Readable<ViewState> = {
  get: () => FIRST,
  subscribe: () => () => {},
}

/** `select` of the view of the list a part is drawn in, drawn again only
 * as that changes. A `select` made once spares React a read. */
export function useView<S>(select: (view: ViewState) => S): S {
  return useStore(useContext(ViewContext) ?? STILL, select)
}

/** The tab in view. */
export const tabInView = (view: ViewState) => view.tab

/** The key picked in the tab in view. */
export const pickedOf = (view: ViewState) => view.picks[view.tab]

const whole = (view: ViewState) => view

/**
 * A list's view, made as the list is first drawn (`small` for the small
 * inbox's), and how it stands now. The list scrolls in the element
 * `scrollsIn` takes, which keeps each tab where it was left: apart from
 * the view, else React's compiler reads the whole view as a ref.
 */
export function useSidebarView(small = false) {
  const [view] = useState(() => new SidebarView(small))
  const state = useStore(view, whole)
  useLayoutEffect(() => view.scrollBack(), [view, state.tab])
  return { view, state, scrollsIn: view.scrollsIn }
}
