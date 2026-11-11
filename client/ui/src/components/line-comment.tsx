/**
 * A comment on lines picked in a file or a diff, written under them, as
 * T3 Code's `DiffCommentAnnotation` is (ADR 0034, decision 9; ADR 0073,
 * decision 6): a small field, Cancel, and Comment, which hands the words
 * on. Ctrl or ⌘ with Enter comments, Escape cancels. It keeps nothing: the
 * comment goes into a Thread's message as a chip.
 */
import { useLayoutEffect, useRef, useState } from "react"
import { Button } from "./button"
import { Textarea } from "./textarea"

export function LineComment({
  lines,
  onComment,
  onCancel,
}: {
  /** The lines it is on, as the field names them: `12` or `12–14`. */
  lines: string
  onComment: (words: string) => void
  onCancel: () => void
}) {
  const [words, setWords] = useState("")
  const field = useRef<HTMLTextAreaElement>(null)
  // The code view draws it in a frame after this one.
  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() =>
      field.current?.focus({ preventScroll: true })
    )
    return () => cancelAnimationFrame(frame)
  }, [])
  const said = words.trim()
  return (
    <div
      data-line-comment
      className="px-3 py-2 font-sans text-foreground"
      // The view's own picking and keys stop here.
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === "Escape") {
          event.preventDefault()
          onCancel()
        } else if (
          event.key === "Enter" &&
          (event.ctrlKey || event.metaKey) &&
          said
        ) {
          event.preventDefault()
          onComment(said)
        }
      }}
    >
      <Textarea
        ref={field}
        value={words}
        placeholder="Add a comment…"
        aria-label={`Comment on lines ${lines}`}
        className="min-h-14 bg-background text-xs md:text-xs"
        onChange={(event) => setWords(event.target.value)}
      />
      <div className="mt-1.5 flex items-center gap-1">
        <span className="mr-auto text-meta text-muted-foreground">
          Ctrl+Enter to comment · it goes to the Thread's message
        </span>
        <Button variant="ghost" size="xs" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="xs" disabled={!said} onClick={() => onComment(said)}>
          Comment
        </Button>
      </div>
    </div>
  )
}
