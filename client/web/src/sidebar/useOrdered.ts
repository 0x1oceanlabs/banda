import { useMemo, useState } from "react"
import type { ProjectId, ProjectSummary } from "@banda/contract"
import { useLaterClock, useLists } from "../calls/stores"
import { type Held, held, hold } from "./hold"
import { order, useElsewhere } from "./order"
import type { Settings } from "./settings"

/**
 * The sidebar list as it is drawn: what every module lists, in the one
 * order the counts and Alt+U take too, as the Person has it in view
 * (`only`, `toggled`). Under the pointer, the rows hold still; what would
 * move or come waits as `updates`, taken in by the pill (`take`) or as
 * the pointer leaves (`letGo`) (ADR 0065, decision 8).
 */
export function useOrdered(
  projects: ProjectSummary[],
  settings: Settings,
  { only, toggled }: { only?: ProjectId; toggled: ReadonlySet<string> }
) {
  // What every module lists, from the Window's items.
  const lists = useLists()
  // Where each Thread stands is read by the Later clock (ADR 0074).
  const now = useLaterClock()
  // The other machines of `hosts.toml` (ADR 0081): the rows of those the
  // order places, as the counts and Alt+U place them.
  const elsewhere = useElsewhere()
  const fresh = useMemo(
    () => order(lists, projects, now, { settings, only, toggled, elsewhere }),
    [lists, projects, now, settings, only, toggled, elsewhere]
  )
  const [holding, setHolding] = useState<Held>()
  const { arranged, updates } = useMemo(
    () => hold(fresh, holding),
    [fresh, holding]
  )
  const take = () => setHolding(held(fresh))
  const letGo = () => setHolding(undefined)
  return { arranged, updates, take, letGo }
}
