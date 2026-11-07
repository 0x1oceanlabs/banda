/** A Visual the Agent showed (ADR 0037). */
import { Visual } from "../Visual"
import { useThreadAround } from "../thread/context"
import type { EntryProps } from "./types"

export function VisualEntry({ item }: EntryProps<"visual">) {
  const { project, acts } = useThreadAround()
  const { visual, title, height, heights } = item.body
  const args = { visual, title, height, heights }
  return (
    <Visual
      project={project}
      visual={args}
      onOpen={() => acts.openVisual(args)}
    />
  )
}
