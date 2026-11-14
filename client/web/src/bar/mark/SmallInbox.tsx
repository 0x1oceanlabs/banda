import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react"
import type { Engine } from "@banda/contract"
import { type Here, useHere, useRun } from "@banda/core/react"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@banda/ui/components/popover"
import { focusedTile } from "@banda/ui/pane"
import { useLaterClock, useLists } from "../../calls/stores"
import { useLookSidebar } from "../../look"
import { Dismiss } from "../../sidebar/open"
import { NO_CHECKS, type Checks } from "../../sidebar/pick"
import { PickList, useSidebarKeys } from "../../sidebar/PickList"
import { regionsOf } from "../../sidebar/regions"
import { SectionView } from "../../sidebar/SectionView"
import type { Settings } from "../../sidebar/settings"
import { useOrdered } from "../../sidebar/useOrdered"
import { useTiled } from "../../tiling/kept"
import { useMenuProjects } from "../../titles/ThreadMenu"
import { focusedIn } from "../../tiling/opening"
import { atWork, countOf, countWords, type InboxCount, turnTone } from "./count"

/** The count over every list, drawn again only as it changes. */
export function useInboxCount(): InboxCount {
  const lists = useLists()
  const now = useLaterClock()
  const { turn, mark, working } = useMemo(
    () => countOf(lists, now),
    [lists, now]
  )
  // The same count keeps its object, so what reads it draws nothing new.
  return useMemo(() => ({ turn, mark, working }), [turn, mark, working])
}

/** Whether the Sidebar shows: the small inbox never shows with it. */
const sidebarOf = (here: Here) => here.sidebar

/** Where the focus is no popup of the small inbox's own takes it from:
 * a card's menu, the Later picker, a dialog, a toast, a cut title's tip. */
const OTHER_LAYERS =
  '[data-slot="popover-content"], [role="menu"], [role="dialog"], [role="alertdialog"], [data-sonner-toaster], [data-slot="cut-tip"]'

/** Whether `node` stands in a popup other than the small inbox. */
function inOtherLayer(node: unknown, inbox: Element | null): boolean {
  if (!(node instanceof Element)) return false
  const layer = node.closest(OTHER_LAYERS)
  return layer !== null && layer !== inbox && !inbox?.contains(layer)
}

/**
 * The count beside the bar's logo while the sidebar is hidden, and the
 * small inbox it opens (ADR 0098, decision 22): "3 · 7", the Person's turn
 * in its loudest call's colour, then the working in grey; nothing when
 * nothing calls, and nothing while the sidebar shows. A click opens the
 * small inbox, a popover, the sidebar's own list of Your turn in one-line
 * cards with the same keys (`SmallList`), and "7 at work ›", which shows
 * the sidebar on Working with the focus in its list. Esc gives the focus
 * back where it was before it opened; a card opened, the Pane has it.
 */
export function SmallInbox({
  engine,
  count,
}: {
  engine: Engine
  count: InboxCount
}) {
  const sidebar = useHere(sidebarOf)
  const run = useRun()
  const [open, setOpen] = useState(false)
  // Where the focus was as it opened, which Esc gives it back to.
  const before = useRef<Element | null>(null)
  const popup = useRef<HTMLDivElement>(null)
  const giveBack = useCallback(() => {
    const to = before.current
    before.current = null
    if (to instanceof HTMLElement && to.isConnected && to !== document.body)
      to.focus({ preventScroll: true })
    else focusedTile()?.focus({ preventScroll: true })
  }, [])
  const close = (back: boolean) => {
    setOpen(false)
    if (back) giveBack()
    else before.current = null
  }
  // Never with the sidebar: shown, as by Alt+A, it closes the small inbox,
  // and the focus goes back where it was, not to the page.
  if (open && sidebar) setOpen(false)
  useLayoutEffect(() => {
    if (sidebar && before.current) giveBack()
  }, [sidebar, giveBack])
  if (sidebar || (count.turn === 0 && !open)) return null
  const words = countWords(count)
  return (
    <Popover
      open={open}
      onOpenChange={(next, details) => {
        if (next) {
          before.current ??= document.activeElement
          return setOpen(true)
        }
        const { reason, event } = details
        // Esc the list took, as to clear what is checked, or one pressed
        // in a popup of a card's, is not the small inbox's.
        if (
          reason === "escape-key" &&
          (event.defaultPrevented ||
            !popup.current?.contains(event.target as Node))
        )
          return details.cancel()
        // A card's menu, the Later picker or a dialog over it keeps it.
        const at =
          reason === "focus-out"
            ? (event as FocusEvent).relatedTarget
            : event.target
        if (
          (reason === "focus-out" || reason === "outside-press") &&
          inOtherLayer(at, popup.current)
        )
          return details.cancel()
        close(reason === "escape-key")
      }}
    >
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={`Inbox: ${words}`}
            title={words}
            data-inbox-count=""
            onPointerDown={() => {
              if (!open) before.current = document.activeElement
            }}
            className="flex h-7 items-center gap-1 rounded-control px-1.5 text-meta font-medium tabular-nums outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 data-popup-open:bg-muted"
          />
        }
      >
        <span className={turnTone(count.mark)}>{count.turn}</span>
        {count.working > 0 && (
          <>
            <span aria-hidden className="text-muted-foreground/60">
              ·
            </span>
            <span className="text-muted-foreground">{count.working}</span>
          </>
        )}
      </PopoverTrigger>
      <PopoverContent
        ref={popup}
        aria-label="Inbox"
        data-small-inbox=""
        // The sidebar's list, where the window's keys work, as Alt+A.
        data-window-keys=""
        side="bottom"
        align="start"
        // The list takes the focus as it is drawn (`SmallList`); where it
        // goes back to is the small inbox's own (`close`).
        initialFocus={false}
        finalFocus={false}
        className="w-96 gap-0 p-1.5"
      >
        <Dismiss value={() => close(false)}>
          <SmallList
            engine={engine}
            working={count.working}
            onEsc={() => close(true)}
            onWorking={() => {
              close(false)
              run("sidebar.show", { tab: "working" })
            }}
          />
        </Dismiss>
      </PopoverContent>
    </Popover>
  )
}

/** Nothing folded, and no card strayed from its Project's workspace:
 * the sidebar says so (ADR 0102, decision 6). */
const NONE: ReadonlySet<string> = new Set()
const NOTHING = () => {}

/** The workspaces as they are, whole. */
const same = <T,>(value: T) => value

/**
 * The small inbox's list (ADR 0098, decision 22; spec §6.9 of the keys'
 * research): the sidebar's Inbox with Your turn alone, in one-line cards,
 * in the same `listbox` in the scope `sidebar`, so the same keys work
 * (`useSidebarKeys`), but no tabs and no `1`–`4`. It takes the
 * focus as it is drawn, on the first card; the sidebar's own Esc clears
 * what is checked, then closes it (`onEsc`). It says nothing of Someday,
 * which the sidebar tells once a week. After it, "7 at work ›".
 */
function SmallList({
  engine,
  working,
  onEsc,
  onWorking,
}: {
  engine: Engine
  working: number
  onEsc: () => void
  onWorking: () => void
}) {
  const look = useLookSidebar()
  const settings: Settings = useMemo(
    () => ({
      ...look,
      preset: "inbox",
      group: "none",
      card: 1,
      inbox: { ...look.inbox, open: false, working: false },
    }),
    [look]
  )
  const menuProjects = useMenuProjects()
  // A list of its own only as the Projects change: a new one orders
  // the list again.
  const projects = useMemo(() => [...menuProjects], [menuProjects])
  const workspaces = useTiled(same)
  const isCurrent = useMemo(() => focusedIn(workspaces), [workspaces])
  const [checks, setChecks] = useState<Checks>(NO_CHECKS)
  const [someday] = useState(Date.now)
  const view = {
    tab: "inbox" as const,
    more: false,
    folded: NONE,
    someday,
    checks,
  }
  const ordering = useOrdered(projects, settings, view, isCurrent)
  const { aside, ...keys } = useSidebarKeys(
    ordering,
    {
      ...view,
      setChecks,
      show: NOTHING,
      toggle: NOTHING,
      toggleMore: NOTHING,
    },
    isCurrent,
    onEsc,
    true
  )
  // The focus comes in on the first card of Your turn, whatever the way
  // in would pick (`usePick`): the open Thread's card.
  const { picking } = keys
  const came = useRef(false)
  useLayoutEffect(() => {
    if (came.current) return
    came.current = true
    picking.list.ref.current?.focus({ preventScroll: true })
    picking.step("first")
  }, [picking])
  return (
    <section ref={aside} onKeyDown={keys.onKeyDown} className="flex flex-col">
      <div {...ordering.list} className="max-h-[60vh] overflow-y-auto">
        <PickList tab="inbox" picking={keys.picking} deleting={keys.deleting}>
          <SectionView
            regions={regionsOf(ordering.ordered.blocks)}
            settings={settings}
            named={false}
            isCurrent={isCurrent}
            strayed={NONE}
            onToggle={NOTHING}
            engine={engine}
            holds={ordering.holds}
          />
        </PickList>
      </div>
      {working > 0 && (
        <button
          type="button"
          onClick={onWorking}
          className="mt-1 flex h-7 items-center rounded-control px-2 text-left text-meta text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {atWork(working)} ›
        </button>
      )}
    </section>
  )
}
