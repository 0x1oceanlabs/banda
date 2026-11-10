import { useCallback, useState } from "react"
import { problem as words } from "@banda/ui/lib/words"

/**
 * Runs a Person's action: one at a time, with what went wrong in plain
 * words until the next try. `what` names it, as `problem` takes it: "arc
 * is away: Revert was not sent."
 */
export function useAct() {
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string>()
  const act = useCallback(
    async <T>(run: () => Promise<T>, what?: string): Promise<T | undefined> => {
      setBusy(true)
      setProblem(undefined)
      try {
        return await run()
      } catch (error) {
        setProblem(words(error, what))
        return undefined
      } finally {
        setBusy(false)
      }
    },
    []
  )
  return { busy, problem, act }
}
