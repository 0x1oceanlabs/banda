import { useEffect, useState } from "react"
import {
  keepZoom,
  ZOOM_KEYS,
  zoomBy,
  zoomId,
  type ZoomStep,
  zoomOf,
} from "../lib/zoom"
import type { Handler } from "./use-scope"

/** How long a new zoom shows, in ms. */
const SHOWN = 1000

/**
 * The zoom of what `what` names, which its Pane's zoom actions change
 * (`lib/zoom`, `zoomActions`). `by` steps it; `shown` is a new zoom for a
 * moment, for its `ZoomBadge`.
 */
export function useZoom(what: string) {
  const [shown, setShown] = useState<{ zoom: number } | null>(null)
  useEffect(() => {
    if (!shown) return
    const unshow = setTimeout(() => setShown(null), SHOWN)
    return () => clearTimeout(unshow)
  }, [shown])
  const by = (step: ZoomStep) => {
    const next = zoomBy(zoomOf(what), step)
    keepZoom(what, next)
    setShown({ zoom: next })
  }
  return { zoom: zoomOf(what), by, shown: shown?.zoom ?? null }
}

/** The handlers of the zoom actions `prefix.zoom-in`, `-out` and
 * `-reset`, for `useScope`: each steps by `by`. */
export function zoomHandlers(
  prefix: string,
  by: (step: ZoomStep) => void
): { [id: string]: Handler } {
  return Object.fromEntries(
    ZOOM_KEYS.map(({ does, by: step }) => [
      zoomId(prefix, does),
      () => {
        by(step)
        return true
      },
    ])
  )
}
