/**
 * `sidebar.show {tab}` (ADR 0098, decision 22): the sidebar shown on a
 * tab, with the focus in its list, as the small inbox's "7 at work ›"
 * asks for Working. The action leaves the tab here and shows the sidebar;
 * the Sidebar, as it is drawn or while it shows, takes it once, shows the
 * tab and gives its list the focus once the tab is drawn. Plain
 * `sidebar.show`, a notice's, asks no tab and takes no focus.
 */
import { type RefObject, useEffect, useLayoutEffect, useRef } from "react"
import { type Tab, TABS } from "../model/inbox"

/** The tab asked for, until the Sidebar takes it. */
let asked: Tab | undefined
const hearing = new Set<() => void>()

/** Whether `tab` is one of the tabs `sidebar.show` may ask for: All is
 * there only while a search runs. */
export const isTab = (tab: unknown): tab is Tab => TABS.includes(tab as Tab)

/** Asks the Sidebar to show `tab`, with the focus in its list. */
export function askTab(tab: Tab) {
  asked = tab
  for (const hear of hearing) hear()
}

/** The tab asked for, once: it is taken. */
function taken(): Tab | undefined {
  const tab = asked
  asked = undefined
  return tab
}

/**
 * The Sidebar's half: a tab asked for as it is drawn, or later while it
 * shows, is shown by `show`, and once `tab`, the one in view, is it, the
 * list (`list`) takes the focus. A list that is not the sidebar's, as the
 * small inbox's, takes none (`on`).
 */
export function useAskedTab(
  tab: Tab,
  show: (tab: Tab) => void,
  list: RefObject<HTMLElement | null>,
  on = true
) {
  const showing = useRef(show)
  // The tab in view, and the one whose list takes the focus once drawn.
  const shown = useRef(tab)
  const focusOn = useRef<Tab | undefined>(undefined)
  useLayoutEffect(() => {
    showing.current = show
  })
  useLayoutEffect(() => {
    shown.current = tab
    if (focusOn.current !== tab) return
    focusOn.current = undefined
    list.current?.focus({ preventScroll: true })
  }, [tab, list])
  useEffect(() => {
    if (!on) return
    const take = () => {
      const tab = taken()
      if (tab === undefined) return
      if (tab === shown.current)
        return list.current?.focus({ preventScroll: true })
      focusOn.current = tab
      showing.current(tab)
    }
    take()
    hearing.add(take)
    return () => {
      hearing.delete(take)
    }
  }, [on, list])
}
