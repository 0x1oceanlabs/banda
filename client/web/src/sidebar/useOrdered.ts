import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import type { ProjectId, ProjectSummary } from "@banda/contract"
import type { PaneState } from "@banda/ui/pane"
import { useLaterClock, useLists } from "../calls/stores"
import type { Row } from "./rows"
import {
  type By,
  hold,
  itemKey,
  type Mine,
  QUIET,
  shapeOf,
  type Went,
} from "./hold"
import type { Block, Tab } from "./inbox"
import { DUR_FAST } from "./motion"
import { order, useElsewhere } from "./order"
import type { Checks } from "./pick"
import type { Settings } from "./settings"
import { useNotNow } from "../trust/not-now"
import type { Undoable } from "./undo"
import { type Holding, useHold, useOwnKeys } from "./useHold"

/** How long the first change of a list left alone waits for the others
 * that come with it, in ms: they all land in one commit (ADR 0088,
 * decision 7). */
const BATCH = 250

const NO_ACTS: Mine = new Map()
const NOT_LEAVING: ReadonlyMap<string, Went> = new Map()

/** What the list holds, the view it is drawn in, and the Later clock its
 * words read: the cards the Person's pointer took away, each a ghost line
 * in its slot, with what takes each back where its act said, and, while
 * it holds, those that left otherwise, dimmed in theirs. `scene` changes
 * as the view does. */
export type Holds = {
  ghosts: ReadonlyMap<string, Went>
  undos: ReadonlyMap<string, Undoable>
  leaving: ReadonlyMap<string, Went>
  scene: unknown
  now: number
}

/**
 * The sidebar list as it is drawn: what every module lists, in the one
 * order the counts and Alt+U take too, as the Person has it in view: the
 * tab, a cut list whole (`more`), the groups folded, and when inbox zero
 * last told of Someday; and this machine's Projects that wait for the
 * Person, but those whose trust they put off on this device. While the list
 * holds (`useHold`), what is drawn holds still and what moves waits; left
 * alone, the changes of a quarter of a second land together; the
 * Person's own acts, those on the Thread in view (`isCurrent`) by its
 * keys too, and another view draw at once (ADR 0098, decision 6).
 * `scene` changes as the view does, which draws the list afresh, with no
 * motion. `holder` is what the list's parts hold it by. While cards are
 * checked (`checks`, decision 15), the list holds too.
 */
export function useOrdered(
  projects: ProjectSummary[],
  settings: Settings,
  {
    tab,
    more,
    folded,
    someday,
    checks,
  }: {
    tab: Tab
    more: boolean
    folded: ReadonlySet<string>
    someday?: number
    checks?: Checks
  },
  isCurrent: (project: ProjectId, pane: PaneState) => boolean
) {
  // What every module lists, from the Window's items.
  const lists = useLists()
  // Where each Thread stands is read by the Later clock (ADR 0074).
  const now = useLaterClock()
  // The other machines of `hosts.toml` (ADR 0081): the rows of those the
  // order places, as the counts and Alt+U place them.
  const elsewhere = useElsewhere()
  const putOff = useNotNow()
  const fresh = useMemo(
    () =>
      order(lists, projects, now, {
        settings,
        elsewhere,
        putOff,
        tab,
        more,
        folded,
        ...(someday === undefined ? {} : { someday }),
      }),
    [
      lists,
      projects,
      now,
      settings,
      elsewhere,
      putOff,
      tab,
      more,
      folded,
      someday,
    ]
  )
  const { holding, take, by, list } = useHold({
    still: settings.hold.still,
    checking: checks !== undefined && checks.selected.size > 0,
  })
  // What is drawn, as its blocks, and what the Person did while it held.
  const [drawn, setDrawn] = useState<readonly Block[]>(fresh.blocks)
  const [mine, setMine] = useState<Mine>(NO_ACTS)
  // Another view, by the Person's hand, draws its order straight away;
  // so does a Project's trust they put off, which only their hand does.
  const [scene, setScene] = useState({ tab, more, folded, settings, putOff })
  if (
    scene.tab !== tab ||
    scene.more !== more ||
    scene.folded !== folded ||
    scene.settings !== settings ||
    scene.putOff !== putOff
  ) {
    setScene({ tab, more, folded, settings, putOff })
    setDrawn(fresh.blocks)
    setMine(NO_ACTS)
  }
  // The hold let go: what waited is drawn at once.
  const [wasHolding, setWasHolding] = useState(holding)
  if (wasHolding !== holding) {
    setWasHolding(holding)
    if (!holding) {
      setDrawn(fresh.blocks)
      setMine(NO_ACTS)
    }
  }
  // Left alone, the first change waits for the others that come with it,
  // and the batch lands the list as the render that lands it has it: a
  // change that comes as the batch is on its way to the screen opens the
  // next batch, and never waits for good. One that comes while it holds
  // waits for the hold. Landing forgets every act of the Person's, even one
  // whose change has not come back yet (#1294).
  const [batches, setBatches] = useState(0)
  const [landed, setLanded] = useState(batches)
  if (landed !== batches) {
    setLanded(batches)
    if (!holding) {
      setDrawn(fresh.blocks)
      setMine(NO_ACTS)
    }
  }
  const moved = useMemo(
    () => shapeOf(fresh.blocks) !== shapeOf(drawn),
    [fresh, drawn]
  )
  useEffect(() => {
    if (holding || !moved) return
    const timer = setTimeout(() => setBatches((batch) => batch + 1), BATCH)
    return () => clearTimeout(timer)
  }, [holding, moved])
  const kept = useMemo(
    () => hold(fresh, moved ? drawn : undefined, mine),
    [fresh, moved, drawn, mine]
  )
  // The rows below a slot an act by key closed snap up as it fades: the
  // card actions that come under the pointer take no click until a
  // moment after.
  const quietUntil = useRef(-Infinity)
  const closed = kept.closed.join(" ")
  useLayoutEffect(() => {
    if (closed) quietUntil.current = performance.now() + DUR_FAST + QUIET
  }, [closed])
  const quiet = useCallback(() => performance.now() < quietUntil.current, [])
  // Each act is told with where its card stood, and what takes it back:
  // `hold` applies it once its card has gone where only an act takes it.
  const act = useCallback(
    (row: Row, how?: By, undo?: Undoable) =>
      setMine((acts) =>
        new Map(acts).set(itemKey(row), {
          by: how ?? by(),
          was: row.stand,
          ...(undo ? { undo } : {}),
        })
      ),
    [by]
  )
  const holder: Holding = useMemo(
    () => ({ take, act, quiet }),
    [take, act, quiet]
  )
  // The Thread in view, wherever it stands: its keys act on its card.
  useOwnKeys(
    fresh.rows.find((row) => isCurrent(row.project.id, row.listed.pane)),
    holder
  )
  const undos = useMemo(
    () =>
      new Map(
        [...mine].flatMap(([key, { undo }]) =>
          undo ? [[key, undo] as const] : []
        )
      ),
    [mine]
  )
  const holds: Holds = {
    ghosts: kept.ghosts,
    undos,
    // Left alone, a card that left goes in the batch as all else lands,
    // by a fade, and is never dimmed first.
    leaving: holding ? kept.leaving : NOT_LEAVING,
    scene,
    now,
  }
  return {
    ordered: { ...fresh, blocks: kept.blocks },
    holds,
    holder,
    /** Whether the Person acted on a card since the list last landed. */
    acted: mine.size > 0,
    /** What the list's scroller listens to. */
    list,
  }
}
