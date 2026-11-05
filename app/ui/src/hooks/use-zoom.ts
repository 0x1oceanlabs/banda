import { useCallback, useEffect, useState } from "react"
import type { Pressed } from "../lib/keys"
import { keepZoom, zoomAfter, zoomOf } from "../lib/zoom"

/** How long a new zoom shows, in ms. */
const SHOWN = 1000

/**
 * The zoom of what `what` names, which Ctrl or ⌘ with + − 0 changes
 * (`lib/zoom`). `press` zooms by a key, and answers whether it did;
 * `shown` is a new zoom for a moment, for its `ZoomBadge`.
 */
export function useZoom(what: string) {
  const [shown, setShown] = useState<{ zoom: number } | null>(null)
  useEffect(() => {
    if (!shown) return
    const unshow = setTimeout(() => setShown(null), SHOWN)
    return () => clearTimeout(unshow)
  }, [shown])
  const press = useCallback(
    (event: Pressed): boolean => {
      const next = zoomAfter(event, zoomOf(what))
      if (next === null) return false
      keepZoom(what, next)
      setShown({ zoom: next })
      return true
    },
    [what]
  )
  return { zoom: zoomOf(what), press, shown: shown?.zoom ?? null }
}
