import { Button } from "@banda/ui/components/button"
import { MessageSquareIcon, XIcon } from "lucide-react"
import { type Comment, commentAt, commentLabel, commentStart } from "./comments"

/** The comments on files' lines the message carries, each a chip with
 * its file, its lines and the start of its words, to take out. */
export function CommentList({
  comments,
  onRemove,
}: {
  comments: readonly Comment[]
  onRemove: (id: string) => void
}) {
  return (
    <ul aria-label="Comments" className="flex flex-wrap gap-1.5 px-3.5 pt-3">
      {comments.map((one) => {
        const start = commentStart(one.comment)
        return (
          <li
            key={one.id}
            data-comment
            title={`${commentAt(one)}${one.comment ? `: ${one.comment}` : ""}`}
            className="flex h-6 max-w-full min-w-0 items-center gap-1 rounded-control bg-raised pr-0.5 pl-1.5 text-xs"
          >
            <MessageSquareIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="shrink-0 font-mono text-[11px]">
              {commentLabel(one)}
            </span>
            {start && (
              <span className="min-w-0 truncate text-muted-foreground">
                {start}
              </span>
            )}
            <Button
              variant="ghost"
              size="icon-xs"
              className="size-5 shrink-0 text-muted-foreground"
              aria-label={`Remove the comment on ${commentLabel(one)}`}
              onClick={() => onRemove(one.id)}
            >
              <XIcon />
            </Button>
          </li>
        )
      })}
    </ul>
  )
}
