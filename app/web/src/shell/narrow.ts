import { useCallback, useMemo, useSyncExternalStore } from "react"
import { remInPx } from "../workspaces/layout"

/**
 * Whether the window is narrower than the sidebar and one column `min` rem
 * wide, so the sidebar hides (ADR 0025, decision 10).
 */
export function useNarrow(min: number): boolean {
  // The width in pixels, as the look has the rem now; a media query's rem
  // would not follow `[font] size`.
  const query = useMemo(() => {
    const sidebar = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue(
        "--sidebar-width"
      )
    )
    return matchMedia(`(max-width: ${(sidebar + min) * remInPx() - 0.02}px)`)
  }, [min])
  const subscribe = useCallback(
    (changed: () => void) => {
      query.addEventListener("change", changed)
      return () => query.removeEventListener("change", changed)
    },
    [query]
  )
  return useSyncExternalStore(subscribe, () => query.matches)
}
