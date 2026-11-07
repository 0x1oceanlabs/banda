/** A turn's changes, as a card with Review (ADR 0058, decision 7). */
import { ChangedFiles } from "../ChangedFiles"
import { useThreadAround } from "../thread/context"
import type { LineProps } from "./types"

export function ChangesLine({ line }: LineProps<"changes">) {
  const { acts } = useThreadAround()
  return (
    <ChangedFiles
      files={line.files}
      onOpen={(path) => acts.openDiff(line.turn.id, path)}
    />
  )
}
