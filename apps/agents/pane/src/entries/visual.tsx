/** A Visual the Agent showed (ADR 0037), from the machine that keeps it
 * (ADR 0106, decision 6). */
import { useMemo } from "react"
import { Visual } from "../visual/Visual"
import { useThreadAround } from "../thread/context"
import type { EntryProps } from "./types"

export function VisualEntry({ item }: EntryProps<"visual">) {
  const { engine, project, host, acts } = useThreadAround()
  const { visual, title, height, heights } = item.body
  const args = { visual, title, height, heights }
  const place = useMemo(
    () => ({ engine, project, host, openLink: acts.openLink }),
    [engine, project, host, acts]
  )
  return (
    <Visual place={place} visual={args} onOpen={() => acts.openVisual(args)} />
  )
}
