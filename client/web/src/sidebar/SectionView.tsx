import { useContext, useRef } from "react"
import { flushSync } from "react-dom"
import type { Engine, ProjectId, ProjectSummary } from "@banda/contract"
import { Button } from "@banda/ui/components/button"
import { Separator } from "@banda/ui/components/separator"
import { useRun, useThisNamed } from "@banda/core/react"
import { useLook } from "@banda/ui/lib/look"
import { cn } from "@banda/ui/lib/utils"
import type { Listed, PaneState } from "@banda/ui/pane"
import { AlarmClockIcon } from "lucide-react"
import type { Row as Arranged } from "./rows"
import { type CardView, linesOf } from "./card"
import { EmptyTab, InboxZero } from "./Empty"
import { wentWords } from "./hold"
import { itemActionOf } from "./items"
import { pickLater } from "./LaterPicker"
import { HerePart } from "./HostPart"
import { GroupHeader } from "./GroupHeader"
import { gapAbove, type Item, itemsOf, useListMotion } from "./motion"
import type { Region } from "./regions"
import type { WithMenu } from "./ProjectMenu"
import { groupOf, type Settings } from "./settings"
import { ThreadRow } from "./ThreadRow"
import { HoldingContext } from "./useHold"
import type { Holds } from "./useOrdered"
import { useKeyLabel } from "@banda/ui/hooks/use-key-of"

/**
 * The regions of the tab in view (ADR 0098, decisions 3–6), as one flat
 * list, keyed, its heads and headers among its cards: Your turn under its
 * head, Open under a hairline, the Working shelf in grey with "+ N more",
 * which opens in place; Later and the Archive by day; inbox zero and an
 * empty tab in words; and, grouped, each group under its header, which
 * folds it. A card keeps its node from one part to another, so its Mark
 * plays its change as news; the list moves as `motion.ts` plays it. While
 * the list holds, a card that left stays dimmed in its slot, saying where
 * it went, and one the Person's pointer took away stands as a ghost line.
 * What the Person does to a card from it, by its menu or its hover
 * actions, is their own act, which the list draws at once; for a moment
 * after one by key closed a slot, the hover actions take no click.
 */
export function SectionView({
  regions,
  settings,
  named,
  isCurrent,
  strayed,
  onToggle,
  onMore,
  engine,
  machine,
  withMenu,
  only,
  projects,
  holds,
}: {
  regions: readonly Region[]
  settings: Settings
  /** A label above names their machine, as another machine's part. */
  named: boolean
  isCurrent: (project: ProjectId, pane: PaneState) => boolean
  /** The Threads that stand away from their Project's workspace (ADR
   * 0102, decision 6). */
  strayed: ReadonlySet<string>
  /** Folds or opens the group of that key. */
  onToggle: (key: string) => void
  /** Shows a cut list whole. */
  onMore: () => void
  engine: Engine
  /** This machine's No Project, once the engine named it. */
  machine?: ProjectId
  withMenu: WithMenu
  /** The Project whose rows alone the list shows, if one. */
  only: ProjectId | undefined
  projects: readonly ProjectSummary[]
  holds: Holds
}) {
  const keyFor = useKeyLabel()
  const run = useRun()
  const holding = useContext(HoldingContext)
  // Grouped, a header names what each card then leaves out.
  const view: CardView = { density: settings.card, group: groupOf(settings) }
  // Grouped by Project, this machine's groups stand under its own label,
  // as another's do, where the Person asked it named too (ADR 0095,
  // decision 4). The label names only this machine's cards: another's,
  // in the No Project group they share, still name theirs.
  const here = useThisNamed(settings.machines.thisToo)
  const label = !named && view.group === "project" ? here : undefined
  const items = itemsOf(regions, (place) => linesOf(place, view), holds)
  const list = useRef<HTMLDivElement>(null)
  // Each look, with its font, is measured again, as the cards' density.
  const look = useLook((one) => one.vars, undefined)
  useListMotion(list, items, { scene: holds.scene, measure: [settings, look] })
  // A row's Later and Wake are its Thread's App's (ADR 0087, decision 12),
  // and the Person's own acts, which the list draws at once.
  const wake = (row: Arranged) => {
    const action = itemActionOf(row.listed, "wake")
    if (!action || holding?.quiet()) return
    holding?.act(row)
    run(action.id, { project: row.project.id, item: row.listed.id })
  }
  const laterKey = (listed: Listed) =>
    keyFor(itemActionOf(listed, "later")?.id ?? "")

  /** A card's hover action: Wake in Later, else its Later's clock, which
   * opens the picker at the card. */
  const actionOf = (row: Arranged) =>
    row.stand === "later" ? (
      <Button
        variant="ghost"
        size="xs"
        className="h-5"
        onClick={() => wake(row)}
      >
        <AlarmClockIcon className="size-3.5" />
        Wake
      </Button>
    ) : (
      <Button
        variant="ghost"
        size="icon-xs"
        className="size-5"
        aria-label="Later"
        title={`Later ${laterKey(row.listed)}`}
        onClick={(event) => {
          if (holding?.quiet()) return
          const anchor = event.currentTarget.closest("[data-row]")
          pickLater({
            project: row.project.id,
            listed: row.listed,
            ...(anchor ? { anchor } : {}),
            onPicked: () => holding?.act(row, "pointer"),
          })
        }}
      >
        <AlarmClockIcon className="size-3.5" />
      </Button>
    )

  const card = (item: Extract<Item, { kind: "card" }>) => {
    const { row } = item.entry
    const went = item.ghost ?? item.went
    const said = went && wentWords(went, holds.now)
    const drawn = (
      <ThreadRow
        engine={engine}
        row={row}
        place={item.stand}
        at={item.entry.at}
        now={holds.now}
        view={view}
        current={isCurrent(row.project.id, row.listed.pane)}
        strayed={strayed.has(row.listed.id)}
        named={named || (label !== undefined && row.host === undefined)}
        machines={settings.machines}
        {...(went ? { went } : { action: actionOf(row) })}
      />
    )
    return (
      <>
        {/* Dimmed as it left, or faded out under its ghost line. */}
        <div
          inert={item.ghost ? true : undefined}
          aria-hidden={item.ghost ? true : undefined}
          className={cn(
            "transition-opacity",
            item.ghost && "opacity-0 duration-(--dur-fast) ease-(--ease-exit)",
            item.went && "opacity-50 duration-(--dur) ease-(--ease)"
          )}
        >
          {drawn}
        </div>
        {item.ghost && (
          <p className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground transition-opacity duration-(--dur-fast) ease-(--ease) starting:opacity-0">
            {said}
          </p>
        )}
      </>
    )
  }

  const piece = (item: Extract<Item, { kind: "piece" }>) => {
    const block = item.piece
    switch (block.kind) {
      case "head":
        return (
          <div
            data-block={block.key}
            className="flex items-baseline gap-1 px-2 pt-2.5 pb-1 text-xs font-medium text-muted-foreground"
          >
            {block.label}
            {block.count !== undefined && (
              <span className="font-normal tabular-nums">· {block.count}</span>
            )}
          </div>
        )
      case "divider":
        return <Separator className="mx-2 my-1.5 w-auto!" />
      case "more":
        return (
          <button
            type="button"
            className="w-full rounded-control px-2 py-1 text-left text-xs text-muted-foreground/70 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            onClick={(event) => {
              // It goes as the rest shows: the focus goes on to the first
              // card it showed, never to the page.
              const last =
                event.currentTarget.parentElement?.previousElementSibling
              flushSync(onMore)
              const card = last?.nextElementSibling?.querySelector("button")
              if (card instanceof HTMLElement) card.focus()
            }}
          >
            {block.of === "working"
              ? `+ ${block.count} more`
              : `Show ${block.count} older`}
          </button>
        )
      case "zero":
        return <InboxZero zero={block} />
      case "empty":
        return <EmptyTab tab={block.tab} only={only} projects={projects} />
      case "group": {
        const { project } = block
        const head = (
          <GroupHeader
            group={block}
            settings={settings}
            {...(machine ? { machine } : {})}
            onFold={() => onToggle(block.key)}
          />
        )
        // Another machine's Project has no menu yet: each act would go to
        // this machine's engine.
        return project && block.host === undefined
          ? withMenu(project, head)
          : head
      }
    }
  }

  const shown = (
    <div ref={list} className="flex flex-col">
      {items.map((item, i) => {
        const gap = gapAbove(items[i - 1], item)
        const deleted = item.kind === "card" && item.went?.to === "deleted"
        // The scroller keeps what is read in place as rows come above
        // it, by a card, never by a head.
        const head =
          item.kind === "piece" &&
          (item.piece.kind === "head" || item.piece.kind === "group")
        return (
          <div
            key={item.key}
            data-key={item.key}
            data-place={item.place}
            data-measure={item.measure}
            inert={deleted || undefined}
            style={gap > 0 ? { marginTop: gap } : undefined}
            className={cn(
              "relative flow-root",
              head && "[overflow-anchor:none]"
            )}
          >
            {item.kind === "card" ? card(item) : piece(item)}
          </div>
        )
      })}
    </div>
  )
  return label ? <HerePart named={label}>{shown}</HerePart> : shown
}
