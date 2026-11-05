/**
 * The Commit dialog of the git button's `▾` (ADR 0034, decision 4), as
 * T3 Code's: the branch it commits to, the files with their lines, each
 * with its checkbox, and the message, which the Thread's Harness writes
 * when it is left empty. It only commits; Commit on new branch names one
 * for the change first.
 */
import { useState } from "react"
import type { Status } from "@banda/contract/git"
import { Button } from "@banda/ui/components/button"
import { Checkbox } from "@banda/ui/components/checkbox"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@banda/ui/components/dialog"
import { DiffCounts, DiffPath } from "@banda/ui/components/diff"
import { Textarea } from "@banda/ui/components/textarea"
import type { Commit } from "./chain"
import { NO_WRITER, onDefault } from "./quick"

/** The dialog's title: the branch it commits to. */
export function commitTitle(status: Status): string {
  return status.branch
    ? `Commit to ${status.branch}`
    : "Commit on a detached HEAD"
}

/** Its button, by how many files are taken. */
export function commitLabel(taken: number): string {
  return `Commit ${taken} ${taken === 1 ? "file" : "files"}`
}

/** Drawn while it is open, so each opening starts with every file taken
 * and no message. */
export function CommitDialog({
  status,
  writer,
  onClose,
  onCommit,
}: {
  status: Status
  /** The name of the Harness that writes an empty message, if one is on. */
  writer: string | null
  onClose: () => void
  onCommit: (commit: Commit) => void
}) {
  // Paths left out.
  const [out, setOut] = useState<ReadonlySet<string>>(new Set())
  const [message, setMessage] = useState("")
  const files = status.files
  const taken = files.filter((file) => !out.has(file.path))
  const toggle = (path: string, take: boolean) => {
    const next = new Set(out)
    if (take) next.delete(path)
    else next.add(path)
    setOut(next)
  }
  const blocked =
    taken.length === 0
      ? "Choose a file to commit."
      : !message.trim() && writer === null
        ? NO_WRITER
        : undefined
  const commit = (feature: boolean) => {
    onClose()
    onCommit({
      feature,
      // Every file is no list: what changes meanwhile goes too.
      files: out.size === 0 ? undefined : taken.map((file) => file.path),
      message: message.trim() || undefined,
    })
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="break-all">{commitTitle(status)}</DialogTitle>
          {onDefault(status) && (
            <DialogDescription>
              {status.branch} is the default branch.
            </DialogDescription>
          )}
        </DialogHeader>
        <ul
          aria-label="Files"
          className="max-h-52 overflow-y-auto rounded-lg border font-mono text-xs"
        >
          {files.map((file) => {
            const takes = !out.has(file.path)
            return (
              <li
                key={file.path}
                className="not-first:border-t data-[out=true]:text-muted-foreground"
                data-out={!takes}
              >
                <label className="flex cursor-pointer items-center gap-2 px-2 py-1.5">
                  <Checkbox
                    aria-label={`Commit ${file.path}`}
                    // Left out, an empty box plainly outlined; focused, a
                    // ring apart from it, never read as a fill.
                    className="transition-none not-data-checked:border-muted-foreground/60 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-popover"
                    checked={takes}
                    onCheckedChange={(take) => toggle(file.path, take)}
                  />
                  <span className="flex min-w-0 flex-1" title={file.path}>
                    <DiffPath path={file.path} />
                  </span>
                  <DiffCounts added={file.added} removed={file.removed} />
                </label>
              </li>
            )
          })}
        </ul>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          {writer === null
            ? "Message"
            : `Message (optional) — ${writer} writes it`}
          <Textarea
            value={message}
            className="min-h-16 font-normal"
            onChange={(event) => setMessage(event.target.value)}
          />
        </label>
        {/* A disabled button hears no hover: the reason shows here. */}
        {blocked && <p className="text-xs text-muted-foreground">{blocked}</p>}
        <DialogFooter className="flex-wrap">
          <Button
            variant="outline"
            className="sm:mr-auto"
            disabled={blocked !== undefined}
            onClick={() => commit(true)}
          >
            Commit on new branch
          </Button>
          <DialogClose render={<Button variant="outline" />}>
            Cancel
          </DialogClose>
          <Button
            disabled={blocked !== undefined}
            onClick={() => commit(false)}
          >
            {commitLabel(taken.length)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
