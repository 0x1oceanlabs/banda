/**
 * The Commit dialog of the git button's `▾` (ADR 0034, decision 4), as
 * T3 Code's: the branch, the files with their lines, which ones to leave
 * out behind Edit, and the message, which the Thread's Harness writes
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
import { onDefault } from "./quick"

/** Drawn while it is open, so each opening starts with every file taken
 * and no message. */
export function CommitDialog({
  status,
  writes,
  onClose,
  onCommit,
}: {
  status: Status
  /** A Harness is there to write an empty message. */
  writes: boolean
  onClose: () => void
  onCommit: (commit: Commit) => void
}) {
  // Paths left out.
  const [out, setOut] = useState<ReadonlySet<string>>(new Set())
  const [editing, setEditing] = useState(false)
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
      : !message.trim() && !writes
        ? "Write a message: a new Thread's Harness cannot yet."
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
          <DialogTitle>Commit changes</DialogTitle>
          <DialogDescription>
            Leave the message empty and the Thread’s Harness writes it.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5 rounded-lg border p-2.5 text-sm">
          <div className="flex gap-2">
            <span className="w-14 text-muted-foreground">Branch</span>
            <span className="truncate">
              {status.branch ?? "(detached HEAD)"}
            </span>
            {onDefault(status) && (
              <span className="ml-auto text-xs text-amber-600 dark:text-amber-400">
                Default branch
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="w-14 text-muted-foreground">Files</span>
            <span>
              {out.size === 0
                ? files.length
                : `${taken.length} of ${files.length}`}
            </span>
            <Button
              variant="ghost"
              size="xs"
              className="ml-auto"
              onClick={() => setEditing(!editing)}
            >
              {editing ? "Done" : "Edit"}
            </Button>
          </div>
          <ul className="max-h-44 overflow-y-auto rounded-md border font-mono text-xs">
            {files.map((file) => {
              const takes = !out.has(file.path)
              return (
                <li
                  key={file.path}
                  className="flex items-center gap-2 px-2 py-1.5 not-first:border-t data-[out=true]:text-muted-foreground"
                  data-out={!takes}
                >
                  {editing && (
                    <Checkbox
                      aria-label={`Commit ${file.path}`}
                      checked={takes}
                      onCheckedChange={(take) => toggle(file.path, take)}
                    />
                  )}
                  <span className="flex min-w-0 flex-1" title={file.path}>
                    <DiffPath path={file.path} />
                  </span>
                  {takes ? (
                    <DiffCounts added={file.added} removed={file.removed} />
                  ) : (
                    <span className="font-sans">Left out</span>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Message
          <Textarea
            value={message}
            placeholder="Empty: the Harness writes it"
            className="min-h-16 font-normal"
            onChange={(event) => setMessage(event.target.value)}
          />
        </label>
        <DialogFooter>
          {/* A disabled button hears no hover: the reason shows here. */}
          {blocked && (
            <p className="mr-auto self-center text-xs text-muted-foreground">
              {blocked}
            </p>
          )}
          <DialogClose render={<Button variant="outline" />}>
            Cancel
          </DialogClose>
          <Button
            variant="outline"
            disabled={blocked !== undefined}
            onClick={() => commit(true)}
          >
            Commit on new branch
          </Button>
          <Button
            disabled={blocked !== undefined}
            onClick={() => commit(false)}
          >
            Commit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
