import { Button } from "@bandaso/ui/components/button"
import {
  Diff,
  DiffCounts,
  DiffGap,
  DiffHeader,
  DiffLine,
  DiffLines,
  DiffPath,
} from "@bandaso/ui/components/diff"
import { SquareArrowOutUpRightIcon } from "lucide-react"
import type { FileChange } from "./changes"
import { parts } from "./diff"

/** One file's change: its path, then the changed lines and a few around.
 * With `onOpen`, a button opens it in a Diff Pane of its own. */
export function FileDiff({
  path,
  old,
  lines,
  added,
  removed,
  onOpen,
}: FileChange & { onOpen?: () => void }) {
  return (
    <Diff>
      <DiffHeader title={path}>
        <DiffPath path={path} />
        {old === undefined && (
          <span className="shrink-0 text-muted-foreground">New file</span>
        )}
        <DiffCounts added={added} removed={removed} className="ml-auto" />
        {onOpen && (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Open the change to ${path} beside the Thread`}
            title="Open beside the Thread"
            onClick={onOpen}
          >
            <SquareArrowOutUpRightIcon />
          </Button>
        )}
      </DiffHeader>
      <DiffLines>
        {parts(lines).map((part, at) =>
          part.kind === "gap" ? (
            <DiffGap key={at}>
              ⋯ {part.lines} unchanged {part.lines === 1 ? "line" : "lines"}
            </DiffGap>
          ) : (
            <DiffLine key={at} kind={part.kind}>
              {part.text}
            </DiffLine>
          )
        )}
      </DiffLines>
    </Diff>
  )
}
