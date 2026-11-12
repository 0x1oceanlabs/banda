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
import { useHereNamed, useRun } from "@banda/core/react"
import { glanceAt } from "@banda/ui/components/banda-mark"
import { useKeyLabel } from "@banda/ui/hooks/use-key-of"
import { type Handler, useScope } from "@banda/ui/hooks/use-scope"
import { FIELDS } from "@banda/ui/lib/keys"
import { focusedTile, type PaneState } from "@banda/ui/pane"
import { actsOf } from "./acts"
import type { Row } from "./rows"
import { AskDelete, type Deleting, openCardMenu } from "./CardMenu"
import { LIST, type SearchField } from "./Header"
import { itemKey, keyOf } from "./hold"
import type { Tab } from "./inbox"
import { refused } from "./items"
import {
  type Does,
  hintOf,
  keyId,
  ONCE,
  SIDEBAR,
  SIDEBAR_KEYS,
  tabOf,
} from "./keys"
import { useOpen } from "./open"
import type { Ordered } from "./order"
import type { Checks } from "./pick"
import { checkedSaid, said, tabSaid, zeroSaid } from "./said"
import { useAskedTab } from "./showing"
import { valuesOf } from "./search"
import { PANEL, tabId } from "./Tabs"
import { undoLast } from "./undo"
import { type SetAct, useActs, useDoing, useSetActs } from "./useActs"
import type { Holding } from "./useHold"
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
 * aloud, and so is inbox zero, when the Person's act brought it (`said`).
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
  {
    ordered,
    holder,
    acted,
  }: { ordered: Ordered; holder: Holding; acted: boolean },
  view: {
    tab: Tab
    show: (tab: Tab) => void
    toggle: (group: string) => void
    toggleMore: () => void
    checks: Checks
    setChecks: Dispatch<SetStateAction<Checks>>
    search: string
    searchFor: (text: string) => void
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
    search: view.search,
  })
  const listbox = picking.list.ref
  const actOn = useActs(holder)
  const actOnSet = useSetActs(holder)
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

  /** Does `act` on every card checked, from `anchor`, as the Person took
   * it; what it leaves stays checked. By a key, the pick goes on as the
   * cards go. */
  const onSet = (act: SetAct, anchor: Element, by: "key" | "pointer") =>
    actOnSet(checkedRows, act, {
      anchor,
      by,
      ...(by === "key" ? { gone: picking.goneFrom } : {}),
      after: (left) => picking.checkOnly(left.map(itemKey)),
    })
  const doing = useDoing()
  const openIt = useOpen()
  const run = useRun()
  const keyLabel = useKeyLabel()
  // The card whose Thread Delete asks about.
  const [deleting, setDeleting] = useState<Row>()

  // Inbox zero, as the Person's own act brings it, is said once.
  const zero = ordered.zero
  const zeroed = useRef(zero !== undefined)
  useEffect(() => {
    if (zero && !zeroed.current && acted) said.say(zeroSaid(zero, Date.now()))
    zeroed.current = zero !== undefined
  }, [zero, acted])

  /**
   * What a key does on the pick. On a folded group or "+ N more", Enter
   * shows what it holds. On a card: Enter opens it and its Pane takes the
   * focus, or, on the one already open, goes to where its unseen begins;
   * Shift+Enter opens it beside; S archives it, or brings it back in the
   * Archive; Z puts it off, at the card; U marks it unread or read; F2
   * renames it in place, and Shift+F2 asks a title; Shift+F10 opens its
   * menu at the card; Delete, in the Archive alone, asks whether to delete
   * it. An act that takes the card out of the tab hands the pick on in the
   * keydown. S on a card that asks or works says why not, in a toast, and
   * the pick stays; U on one that asks does nothing, as a question waits
   * until it is answered; a card that left the tab while the list held
   * only opens.
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

  const field = picking.field
  const searching = view.search.trim() !== ""
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
          // All is there only while a search runs.
          if (tab === "all" && !searching) return false
          if (tab) {
            view.show(tab)
            said.say(tabSaid(tab, ordered.tabs[tab]?.count ?? 0))
          } else if (does === "search") field.current?.focus()
          else {
            const done = undoLast(run) ?? []
            if (done.length > 0 && target === listbox.current)
              picking.back(
                new Set(done.map(({ listed }) => keyOf(listed.host, listed.id)))
              )
          }
          return true
        }
        // Search opens the pick as the list does, by Enter or beside.
        const opens = does === "open" || does === "beside"
        const searched = opens && target === field.current
        if (event && target !== listbox.current && !searched) return false
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

  // Where the focus was as Search took it, which Esc gives it back to.
  const cameFrom = useRef<Element | null>(null)
  const here = useHereNamed()?.name
  const all = ordered.rows
  const values = useMemo(() => valuesOf(all, here), [all, here])
  const search: SearchField = {
    text: view.search,
    say: view.searchFor,
    field,
    values,
    onFocus: (event) => {
      cameFrom.current = event.relatedTarget
    },
    onKeyDown: (event) => {
      if (event.nativeEvent.isComposing) return
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault()
        picking.step(event.key === "ArrowDown" ? 1 : -1)
      } else if (event.key === "Escape") {
        // Its own layer: it clears what it says, and the focus goes back
        // where it came from, a Pane's, else the list.
        event.preventDefault()
        view.searchFor("")
        const from = cameFrom.current
        if (from?.closest("[data-tile]")) toPane()
        else if (from instanceof HTMLElement && from.isConnected) from.focus()
        else listbox.current?.focus()
      }
    },
  }

  return {
    aside,
    picking,
    search,
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
      event.preventDefault()
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
          id={LIST}
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
