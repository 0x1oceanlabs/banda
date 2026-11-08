/** A Visual the Agent showed (ADR 0037). */
import { ChartLineIcon } from "lucide-react"
import { Visual } from "../visual/Visual"
import { useThreadAround } from "../thread/context"
import type { EntryProps } from "./types"

export function VisualEntry({ item }: EntryProps<"visual">) {
  const { project, host, acts } = useThreadAround()
  const { visual, title, height, heights } = item.body
  const args = { visual, title, height, heights }
  // This machine serves only its own Projects' Visuals (ADR 0081).
  if (host !== undefined)
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <ChartLineIcon className="size-4 shrink-0" />
        <span className="min-w-0 truncate">{title}</span>
        <span className="shrink-0 text-xs">A Visual on {host}</span>
      </p>
    )
  return (
    <Visual
      project={project}
      visual={args}
      onOpen={() => acts.openVisual(args)}
    />
  )
}
