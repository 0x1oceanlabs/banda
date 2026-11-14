import { useRef, useState } from "react"
import { problem } from "@banda/ui/lib/words"

/**
 * Writes a setting through `banda settings` (ADR 0016), which answers what
 * was wrong when it refused, a problem a line. Only the last write's answer
 * counts: one sent before it, as a field's blur on the way to ↶, answers
 * too late to say anything. The answer stands while `against`, the value
 * the write was against, stays: a file changed since, by hand or by a
 * later write, takes it away, and so does `forget`, as the Person leaves
 * what was refused. `onWritten` runs after a write that went through.
 */
export function useWrite({
  onWritten,
  against,
}: { onWritten?: () => void; against?: unknown } = {}) {
  const [said, setSaid] = useState<{ against?: string; refused: string[] }>()
  const last = useRef(0)
  const now = JSON.stringify(against)
  const write = (answer: Promise<string[]>) => {
    const mine = ++last.current
    const say = (refused: string[]) => {
      if (mine === last.current) setSaid({ against: now, refused })
    }
    void answer.then(
      (wrong) => {
        say(wrong)
        if (wrong.length === 0) onWritten?.()
      },
      (error: unknown) => say([problem(error)])
    )
  }
  const refused = said && said.against === now ? said.refused : []
  const forget = () => {
    last.current++
    setSaid(undefined)
  }
  return { refused, write, forget }
}
