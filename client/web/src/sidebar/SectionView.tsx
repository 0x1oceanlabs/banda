import { useContext, useRef } from "react"
import type { Engine, ProjectId, ProjectSummary } from "@banda/contract"
import { CutTips } from "@banda/ui/components/fade-text"
import { Separator } from "@banda/ui/components/separator"
import { useRun, useThisNamed } from "@banda/core/react"
import { useLook } from "@banda/ui/lib/look"
import { cn } from "@banda/ui/lib/utils"
import type { PaneState } from "@banda/ui/pane"
import { CheckIcon } from "lucide-react"
import { actsOf } from "./acts"
import type { Row as Arranged } from "./rows"
import { type CardView, callWordOf, LATER_BY_AGENT, linesOf } from "./card"
import { type CardAct, ChildArrow, SignMenu } from "./CardView"
import { EmptyPlace } from "./Empty"
import { wentWords } from "./hold"
import { itemActionOf } from "./items"
import { keyId } from "./keys"
import { EDGE } from "./MachineCard"
import { HerePart } from "./HostPart"
import { GroupHeader } from "./GroupHeader"
import { gapAbove, type Item, itemsOf, useListMotion } from "./motion"
import type { Region } from "./regions"
import type { WithMenu } from "./ProjectMenu"
import { groupOf, type Settings } from "./settings"
import { ThreadRow } from "./ThreadRow"
import { putBack } from "./undo"
import { useActs, useSetActs } from "./useActs"
import { HoldingContext } from "./useHold"
import type { Holds } from "./useOrdered"
import { PickContext, pickProps, pieceKey } from "./usePick"
import { useKeyLabel } from "@banda/ui/hooks/use-key-of"

/** Your turn's head's key (`inbox.ts`). */
const TURN_HEAD = "turn:head"

/**
 * The regions of the tab in view (ADR 0098, decisions 3–6 and 24), as one
 * flat list, keyed, its heads and headers among its cards: Your turn under
 * its head, Open under a hairline, the Working shelf in grey with "+ N
 * more", which opens in place, each child at work under its parent with
 * ↳, past three "↳ + N more at work"; Later and the Archive by day; inbox
 * zero and an empty tab in words; and, grouped, each group under its
 * header, which folds it. A card keeps its node from one part to another,
 * so its Mark plays its change as news; the list moves as `motion.ts`
 * plays it. While the list holds, a card that left stays dimmed in its
 * slot, saying where it went, and one the Person's pointer took away
 * stands as a ghost line, whose Undo puts back what its act changed. What
 * the Person does to a card from it, by its menu or its acts (ADR 0098,
 * decision 10), is their own act, which the list draws at once; for a
 * moment after one by key closed a slot, the acts take no click.
 * Under the pointer, Your turn's head offers to archive every card there
 * that is done (decision 15).
 */
export function SectionView({
  regions,
  settings,
  named,
  isCurrent,
  strayed,
  onToggle,
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
  /** Folds or opens the group of that key; or shows every child at work
   * of the parent of that key. */
  onToggle: (key: string) => void
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
  const { picked, expand, checked } = useContext(PickContext)
  // In check mode an option says whether it is checked; a piece never is.
  const checking = checked.size > 0
  // Its regions are one machine's, whose stops' keys say it.
  const host = regions[0]?.host
  // Grouped, a header names what each card then leaves out.
  const view: CardView = { density: settings.card, group: groupOf(settings) }
  // Grouped by Project, this machine's groups stand under its own label,
  // as another's do, where the Person asked it named too (ADR 0095,
  // decision 4). The label names only this machine's cards: another's,
  // in the No Project group they share, still name theirs.
  const here = useThisNamed(settings.machines.thisToo)
  const label = !named && view.group === "project" ? here : undefined
  const items = itemsOf(
    regions,
    (place, { child }) => linesOf(place, view, child),
    holds
  )
  const list = useRef<HTMLDivElement>(null)
  // Each look, with its font, is measured again, as the cards' density.
  const look = useLook((one) => one.vars, undefined)
  useListMotion(list, items, {
    scene: holds.scene,
    measure: [settings, look],
    searching: holds.searching,
  })
  const actOn = useActs(holding)
  const actOnSet = useSetActs(holding)
  // Your turn's cards that are done, as drawn: not one that asks, failed
  // or woke, nor one that left while the list held.
  const done = items.flatMap((item) =>
    item.kind === "card" &&
    item.stand === "turn" &&
    !item.ghost &&
    !item.went &&
    callWordOf(item.entry.row.listed, holds.now) === "Done"
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
      run: (card) => actOn(row, act, { card, by: "pointer" }),
    }))

  const card = (item: Extract<Item, { kind: "card" }>) => {
    const { row, child } = item.entry
    const went = item.ghost ?? item.went
    const said = went && wentWords(went, holds.now)
    const undo = item.ghost && holds.undos.get(item.key)
    const drawn = (
      <ThreadRow
        engine={engine}
        row={row}
        place={item.stand}
        at={item.entry.at}
        now={holds.now}
        view={view}
        current={isCurrent(row.project.id, row.listed.pane)}
        picked={item.key === picked}
        {...(checking ? { checked: checked.has(item.key) } : {})}
        strayed={strayed.has(row.listed.id)}
        named={named || (label !== undefined && row.host === undefined)}
        machines={settings.machines}
        {...(child ? { child } : {})}
        {...(went ? { went } : { acts: actsFor(row) })}
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
          <p className="absolute inset-0 flex items-center justify-center gap-1 text-meta text-muted-foreground transition-opacity duration-(--dur-fast) ease-(--ease) starting:opacity-0">
            {said}
            {undo && (
              <>
                {said && <span aria-hidden>·</span>}
                <button
                  type="button"
                  tabIndex={-1}
                  className="rounded-control px-0.5 text-foreground/85 outline-none hover:text-foreground"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => putBack(run, undo)}
                >
                  Undo
                </button>
              </>
            )}
          </p>
        )}
      </>
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
                onClick={(event) =>
                  actOnSet(done, "archive", {
                    anchor: event.currentTarget,
                    by: "pointer",
                  })
                }
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
            {...pickProps(stop, stop === picked, checking ? false : undefined)}
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
        return <EmptyPlace place={block} only={only} projects={projects} />
      case "group": {
        const { project } = block
        // Folded, it is a stop of the pick, which → or Enter unfolds.
        const stop = block.folded ? pieceKey(host, item.key) : undefined
        const head = (
          <GroupHeader
            group={block}
            settings={settings}
            {...(machine ? { machine } : {})}
            {...(stop !== undefined
              ? { stop, picked: stop === picked, checking }
              : {})}
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
  return (
    // One tooltip shows any cut text whole, beside the sidebar; a card's
    // Project sign has the Project's menu.
    <CutTips edge={EDGE}>
      <SignMenu value={withMenu}>
        {label ? <HerePart named={label}>{shown}</HerePart> : shown}
      </SignMenu>
    </CutTips>
  )
}
