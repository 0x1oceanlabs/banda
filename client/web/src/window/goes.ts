/** Going from one workspace to another, as the Pager and a swipe ask. */
import { useCallback } from "react"
import { go, step } from "../tiling/model"
import type { useTiling } from "../tiling/useTiling"

export function useGoes(change: ReturnType<typeof useTiling>["change"]) {
  // Goes to workspace `id`, as its number does.
  const goTo = useCallback(
    (id: string) =>
      change((w) => {
        const index = w.list.findIndex((each) => each.id === id)
        return index < 0 ? undefined : go(w, index)
      }),
    [change]
  )
  // A swipe up or down with the mod held steps once.
  const stepBy = useCallback(
    (by: 1 | -1) => change((w) => step(w, by)),
    [change]
  )
  return { goTo, stepBy }
}
