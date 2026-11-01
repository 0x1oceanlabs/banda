import { useCallback, useEffect, useMemo, useState } from "react"
import type { Engine, SpaceId, SpaceSummary } from "@bandaso/contract"
import type { Attention, Watch } from "@bandaso/ui/pane"
import { runs, watches } from "../registry"
import { combine } from "./attention"

/**
 * Draws every module's Watch for every Space, while the engine runs the
 * module, and says what they call the Person for together. It shows
 * nothing: the bar shows what it says.
 */
export function Watches({
  engine,
  modules,
  spaces,
  onChange,
}: {
  engine: Engine
  modules: readonly string[]
  spaces: SpaceSummary[]
  onChange: (attention: Attention) => void
}) {
  const [reports, setReports] = useState<Record<string, Attention>>({})
  const hear = useCallback((key: string, attention?: Attention) => {
    setReports((reports) => {
      const before = reports[key]
      if (before && attention && same(before, attention)) return reports
      if (!before && !attention) return reports
      const next = { ...reports }
      if (attention) next[key] = attention
      else delete next[key]
      return next
    })
  }, [])

  const { mark, waiting } = useMemo(
    () => combine(Object.values(reports)),
    [reports]
  )
  useEffect(() => onChange({ mark, waiting }), [onChange, mark, waiting])

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
          />
        )
      })
    )
}

function same(a: Attention, b: Attention): boolean {
  return a.mark === b.mark && a.waiting === b.waiting
}

/** One Watch on one Space; what it said goes with it. */
function One({
  id,
  watch,
  engine,
  space,
  hear,
}: {
  id: string
  watch: Watch
  engine: Engine
  space: SpaceId
  hear: (key: string, attention?: Attention) => void
}) {
  const report = useCallback(
    (attention: Attention) => hear(id, attention),
    [hear, id]
  )
  // It says what it calls for itself, once drawn; leaving, it calls for
  // nothing.
  useEffect(() => () => hear(id), [hear, id])
  const Watched = watch.Watch
  return <Watched engine={engine} space={space} report={report} />
}
