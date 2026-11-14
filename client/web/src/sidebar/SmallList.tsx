/**
 * The small inbox's list (ADR 0098, decision 22, as amended), which the
 * counts' popover loads as it first opens (`SmallInbox`).
 */
import { useLayoutEffect, useMemo, useRef, useState } from "react"
import type { Engine } from "@banda/contract"
import { useLookSidebar } from "../look"
import { PickList, useSidebarKeys } from "./PickList"
import { regionsOf } from "./regions"
import { SectionView } from "./SectionView"
import type { Settings } from "./settings"
import { useOrdered } from "./useOrdered"
import { useTiled } from "../tiling/kept"
import { useMenuProjects } from "../titles/ThreadMenu"
import { focusedIn } from "../tiling/opening"

/** Nothing folded, and no card strayed from its Project's workspace:
 * the sidebar says so (ADR 0102, decision 6). */
const NONE: ReadonlySet<string> = new Set()
const NOTHING = () => {}

/** The workspaces as they are, whole. */
const same = <T,>(value: T) => value

/**
 * The small inbox's list (ADR 0098, decision 22; spec §6.9 of the keys'
 * research): the sidebar's Inbox with Your turn alone, in its cards,
 * in the same `listbox` in the scope `sidebar`, so the same keys work
 * (`useSidebarKeys`), but no tabs and no `1`–`4`. It takes the
 * focus as it is drawn, on the first card; the sidebar's own Esc closes
 * it (`onEsc`). It says nothing of Someday,
 * which the sidebar tells once a week. After it, "7 at work ›".
 */
export function SmallList({
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
      group: "none",
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
  const [someday] = useState(Date.now)
  const view = {
    tab: "inbox" as const,
    more: false,
    folded: NONE,
    someday,
  }
  const ordering = useOrdered(projects, settings, view)
  const { aside, ...keys } = useSidebarKeys(
    ordering,
    {
      ...view,
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
            now={ordering.now}
          />
        </PickList>
      </div>
      {working > 0 && (
        <button
          type="button"
          onClick={onWorking}
          className="mt-1 flex h-7 items-center rounded-control px-2 text-left text-meta text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {working} at work ›
        </button>
      )}
    </section>
  )
}
