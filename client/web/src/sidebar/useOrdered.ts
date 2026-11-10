import { useMemo, useState } from "react"
import type { ProjectId, ProjectSummary } from "@banda/contract"
import { useLaterClock, useLists } from "../calls/stores"
import { type Held, held, hold } from "./hold"
import type { Tab } from "./inbox"
import { order, useElsewhere } from "./order"
import type { Settings } from "./settings"

/**
 * The sidebar list as it is drawn: what every module lists, in the one
 * order the counts and Alt+U take too, as the Person has it in view: the
 * tab, one Project's rows alone (`only`), a cut list whole (`more`), the
 * groups folded, and when inbox zero last told of Someday. Under the
 * pointer, the cards hold still (`take`); what would move or come waits
 * until the pointer leaves (`letGo`) (ADR 0098, decision 6).
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
  }: {
    tab: Tab
    only?: ProjectId
    more: boolean
    folded: ReadonlySet<string>
    someday?: number
  }
) {
  // What every module lists, from the Window's items.
  const lists = useLists()
  // Where each Thread stands is read by the Later clock (ADR 0074).
  const now = useLaterClock()
  // The other machines of `hosts.toml` (ADR 0081): the rows of those the
  // order places, as the counts and Alt+U place them.
  const elsewhere = useElsewhere()
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
    ]
  )
  // What the list held, and on which tab: another tab under the pointer
  // holds what it shows from the start, as a tab switch draws its order
  // straight away.
  const [holding, setHolding] = useState<{ tab: Tab; held: Held }>()
  if (holding && holding.tab !== tab)
    setHolding({ tab, held: held(fresh.blocks) })
  const blocks = useMemo(
    () => hold(fresh.blocks, holding?.held),
    [fresh, holding]
  )
  const take = () => setHolding({ tab, held: held(fresh.blocks) })
  const letGo = () => setHolding(undefined)
  return { ordered: { ...fresh, blocks }, take, letGo }
}
