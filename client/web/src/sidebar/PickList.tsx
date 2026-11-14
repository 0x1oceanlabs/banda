import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import type { ProjectId } from "@banda/contract"
import { type Run, useRun } from "@banda/core/react"
import { glanceAt } from "@banda/ui/components/banda-mark"
import { useKeyLabel } from "@banda/ui/hooks/use-key-of"
import { type Handler, useScope } from "@banda/ui/hooks/use-scope"
import { FIELDS } from "@banda/ui/lib/keys"
import { focusedTile, type PaneState } from "@banda/ui/pane"
import { PROJECT_CARD } from "../trust/TrustCard"
import { actsOf } from "./acts"
import { itemKey, type Row } from "./rows"
import { AskDelete, type Deleting, openCardMenu } from "./CardMenu"
import type { ProjectAsks, Tab } from "./inbox"
import { refused } from "./refusals"
import {
  type Does,
  hintOf,
  keyId,
  ONCE,
  SIDEBAR,
  SIDEBAR_KEYS,
  tabOf,
} from "./keys"
import type { Ordered } from "./order"
import { firstAct } from "./ProjectCard"
import { useAskedTab } from "./showing"
import { PANEL, tabId } from "./Tabs"
import { useActs, useDoing } from "./useActs"
import { PICK, PickContext, usePick } from "./usePick"

/** Gives the focus back to the Pane in focus (spec §2.7): never to the
 * page. */
function toPane() {
  focusedTile()?.focus({ preventScroll: true })
}

/**
 * The sidebar's keys (ADR 0098, decision 13; spec §2.7), its scope's on
 * the aside (ADR 0071, decision 1): `/` and the tabs' digits anywhere in
 * it but in a field, which keeps its own; the rest on the pick
 * (`usePick`), while the list itself has the focus, and an act on a card
 * not again as its key is held. Delete's question is the list's own
 * popup, kept here as `deleting`. The keys act on one card at a time, the
 * one picked (decision 15, as amended). `aside` goes on the aside, with
 * `onKeyDown`, its Esc: a popup and the title's field take theirs first;
 * then the sidebar over the Strip goes, and a docked one gives the focus
 * back to the Pane in focus, as it does when it is hidden with the focus
 * in it.
 */
export function useSidebarKeys(
  { ordered }: { ordered: Ordered },
  view: {
    tab: Tab
    show: (tab: Tab) => void
    toggle: (group: string) => void
    toggleMore: () => void
  },
  isCurrent: (project: ProjectId, pane: PaneState) => boolean,
  onDismiss: (() => void) | undefined,
  /** The small inbox's list (decision 22): its tab alone, no Search. */
  small = false
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
  const listbox = picking.list.ref
  const actOn = useActs()
  const doing = useDoing()
  const run = useRun()
  // What opens a Pane or a menu lets the Sidebar over the Strip go first,
  // as `useOpen` does for its parts: these keys run outside the Dismiss
  // they read, so by `onDismiss` itself.
  const openIt: Run = (action, args) => {
    onDismiss?.()
    run(action, args)
  }
  const keyLabel = useKeyLabel()
  // The card whose Thread Delete asks about.
  const [deleting, setDeleting] = useState<Row>()

  /**
   * What a key does on the pick. On a group's header, Enter folds or
   * unfolds it, and Shift+F10 opens its Project's menu, as ⋯ does; on "+
   * N more", Enter shows what it holds. On a Project's card (ADR 0098,
   * decision 16), Enter does its first act, Trust… or Locate…, Shift+F10
   * opens its Project's menu, and the rest do nothing. On a card: Enter
   * opens it and its Pane takes the
   * focus, or, on the one already open, goes to where its unseen begins;
   * Shift+Enter opens it beside; S archives it, or brings it back in the
   * Archive; Z puts it off, at the card; U marks it unread or read; F2
   * renames it in place, and Shift+F2 asks a title; Shift+F10 opens its
   * menu at the card; Delete, in the Archive alone, asks whether to delete
   * it. An act that takes the card out of the tab hands the pick on in the
   * keydown. S on a card that asks or works says why not, in a toast, and
   * the pick stays; U on one that asks does nothing, as a question waits
   * until it is answered.
   */
  const onPick = (does: Does) => {
    const at = picking.at()
    if (!at) return
    const asks = at.getAttribute("data-asks") as ProjectAsks | null
    if (asks || !at.hasAttribute("data-card")) {
      if (does === "menu") openCardMenu(at)
      else if (does !== "open") return
      else if (asks)
        firstAct(run, openIt, at.getAttribute(PROJECT_CARD) as ProjectId, asks)
      else picking.enter(at)
      return
    }
    const key = at.getAttribute(PICK)!
    const row = rows.get(key)
    if (!row) return
    const { listed } = row
    const project = row.project.id
    const on = {
      card: at.closest("[data-row]") ?? at,
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
        else refused(row, keyLabel(keyId("later")))
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
        if (listed.mark !== "asking")
          actOn(row, "unread", { ...on, gone: undefined })
        return
      case "rename":
        // Another machine's card has no field yet.
        if (row.host === undefined) doing(row, "rename", { from: "row" })
        return
      case "suggest":
        return doing(row, "suggest")
      case "menu":
        return openCardMenu(at)
      case "delete":
        if (row.stand === "archived") setDeleting(row)
        return
    }
  }

  const handlers = Object.fromEntries(
    SIDEBAR_KEYS.map(({ does, id }): [string, Handler] => [
      id,
      (_, event) => {
        const target = event?.target
        const tab = tabOf(does)
        if (tab || does === "search") {
          if (target instanceof Element && target.closest(FIELDS)) return false
          if (small) return false
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
  // `sidebar.show {tab}` shows its tab, with the focus here.
  useAskedTab(view.tab, view.show, listbox, !small)
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
    deleting: { row: deleting, ask: setDeleting },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      // Not Esc in a menu it opened, drawn elsewhere in the page.
      const own = event.currentTarget.contains(event.target as Node)
      if (event.key !== "Escape" || !own || event.defaultPrevented) return
      // The list keeps this Esc: the Top layer hears none.
      event.preventDefault()
      event.stopPropagation()
      if (onDismiss) onDismiss()
      else toPane()
    },
  }
}

/** The hint's id. */
const HINT = "sb-hint"

/** Whether the list was described by its hint in this window. */
let hinted = false

/**
 * The tab in view as one list (ADR 0098, decision 13): one Tab stop, a
 * `listbox` that keeps the focus while the keys move its pick, which its
 * items read (`PickContext`). As it first takes the focus in a window, it
 * is described by the hint of its keys in force, once (spec §2.8). Its
 * cards' menus ask Delete's question as its keys do (`AskDelete`).
 */
export function PickList({
  tab,
  picking,
  deleting,
  children,
}: {
  tab: Tab
  picking: ReturnType<typeof usePick>
  deleting: Deleting
  children: ReactNode
}) {
  const hint = hintOf(useKeyLabel())
  const [hinting, setHinting] = useState(!hinted)
  const { onBlur, ...list } = picking.list
  return (
    <AskDelete value={deleting.ask}>
      <div
        role="tabpanel"
        id={PANEL}
        aria-labelledby={tabId(tab)}
        // The awake Mark of the card under the pointer glances at it (ADR
        // 0099, M4).
        onPointerMove={(event) => glanceAt(event.nativeEvent)}
        onPointerLeave={() => glanceAt(null)}
      >
        {hinting && hint && (
          <p id={HINT} hidden>
            {hint}
          </p>
        )}
        <div
          role="listbox"
          aria-labelledby={tabId(tab)}
          aria-describedby={hinting && hint ? HINT : undefined}
          tabIndex={0}
          {...list}
          onBlur={(event) => {
            onBlur(event)
            hinted = true
            setHinting(false)
          }}
          className="flex flex-col gap-1 outline-none"
        >
          <PickContext
            value={{ picked: picking.picked, expand: picking.expand }}
          >
            {children}
          </PickContext>
        </div>
      </div>
    </AskDelete>
  )
}
