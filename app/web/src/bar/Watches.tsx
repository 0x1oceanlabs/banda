import { useCallback, useEffect, useMemo, useState } from "react"
import type { Engine, SpaceId, SpaceSummary } from "@bandaso/contract"
import type { Attention, Call, Listed, Report, Watch } from "@bandaso/ui/pane"
import { runs, watches } from "../registry"
import { combine } from "./attention"

/** What every module lists for each Space, for the sidebar. */
export type Lists = Readonly<Record<SpaceId, readonly Listed[]>>

/**
 * Draws every module's Watch for every Space, while the engine runs the
 * module, and says what they call the Person for together, what each
 * Space lists, and each call they make now. It shows nothing: the bar and
 * the sidebar show what it says, and the window plays the calls.
 */
export function Watches({
  engine,
  modules,
  spaces,
  onChange,
  onCall,
  onLists,
}: {
  engine: Engine
  modules: readonly string[]
  spaces: SpaceSummary[]
  onChange: (attention: Attention) => void
  onCall: (call: Call) => void
  onLists: (lists: Lists) => void
}) {
  const [reports, setReports] = useState<Record<string, Heard>>({})
  const hear = useCallback((key: string, heard?: Heard) => {
    setReports((reports) => {
      const before = reports[key]
      if (before && heard && same(before, heard)) return reports
      if (!before && !heard) return reports
      const next = { ...reports }
      if (heard) next[key] = heard
      else delete next[key]
      return next
    })
  }, [])

  const { mark, waiting } = useMemo(
    () => combine(Object.values(reports)),
    [reports]
  )
  useEffect(() => onChange({ mark, waiting }), [onChange, mark, waiting])
  const lists = useMemo(() => {
    const lists: Record<SpaceId, Listed[]> = {}
    for (const { space, listed } of Object.values(reports)) {
      lists[space] = [...(lists[space] ?? []), ...listed]
    }
    return lists
  }, [reports])
  useEffect(() => onLists(lists), [onLists, lists])

  return watches
    .filter((watch) => runs(watch, modules))
    .flatMap((watch) =>
      spaces.map((space) => {
        const key = `${watch.module}:${space.id}`
        return (
          <One
            key={key}
            id={key}
            watch={watch}
            engine={engine}
            space={space.id}
            hear={hear}
            call={onCall}
          />
        )
      })
    )
}

/** What one Watch said about one Space. */
type Heard = Report & { space: SpaceId }

function same(a: Heard, b: Heard): boolean {
  return a.mark === b.mark && a.waiting === b.waiting && a.listed === b.listed
}

/** One Watch on one Space; what it said goes with it. */
function One({
  id,
  watch,
  engine,
  space,
  hear,
  call,
}: {
  id: string
  watch: Watch
  engine: Engine
  space: SpaceId
  hear: (key: string, heard?: Heard) => void
  call: (call: Call) => void
}) {
  const report = useCallback(
    (report: Report) => hear(id, { ...report, space }),
    [hear, id, space]
  )
  // It says what it calls for itself, once drawn; leaving, it calls for
  // nothing.
  useEffect(() => () => hear(id), [hear, id])
  const Watched = watch.Watch
  return <Watched engine={engine} space={space} report={report} call={call} />
}
