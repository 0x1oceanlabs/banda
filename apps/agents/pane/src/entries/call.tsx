/** A tool call, and its changes when it made any. */
import { ToolCall } from "../ToolCall"
import { useThreadAround } from "../thread/context"
import type { EntryProps } from "./types"

export function CallEntry({ item, turn, asks }: EntryProps<"tool">) {
  const { reader, acts } = useThreadAround()
  // A call that failed changed nothing the turn's changes show.
  const changed = item.body.status !== "failed" ? item.turn : undefined
  return (
    <ToolCall
      tool={item.body}
      reader={reader}
      turn={turn}
      asks={asks}
      onOpenDiff={
        changed === undefined
          ? undefined
          : (path) => acts.openDiff(changed, path)
      }
    />
  )
}
