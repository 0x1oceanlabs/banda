import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import type { ProjectId, ProjectSummary } from "@banda/contract"
import {
  sameData,
  type Shown,
  useHereNamed,
  useHostsBy,
} from "@banda/core/react"
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
import { finds, type Names, queryOf } from "./search"
import type { Settings } from "./settings"
import type { Undoable } from "./undo"
import { type Holding, useHold, useOwnKeys } from "./useHold"

/** How long the first change of a list left alone waits for the others
 * that come with it, in ms: they all land in one commit (ADR 0088,
 * decision 7). */
const BATCH = 250

const NO_ACTS: Mine = new Map()
const NOT_LEAVING: ReadonlyMap<string, Went> = new Map()

/** The name each other machine says it has, by its name in `hosts.toml`. */
const hostNames = (hosts: readonly Shown[]): Record<string, string> =>
  Object.fromEntries(hosts.map((host) => [host.name, host.named.name]))

/** How a search names a row's machine (`Names`): another's by its name in
 * `hosts.toml` and the one it says it has; this one's by its own. */
function useNames(): Names {
  const here = useHereNamed()?.name
  const named = useHostsBy(hostNames, sameData)
  return useCallback(
    (host) => {
      if (host === undefined) return here === undefined ? [] : [here]
      const said = named[host]
      return said === undefined ? [host] : [host, said]
    },
    [here, named]
  )
}

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
  /** A search runs, and nothing in the list moves (spec §2.2). */
  searching: boolean
}

/**
 * The sidebar list as it is drawn: what every module lists, in the one
 * order the counts and Alt+U take too, as the Person has it in view: the
 * tab, one Project's rows alone (`only`), a cut list whole (`more`), the
 * groups folded, and when inbox zero last told of Someday. While the list
 * holds (`useHold`), what is drawn holds still and what moves waits; left
 * alone, the changes of a quarter of a second land together; the
 * Person's own acts, those on the Thread in view (`isCurrent`) by its
 * keys too, and another view, a search's too, draw at once (ADR 0098,
 * decision 6). A search in place (decision 17) takes the rows it finds,
 * by their words and filters at the Later clock's `now`.
 * `scene` changes as the view does, which draws the list afresh, with no
 * motion. `holder` is what the list's parts hold it by. While cards are
 * checked (`checks`, decision 15), the list holds too.
 */
export function useOrdered(
  projects: ProjectSummary[],
  settings: Settings,
  {
    tab,
    only,
    more,
    folded,
    someday,
    checks,
    search,
  }: {
    tab: Tab
    only?: ProjectId
    more: boolean
    folded: ReadonlySet<string>
    someday?: number
    checks?: Checks
    /** What Search says. */
    search: string
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
  // What Search asks while it runs (decision 17), and how it names a row's
  // machine for `on:`.
  const query = useMemo(
    () => (search.trim() === "" ? undefined : queryOf(search)),
    [search]
  )
  const names = useNames()
  const fresh = useMemo(
    () =>
      order(lists, projects, now, {
        settings,
        only,
        elsewhere,
        tab,
        more,
        folded,
        ...(someday === undefined ? {} : { someday }),
        ...(query && {
          search: {
            words: query.text,
            found: (row: Row) => finds(query, row, now, names),
          },
        }),
      }),
    [
      lists,
      projects,
      now,
      settings,
      only,
      elsewhere,
      tab,
      more,
      folded,
      someday,
      query,
      names,
    ]
  )
  const { holding, take, by, list } = useHold({
    still: settings.hold.still,
    checking: checks !== undefined && checks.selected.size > 0,
  })
  // What is drawn, as its blocks, and what the Person did while it held.
  const [drawn, setDrawn] = useState<readonly Block[]>(fresh.blocks)
  const [mine, setMine] = useState<Mine>(NO_ACTS)
  // Another view, by the Person's hand, draws its order straight away.
  const words = query?.text
  const [scene, setScene] = useState({
    tab,
    only,
    more,
    folded,
    settings,
    words,
  })
  if (
    scene.tab !== tab ||
    scene.only !== only ||
    scene.more !== more ||
    scene.folded !== folded ||
    scene.settings !== settings ||
    scene.words !== words
  ) {
    setScene({ tab, only, more, folded, settings, words })
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
    searching: query !== undefined,
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
