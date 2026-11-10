/**
 * Bulk rename as text (ADR 0073, decision 10): the names of the rows
 * picked, one a line, in Banda's editor; then what changed, old against
 * new, in the shared diff view, before anything is renamed. A name that
 * is empty, holds a `/`, or is taken in its folder is refused, and the
 * renames undo as one.
 */
import { type RefObject, useMemo, useRef, useState } from "react"
import { Button } from "@banda/ui/components/button"
import { CodeDiff, fileOf } from "@banda/ui/components/code-diff"
import { CodeFile } from "@banda/ui/components/code-file"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@banda/ui/components/dialog"
import { type At, renameAll } from "./acts"
import {
  inOrder,
  namesText,
  type Named,
  readNames,
  type Renaming,
} from "./bulk"

const NONE: ReadonlySet<string> = new Set()
/** A number for each bulk rename, for its editor's own history. */
let renamed = 0

export function BulkRename({
  at,
  rows,
  taken,
  onClose,
}: {
  at: At
  /** The rows to rename, by their whole paths; none: it is closed. */
  rows: readonly Named[] | null
  /** What a folder holds now, by its whole path. */
  taken: (folder: string) => ReadonlySet<string>
  onClose: () => void
}) {
  // The dialog gives the keys to what holds the editor, which takes them
  // from there once it is drawn.
  const holder = useRef<HTMLDivElement>(null)
  return (
    <Dialog
      open={rows !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        initialFocus={holder}
        className="flex max-h-[80vh] flex-col sm:max-w-2xl"
      >
        {rows && (
          <Renamer
            at={at}
            rows={rows}
            taken={taken}
            holder={holder}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function Renamer({
  at,
  rows,
  taken,
  holder,
  onClose,
}: {
  at: At
  rows: readonly Named[]
  taken: (folder: string) => ReadonlySet<string>
  holder: RefObject<HTMLDivElement | null>
  onClose: () => void
}) {
  const before = useMemo(() => namesText(rows), [rows])
  const [key] = useState(() => `banda.rename.${++renamed}`)
  const [text, setText] = useState(before)
  const [review, setReview] = useState<Renaming[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Each text ends a line, so the diff says nothing of the last one's end.
  const files = useMemo(
    () => (review ? [fileOf("Names", lined(before), lined(text))] : []),
    [review, before, text]
  )
  const check = () => {
    const read = readNames(text, rows, taken)
    if ("problem" in read) return setProblem(read.problem)
    setProblem(null)
    if (read.renames.length === 0) return setProblem("No name changed.")
    setReview(read.renames)
  }
  const rename = async () => {
    if (!review) return
    setBusy(true)
    await renameAll(at, inOrder(review))
    setBusy(false)
    onClose()
  }
  return (
    <>
      <DialogHeader>
        <DialogTitle>Rename {rows.length} items</DialogTitle>
        <DialogDescription>
          {review
            ? `${review.length} ${review.length === 1 ? "name changes" : "names change"}: the old in red, the new in green.`
            : "One name a line, in their order: edit them as text."}
        </DialogDescription>
      </DialogHeader>
      <div
        ref={holder}
        tabIndex={-1}
        className="min-h-48 flex-1 overflow-hidden rounded-control border outline-none"
      >
        {review ? (
          <CodeDiff
            className="h-full max-h-[50vh]"
            files={files}
            folded={NONE}
            layout="stacked"
            wrap={false}
          />
        ) : (
          <CodeFile
            className="h-full max-h-[50vh]"
            name="names.txt"
            text={before}
            wrap={false}
            picked={null}
            onPick={() => {}}
            edit={{ key, onChange: setText, onDone: () => {} }}
          />
        )}
      </div>
      {problem && (
        <p role="alert" className="text-xs text-destructive">
          {problem}
        </p>
      )}
      <DialogFooter>
        {review ? (
          <>
            <Button variant="outline" onClick={() => setReview(null)}>
              Back
            </Button>
            <Button disabled={busy} onClick={() => void rename()}>
              Rename {review.length}
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={check}>Review changes</Button>
          </>
        )}
      </DialogFooter>
    </>
  )
}

/** `text` ending in one line's end. */
const lined = (text: string) => text.replace(/\n*$/, "\n")
