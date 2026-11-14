import {
  createContext,
  type Dispatch,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  type SetStateAction,
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
import { itemKey, keyOf, type Row } from "./rows"
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
import type { Checks } from "./pick"
import { firstAct } from "./ProjectCard"
import { checkedSaid, said, tabSaid, zeroSaid } from "./said"
import { useAskedTab } from "./showing"
import { PANEL, tabId } from "./Tabs"
import { undoLast } from "./undo"
import { type SetAct, useActs, useDoing, useSetActs } from "./useActs"
import { PICK, PickContext, usePick } from "./usePick"

/** What the selection's bar reads (`BulkBar`): the cards checked, in
 * their order; what it does to them all from one of its buttons; how it
 * clears them; and the list, which takes the focus back as it goes. */
export const Bulk = createContext<{
  rows: readonly Row[]
  onAct: (act: SetAct, at: Element) => void
  onClear: () => void
  list?: RefObject<HTMLElement | null>
}>({ rows: [], onAct: () => {}, onClear: () => {} })

/** Gives the focus back to the Pane in focus (spec §2.7): never to the
 * page. */
function toPane() {
  focusedTile()?.focus({ preventScroll: true })
}

/**
 * The sidebar's keys (ADR 0098, decision 13; spec §2.7), its scope's on
 * the aside (ADR 0071, decision 1): Undo, `/` and the tabs' digits
 * anywhere in it but in a field, which keeps its own; the rest on the
 * pick (`usePick`), while the list itself has the focus, and an act on a
 * card not again as its key is held. Undo takes back the newest act kept,
 * and the pick goes back to its card. Delete's question is the list's own
 * popup, kept here as `deleting`. A tab shown by its key is said
 * aloud, and so is inbox zero, as it comes with the focus in the list (`said`).
 * `X` and `Space` check the card picked, `Ctrl+A` every card drawn
 * (decision 15); while cards are checked, `S`, `Z` and `U` act on them
 * all, as one act, and what an act leaves stays checked; how many are
 * checked is said. `aside` goes on the aside, with `onKeyDown`, its Esc:
 * a popup and the title's field take theirs first; then the selection
 * clears; then the sidebar over the Strip goes, and a docked one gives
 * the focus back to the Pane in focus, as it does when it is hidden with
 * the focus in it.
 */
export function useSidebarKeys(
  { ordered }: { ordered: Ordered },
  view: {
    tab: Tab
    show: (tab: Tab) => void
    toggle: (group: string) => void
    toggleMore: () => void
    checks: Checks
    setChecks: Dispatch<SetStateAction<Checks>>
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
    checks: [view.checks, view.setChecks],
  })
  const listbox = picking.list.ref
  const actOn = useActs()
  const actOnSet = useSetActs()
  // The cards checked, in the order the list has them.
  const checked = picking.checked
  const checkedRows = useMemo(
    () => ordered.rows.filter((row) => checked.has(itemKey(row))),
    [ordered.rows, checked]
  )
  // How many are checked is said, a moment after it last changed.
  const count = checked.size
  const saidCount = useRef(count)
  useEffect(() => {
    if (saidCount.current === count) return
    saidCount.current = count
    const timer = setTimeout(() => said.say(checkedSaid(count)), SAY_CHECKED)
    return () => clearTimeout(timer)
  }, [count])

  /** Does `act` on every card checked, from `anchor`; what it leaves
   * stays checked. By a key, the pick goes on as the cards go. */
  const onSet = (act: SetAct, anchor: Element, by: "key" | "pointer") =>
    actOnSet(checkedRows, act, {
      anchor,
      ...(by === "key" ? { gone: picking.goneFrom } : {}),
      after: (left) => picking.checkOnly(left.map(itemKey)),
    })
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

  // Inbox zero, as it comes while the focus is in the list, is said once.
  const zero = ordered.zero
  const zeroed = useRef(zero !== undefined)
  useEffect(() => {
    if (zero && !zeroed.current && document.activeElement === listbox.current)
      said.say(zeroSaid(zero, Date.now()))
    zeroed.current = zero !== undefined
  }, [zero, listbox])

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
    // While cards are checked, the acts take them all, at the pick.
    if (
      count > 0 &&
      (does === "archive" || does === "later" || does === "unread")
    ) {
      const anchor = at?.closest("[data-row]") ?? at ?? listbox.current
      if (anchor) onSet(does, anchor, "key")
      return
    }
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
      gone: () => picking.goneFrom(new Set([key])),
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
      case "select":
        return picking.checkPicked()
    }
  }

  const handlers = Object.fromEntries(
    SIDEBAR_KEYS.map(({ does, id }): [string, Handler] => [
      id,
      (_, event) => {
        const target = event?.target
        const tab = tabOf(does)
        if (does === "select-all") {
          if (event && target !== listbox.current) return false
          picking.checkAll()
          return true
        }
        if (tab || does === "search" || does === "undo") {
          if (target instanceof Element && target.closest(FIELDS)) return false
          if (small && does !== "undo") return false
          if (tab) {
            view.show(tab)
            said.say(tabSaid(tab, ordered.tabs[tab].count))
          } else if (does === "search") openIt("menu.at", {})
          else {
            const done = undoLast(run) ?? []
            if (done.length > 0 && target === listbox.current)
              picking.back(
                new Set(done.map(({ listed }) => keyOf(listed.host, listed.id)))
              )
          }
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
    /** The cards checked, and what the selection's bar does to them. */
    bulk: {
      rows: checkedRows,
      onAct: (act: SetAct, at: Element) => onSet(act, at, "pointer"),
      onClear: () => picking.checkOnly([]),
      list: listbox,
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      // Not Esc in a menu it opened, drawn elsewhere in the page.
      const own = event.currentTarget.contains(event.target as Node)
      if (event.key !== "Escape" || !own || event.defaultPrevented) return
      // The list keeps this Esc: the Top layer hears none.
      event.preventDefault()
      event.stopPropagation()
      if (count > 0) picking.checkOnly([])
      else if (onDismiss) onDismiss()
      else toPane()
    },
  }
}

/** How long after the selection last changed how many are checked is
 * said, in ms (spec §2.6). */
const SAY_CHECKED = 250

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
          aria-multiselectable
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
            value={{
              picked: picking.picked,
              expand: picking.expand,
              checked: picking.checked,
              check: picking.check,
            }}
          >
            {children}
          </PickContext>
        </div>
      </div>
    </AskDelete>
  )
}
