import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react"
import type { ProjectId } from "@banda/contract"
import { type Handler, useScope } from "@banda/ui/hooks/use-scope"
import { FIELDS } from "@banda/ui/lib/keys"
import { focusedTile, type PaneState } from "@banda/ui/pane"
import { actsOf } from "./acts"
import { itemKey } from "./hold"
import type { Tab } from "./inbox"
import { type Does, ONCE, SIDEBAR, SIDEBAR_KEYS, tabOf } from "./keys"
import { useOpen } from "./open"
import type { Ordered } from "./order"
import { PANEL, tabId } from "./Tabs"
import { useActs, useDoing } from "./useActs"
import type { Holding } from "./useHold"
import { PICK, PickContext, usePick } from "./usePick"

/** Gives the focus back to the Pane in focus (spec §2.7): never to the
 * page. */
function toPane() {
  focusedTile()?.focus({ preventScroll: true })
}

/**
 * The sidebar's keys (ADR 0098, decision 13; spec §2.7), its scope's on
 * the aside (ADR 0071, decision 1): `/` and the tabs' digits anywhere in
 * it but in a field, which types them; the rest on the pick (`usePick`),
 * while the list itself has the focus, and an act on a card not again as
 * its key is held. `aside` goes on the aside, with `onKeyDown`, its Esc:
 * a popup and the title's field take theirs first; then the sidebar over
 * the Strip goes, and a docked one gives the focus back to the Pane in
 * focus, as it does when it is hidden with the focus in it.
 */
export function useSidebarKeys(
  { ordered, holder }: { ordered: Ordered; holder: Holding },
  view: {
    tab: Tab
    show: (tab: Tab) => void
    toggle: (group: string) => void
    toggleMore: () => void
  },
  isCurrent: (project: ProjectId, pane: PaneState) => boolean,
  onDismiss: (() => void) | undefined
) {
  // Each card's row, by its key, and the open Thread's, which the pick
  // follows while the list has no focus.
  const rows = useMemo(
    () => new Map(ordered.rows.map((row) => [itemKey(row), row])),
    [ordered.rows]
  )
  const open = ordered.rows.find((row) =>
    isCurrent(row.project.id, row.listed.pane)
  )
  const picking = usePick({
    tab: view.tab,
    open: open && itemKey(open),
    toggle: view.toggle,
    more: view.toggleMore,
  })
  const actOn = useActs(holder)
  const doing = useDoing()
  const openIt = useOpen()

  /**
   * What a key does on the pick. On a folded group or "+ N more", Enter
   * shows what it holds. On a card: Enter opens it and its Pane takes the
   * focus, or, on the one already open, goes to where its unseen begins;
   * Shift+Enter opens it beside; S archives it, or brings it back in the
   * Archive; Z puts it off, at the card; U marks it unread or read; F2
   * renames it in place, and Shift+F2 asks a title. An act that takes the
   * card out of the tab hands the pick on in the keydown. One the card
   * does not offer, as S on one that asks, does nothing (S7c says why); a
   * card that left the tab while the list held only opens.
   */
  const onPick = (does: Does) => {
    const at = picking.at()
    if (!at) return
    if (!at.hasAttribute("data-card")) {
      if (does === "open") picking.expand(at)
      return
    }
    const key = at.getAttribute(PICK)!
    const row = rows.get(key)
    if (!row || (at.hasAttribute("data-went") && does !== "open")) return
    const { listed } = row
    const project = row.project.id
    const on = {
      card: at.closest("[data-row]") ?? at,
      by: "key" as const,
      gone: () => picking.goneFrom(key),
    }
    switch (does) {
      case "open":
        if (!isCurrent(project, listed.pane))
          return openIt("pane.pick", { project, pane: listed.pane })
        toPane()
        return doing(row, "unseen")
      case "beside":
        return openIt("pane.beside", { project, pane: listed.pane })
      case "archive": {
        const act = row.stand === "archived" ? "unarchive" : "archive"
        if (actsOf(row.stand, listed).includes(act)) actOn(row, act, on)
        return
      }
      case "later":
        // In Later it stays, whenever it wakes next.
        if (row.stand === "later")
          actOn(row, "later", { ...on, gone: undefined })
        else if (actsOf(row.stand, listed).includes("later"))
          actOn(row, "later", on)
        return
      case "unread":
        holder.act(row, "key")
        return doing(row, "unread")
      case "rename":
        // Another machine's card has no field yet.
        if (row.host === undefined) doing(row, "rename", { from: "row" })
        return
      case "suggest":
        return doing(row, "suggest")
    }
  }

  const listbox = picking.list.ref
  const handlers = Object.fromEntries(
    SIDEBAR_KEYS.map(({ does, id }): [string, Handler] => [
      id,
      (_, event) => {
        const target = event?.target
        const tab = tabOf(does)
        if (tab || does === "search") {
          if (target instanceof Element && target.closest(FIELDS)) return false
          if (tab) view.show(tab)
          else openIt("menu.at", {})
          return true
        }
        if (event && target !== listbox.current) return false
        if (!event?.repeat || !ONCE.has(does)) onPick(does)
        return true
      },
    ])
  )
  const scope = useScope(SIDEBAR, handlers)
  const aside = useRef<HTMLElement>(null)
  useEffect(() => scope(aside.current), [scope])
  useLayoutEffect(() => {
    const own = aside.current
    return () => {
      if (own?.contains(document.activeElement)) queueMicrotask(toPane)
    }
  }, [])

  return {
    aside,
    picking,
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      // Not Esc in a menu it opened, drawn elsewhere in the page.
      const own = event.currentTarget.contains(event.target as Node)
      if (event.key !== "Escape" || !own || event.defaultPrevented) return
      event.preventDefault()
      if (onDismiss) onDismiss()
      else toPane()
    },
  }
}

/**
 * The tab in view as one list (ADR 0098, decision 13): one Tab stop, a
 * `listbox` that keeps the focus while the keys move its pick, which its
 * items read (`PickContext`).
 */
export function PickList({
  tab,
  picking,
  children,
}: {
  tab: Tab
  picking: ReturnType<typeof usePick>
  children: ReactNode
}) {
  return (
    <div role="tabpanel" id={PANEL} aria-labelledby={tabId(tab)}>
      <div
        role="listbox"
        aria-labelledby={tabId(tab)}
        tabIndex={0}
        {...picking.list}
        className="flex flex-col gap-1 outline-none"
      >
        <PickContext value={{ picked: picking.picked, expand: picking.expand }}>
          {children}
        </PickContext>
      </div>
    </div>
  )
}
