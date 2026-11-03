import { useCallback, useEffect, useMemo, useState } from "react"
import type { Engine, SpaceId, SpaceSummary } from "@banda/contract"
import type { Attention, Listed, Lists, Report, Watch } from "@banda/ui/pane"
import { runs, watches } from "../registry"
import { combine, folded } from "./attention"

/** Where each Watch's list goes too, for the window to tell what calls. */
export type Listening = {
  hear: (source: string, space: SpaceId, listed: readonly Listed[]) => void
  leave: (source: string) => void
}

/**
 * Draws every module's Watch for every Space, while the engine runs the
 * module, and says what they call the Person for together and what each
 * Space lists. It shows nothing: the bar and the sidebar show what it
 * says, and the window tells of what calls (ADR 0011).
 */
export function Watches({
  engine,
  modules,
  spaces,
  onChange,
  onLists,
  listening,
}: {
  engine: Engine
  modules: readonly string[]
  spaces: SpaceSummary[]
  onChange: (attention: Attention) => void
  onLists: (lists: Lists) => void
  listening: Listening
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
    const lists: Record<SpaceId, readonly Listed[]> = {}
    for (const { space, listed } of Object.values(reports)) {
      lists[space] = [...(lists[space] ?? []), ...listed]
    }
    for (const space in lists) lists[space] = folded(lists[space]!)
    return lists
  }, [reports])
  useEffect(() => onLists(lists), [onLists, lists])

  return watches
    .filter(({ module }) => runs(module, modules))
    .flatMap(({ watch, module }) =>
      spaces.map((space) => {
        const key = `${module.id}:${space.id}`
        return (
          <One
            key={key}
            id={key}
            watch={watch}
            engine={engine}
            space={space.id}
            hear={hear}
            listening={listening}
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
  listening,
}: {
  id: string
  watch: Watch
  engine: Engine
  space: SpaceId
  hear: (key: string, heard?: Heard) => void
  listening: Listening
}) {
  const { hear: listen, leave } = listening
  const report = useCallback(
    (report: Report) => {
      hear(id, { ...report, space })
      listen(id, space, report.listed)
    },
    [hear, listen, id, space]
  )
  // It says what it calls for itself, once drawn; leaving, it calls for
  // nothing.
  useEffect(
    () => () => {
      hear(id)
      leave(id)
    },
    [hear, leave, id]
  )
  const Watched = watch.Watch
  return <Watched engine={engine} space={space} report={report} />
}
