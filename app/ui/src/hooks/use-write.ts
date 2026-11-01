import { useState } from "react"
import { problem } from "@banda/ui/lib/words"

/**
 * Writes a setting through `banda settings` (ADR 0016), which answers what
 * was wrong when it refused, a problem a line. Keeps that until the next
 * write; `onWritten` runs after one that went through.
 */
export function useWrite(onWritten?: () => void) {
  const [refused, setRefused] = useState<string[]>([])
  const write = (said: Promise<string[]>) =>
    void said.then(
      (wrong) => {
        setRefused(wrong)
        if (wrong.length === 0) onWritten?.()
      },
      (error: unknown) => setRefused([problem(error)])
    )
  return { refused, write }
}
