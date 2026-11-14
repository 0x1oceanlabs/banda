import { type ReactElement, useContext } from "react"
import type { Engine, ProjectId, ProjectSummary } from "@banda/contract"
import { CutTips } from "@banda/ui/components/fade-text"
import { Separator } from "@banda/ui/components/separator"
import { useThisNamed } from "@banda/core/react"
import { cn } from "@banda/ui/lib/utils"
import type { PaneState } from "@banda/ui/pane"
import { CheckIcon } from "lucide-react"
import { actsOf } from "./acts"
import type { Row as Arranged } from "./rows"
import { type CardView, callWordOf, LATER_BY_AGENT } from "./cards/model"
import { type CardAct, SignMenu } from "./cards/ThreadCard"
import { ChildArrow } from "./cards/parts"
import { EmptyPlace } from "./Empty"
import { gapAbove, type Item, itemsOf } from "./flat"
import { itemActionOf } from "../window/items"
import { keyId } from "./keys"
import { EDGE } from "./MachineCard"
import { HerePart } from "./HostPart"
import { GroupHeader } from "./GroupHeader"
import { ProjectCard } from "./cards/ProjectCard"
import { ProjectMenu } from "./ProjectMenu"
import type { Region } from "./regions"
import type { Settings } from "./settings"
import { ThreadRow } from "./ThreadRow"
import { useActs, useArchiveAll } from "./useActs"
import { PickContext, pickProps, pieceKey } from "./usePick"
import { useKeyLabel } from "@banda/ui/hooks/use-key-of"

/** Your turn's head's key (`inbox.ts`). */
const TURN_HEAD = "turn:head"

/** A card's Project sign in its Project's menu, as the list hands it. */
const signMenu = (project: ProjectSummary, sign: ReactElement) => (
  <ProjectMenu project={project} className="flex min-w-0 flex-1">
    {sign}
  </ProjectMenu>
)

/**
 * The regions of the tab in view (ADR 0098, decisions 3–6 and 24), as one
 * flat list, keyed, its heads and headers among its cards: Your turn under
 * its head, Open under a hairline, the Working shelf in grey with "+ N
 * more", which opens in place, each child at work under its parent with
 * ↳, past three "↳ + N more at work"; Later and the Archive by day; inbox
 * zero and an empty tab in words; and, grouped, each group under its
 * header, which folds it. A card keeps its node from one part to another,
 * so its Mark plays its change as news. The list is drawn as it is: React
 * moves its rows by their keys, one that comes fades in, by CSS, and one
 * that goes is gone (decision 6).
 * Under the pointer, Your turn's head offers to archive every card there
 * that is done (decision 15). A Project that waits for the Person is a
 * card of its own first in Your turn, and this machine's Project's header
 * and sign have its menu (decision 16).
 */
export function SectionView({
  regions,
  settings,
  named,
  isCurrent,
  strayed,
  onToggle,
  engine,
  now,
}: {
  regions: readonly Region[]
  settings: Settings
  /** A label above names their machine, as another machine's part. */
  named: boolean
  isCurrent: (project: ProjectId, pane: PaneState) => boolean
  /** The Threads that stand away from their Project's workspace (ADR
   * 0102, decision 6). */
  strayed: ReadonlySet<string>
  /** Folds or opens the group of that key; or shows every child at work
   * of the parent of that key. */
  onToggle: (key: string) => void
  engine: Engine
  /** The Later clock the cards' words read. */
  now: number
}) {
  const keyFor = useKeyLabel()
  const { picked, expand } = useContext(PickContext)
  // Its regions are one machine's, whose stops' keys say it.
  const host = regions[0]?.host
  // Grouped, a header names what each card then leaves out; each card
  // has as many lines as the Person picked.
  const view: CardView = { group: settings.group, lines: settings.card }
  // Grouped by Project, this machine's groups stand under its own label,
  // as another's do, where the Person asked it named too (ADR 0095,
  // decision 4). The label names only this machine's cards: another's,
  // in the No Project group they share, still name theirs.
  const here = useThisNamed(settings.machines.thisToo)
  const label = !named && view.group === "project" ? here : undefined
  const items = itemsOf(regions)
  const actOn = useActs()
  const archiveAll = useArchiveAll()
  // Your turn's cards that are done, as drawn: not one that asks, failed
  // or woke.
  const done = items.flatMap((item) =>
    item.kind === "card" &&
    item.stand === "turn" &&
    callWordOf(item.entry.row.listed, now) === "Done"
      ? [item.entry.row]
      : []
  )
  /** A card's acts, each naming the key in force that does it on the
   * pick: Z for Later, S for Archive and Unarchive; Wake, its App's. */
  const actsFor = (row: Arranged): CardAct[] =>
    actsOf(row.stand, row.listed).map((act) => ({
      act,
      key: keyFor(
        act === "wake"
          ? (itemActionOf(row.listed, act)?.id ?? "")
          : keyId(act === "later" ? "later" : "archive")
      ),
      // Wake stands where the time says who put it off (ADR 0074).
      ...(act === "wake" && row.listed.later?.byAgent
        ? { note: LATER_BY_AGENT }
        : {}),
      run: (card) => actOn(row, act, { card }),
    }))

  const card = (item: Extract<Item, { kind: "card" }>) => {
    const { row, child } = item.entry
    return (
      <ThreadRow
        engine={engine}
        row={row}
        place={item.stand}
        at={item.entry.at}
        now={now}
        view={view}
        current={isCurrent(row.project.id, row.listed.pane)}
        picked={item.key === picked}
        strayed={strayed.has(row.listed.id)}
        named={named || (label !== undefined && row.host === undefined)}
        machines={settings.machines}
        {...(child ? { child } : {})}
        acts={actsFor(row)}
      />
    )
  }

  const piece = (item: Extract<Item, { kind: "piece" }>) => {
    const block = item.piece
    switch (block.kind) {
      case "head": {
        // Under the pointer, Your turn's head archives what is done there,
        // in one act; it has no key, and is hidden as the cards' acts are.
        const turn = block.key === TURN_HEAD && done.length > 0
        return (
          <div
            data-block={block.key}
            className="flex items-baseline gap-1 px-2 pt-2.5 pb-1 text-meta font-medium text-muted-foreground"
          >
            {block.label}
            {block.count !== undefined && (
              <span className="font-normal tabular-nums">· {block.count}</span>
            )}
            {turn && (
              <button
                type="button"
                aria-hidden
                tabIndex={-1}
                data-done-all=""
                className="ml-auto flex items-center gap-1 self-center rounded-small bg-foreground/7 px-1.5 text-meta font-normal text-muted-foreground outline-none hover:text-foreground"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => archiveAll(done)}
              >
                <CheckIcon className="size-3" />
                Archive {done.length} done
              </button>
            )}
          </div>
        )
      }
      case "divider":
        return <Separator className="mx-2 my-1.5 w-auto!" />
      case "more": {
        // A stop of the pick, which → or Enter opens, as a click does: the
        // rest shows, or a parent's children past three, and its first card
        // is picked.
        const stop = pieceKey(host, item.key)
        const children = block.of === "children"
        return (
          <button
            type="button"
            {...pickProps(stop, stop === picked)}
            data-more=""
            data-unfold={children ? block.parent : undefined}
            tabIndex={-1}
            className={cn(
              "w-full rounded-control px-2 py-1 text-left text-meta text-muted-foreground/70 outline-none hover:text-foreground",
              children && "flex items-center gap-1.5"
            )}
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => expand(event.currentTarget)}
          >
            {children ? (
              <>
                <ChildArrow className="w-2.5" />+ {block.count} more at work
              </>
            ) : block.of === "working" ? (
              `+ ${block.count} more`
            ) : (
              `Show ${block.count} older`
            )}
          </button>
        )
      }
      case "zero":
      case "empty":
        return <EmptyPlace place={block} />
      case "project": {
        const stop = pieceKey(host, item.key)
        return <ProjectCard call={block} stop={stop} picked={stop === picked} />
      }
      case "group": {
        const { project } = block
        // A stop of the pick, which ← and → fold and unfold, and whose
        // menu Shift+F10 opens.
        const stop = pieceKey(host, item.key)
        const head = (
          <GroupHeader
            group={block}
            settings={settings}
            stop={stop}
            picked={stop === picked}
            onFold={() => onToggle(block.key)}
          />
        )
        // Another machine's Project has no menu yet: each act would go to
        // this machine's engine.
        return project && block.host === undefined ? (
          <ProjectMenu project={project}>{head}</ProjectMenu>
        ) : (
          head
        )
      }
    }
  }

  const shown = (
    <div className="flex flex-col">
      {items.map((item, i) => {
        const gap = gapAbove(items[i - 1], item)
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
            style={gap > 0 ? { marginTop: gap } : undefined}
            // One that comes fades in; one that goes is gone.
            className={cn(
              "relative flow-root transition-opacity duration-(--dur) ease-(--ease) starting:opacity-0",
              head && "[overflow-anchor:none]"
            )}
          >
            {item.kind === "card" ? card(item) : piece(item)}
          </div>
        )
      })}
    </div>
  )
  return (
    // One tooltip shows any cut text whole, beside the sidebar; a card's
    // Project sign has the Project's menu.
    <CutTips edge={EDGE}>
      <SignMenu value={signMenu}>
        {label ? <HerePart named={label}>{shown}</HerePart> : shown}
      </SignMenu>
    </CutTips>
  )
}
