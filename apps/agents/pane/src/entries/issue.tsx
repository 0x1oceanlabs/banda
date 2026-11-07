/** An Issue the Agent drafted for its Person (ADR 0039). */
import { Issue } from "../Issue"
import { useThreadAround } from "../thread/context"
import type { EntryProps } from "./types"

export function IssueEntry({ item }: EntryProps<"issue">) {
  const { engine, project } = useThreadAround()
  return (
    <Issue engine={engine} project={project} item={item.id} issue={item.body} />
  )
}
