import { useCallback, useState } from "react"
import { problem as words } from "@bandaso/ui/lib/words"

/**
 * Runs a Person's action: one at a time, with what went wrong in plain
 * words until the next try.
 */
export function useAct() {
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string>()
  const act = useCallback(
    async <T>(run: () => Promise<T>): Promise<T | undefined> => {
      setBusy(true)
      setProblem(undefined)
      try {
        return await run()
      } catch (error) {
        setProblem(words(error))
        return undefined
      } finally {
        setBusy(false)
      }
    },
    []
  )
  return { busy, problem, act }
}
