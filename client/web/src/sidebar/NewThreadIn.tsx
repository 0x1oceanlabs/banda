import type { ProjectSummary } from "@banda/contract"
import { Button } from "@banda/ui/components/button"
import { SquarePenIcon } from "lucide-react"
import { newThread, useOpen } from "./open"

/** A New Thread button in a Project's header or line. */
export function NewThreadIn({ project }: { project: ProjectSummary }) {
  const open = useOpen()
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={`New Thread in ${project.name}`}
      title="New Thread"
      className="opacity-0 group-hover/head:opacity-100 focus-visible:opacity-100"
      onClick={() => newThread(open, project.id, project.missing)}
    >
      <SquarePenIcon />
    </Button>
  )
}
