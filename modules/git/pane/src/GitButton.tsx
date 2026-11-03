/**
 * The git button (ADR 0034, decision 4), as T3 Code's: one press runs
 * the whole chain (`chain.ts`). Its progress is in the button: the step,
 * a hook and its last line, a timer; then ✓ for ten seconds. An error
 * stays in the card until it is closed. A push on the default branch
 * asks first.
 */
import { useState, useSyncExternalStore } from "react"
import type { Engine, SpaceId } from "@banda/contract"
import type { Action, Status } from "@banda/contract/git"
import { Button } from "@banda/ui/components/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@banda/ui/components/dialog"
import { Spinner } from "@banda/ui/components/spinner"
import { DetailsRow } from "@banda/ui/components/thread-details"
import { useNow } from "@banda/ui/hooks/use-now"
import { duration } from "@banda/ui/lib/words"
import {
  CheckIcon,
  CircleAlertIcon,
  CloudDownloadIcon,
  CloudUploadIcon,
  GitCommitIcon,
  InfoIcon,
  XIcon,
} from "lucide-react"
import { dismiss, hearRun, run, runOf } from "./chain"
import { askOf, asksFirst, type Quick, quickOf } from "./quick"

const ICONS: Record<Quick["icon"], typeof GitCommitIcon> = {
  commit: GitCommitIcon,
  push: CloudUploadIcon,
  pull: CloudDownloadIcon,
  info: InfoIcon,
}

export function GitButton({
  engine,
  space,
  thread,
  status,
}: {
  engine: Engine
  space: SpaceId
  thread: string | null
  status: Status
}) {
  const now = useSyncExternalStore(
    (hear) => hearRun(space, hear),
    () => runOf(space)
  )
  const [asking, setAsking] = useState<Action | null>(null)
  const go = (action: Action, feature = false) => {
    setAsking(null)
    void run(engine, space, thread, action, feature)
  }

  if (now.is === "running")
    return (
      <div role="status" aria-live="polite" className="rounded-lg bg-muted/50">
        <DetailsRow icon={<Spinner />} end={<Elapsed since={now.since} />}>
          {now.label}
        </DetailsRow>
        <Under text={now.line} />
      </div>
    )
  if (now.is === "done")
    return (
      <div role="status" title={now.title}>
        <DetailsRow icon={<CheckIcon className="text-added" />}>
          {now.title}
        </DetailsRow>
        <Under text={now.detail} />
      </div>
    )

  const quick = quickOf(status, { writes: thread !== null })
  const Icon = ICONS[quick.icon]
  const ask = asking && askOf(asking, status.branch ?? "")
  return (
    <>
      {now.is === "failed" && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg bg-destructive/10 py-1 pr-1 pl-2 text-xs text-destructive"
        >
          <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 py-0.5 break-words">
            {now.message}
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Close"
            onClick={() => dismiss(space)}
          >
            <XIcon />
          </Button>
        </div>
      )}
      {/* A disabled button hears no hover: its row says why. */}
      <div title={quick.hint}>
        <DetailsRow
          icon={<Icon />}
          disabled={quick.action === null}
          onClick={() => {
            const action = quick.action
            if (!action) return
            if (asksFirst(status, action)) setAsking(action)
            else go(action)
          }}
        >
          {quick.label}
        </DetailsRow>
      </div>
      <Dialog
        open={asking !== null}
        onOpenChange={(open) => !open && setAsking(null)}
      >
        {asking && ask && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{ask.title}</DialogTitle>
              <DialogDescription>{ask.body}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>
                Abort
              </DialogClose>
              <Button variant="outline" onClick={() => go(asking)}>
                {ask.go}
              </Button>
              <Button
                disabled={asking !== "commit_push"}
                title={
                  asking === "commit_push"
                    ? undefined
                    : "With no changes to commit, the branch has nothing to be named for."
                }
                onClick={() => go(asking, true)}
              >
                Check out feature branch & continue
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </>
  )
}

/** How long it has run, ticking on its own. */
function Elapsed({ since }: { since: number }) {
  const now = useNow(1000)
  return (
    <span className="text-xs text-muted-foreground tabular-nums">
      {duration(now - since)}
    </span>
  )
}

/** A quieter line under a row: a hook's last, or a commit's subject. */
function Under({ text }: { text?: string }) {
  if (!text) return null
  return (
    <p
      title={text}
      className="-mt-1.5 truncate pr-2 pb-1.5 pl-8 text-[11px] text-muted-foreground"
    >
      {text}
    </p>
  )
}
