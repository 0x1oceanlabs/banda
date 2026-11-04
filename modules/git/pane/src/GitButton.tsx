/**
 * The git button (ADR 0034, decision 4), as T3 Code's: one press runs
 * the whole chain (`chain.ts`). Its progress is in the button: the step,
 * a hook and its last line, a timer; then ✓ for ten seconds. An error
 * stays in the card until it is closed. A push on the default branch
 * asks first.
 */
import { type ReactNode, useState, useSyncExternalStore } from "react"
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@banda/ui/components/dropdown-menu"
import { Spinner } from "@banda/ui/components/spinner"
import { DetailsRow, ROW_HOVER } from "@banda/ui/components/thread-details"
import { useNow } from "@banda/ui/hooks/use-now"
import { duration } from "@banda/ui/lib/words"
import { cn } from "@banda/ui/lib/utils"
import {
  CheckIcon,
  ChevronDownIcon,
  CloudDownloadIcon,
  CloudUploadIcon,
  GitCommitIcon,
  InfoIcon,
} from "lucide-react"
import { dismiss, hearRun, run, runOf } from "./chain"
import { CommitDialog } from "./CommitDialog"
import {
  askOf,
  asksFirst,
  type Item,
  menuOf,
  type Quick,
  quickOf,
} from "./quick"
import { GitAlert } from "./GitAlert"

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
  const [committing, setCommitting] = useState(false)
  const go = (action: Action, feature = false) => {
    setAsking(null)
    void run(engine, space, thread, action, { feature })
  }
  // A push on the default branch asks first.
  const press = (action: Action) =>
    asksFirst(status, action) ? setAsking(action) : go(action)

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
        <GitAlert
          className="rounded-lg bg-destructive/10 py-1 pr-1 pl-2"
          onDismiss={() => dismiss(space)}
        >
          {now.message}
        </GitAlert>
      )}
      <div
        className={cn(
          "group/split flex items-center rounded-lg has-data-popup-open:bg-black/[3.5%] dark:has-data-popup-open:bg-white/8",
          ROW_HOVER
        )}
      >
        <Why hint={quick.hint} className="min-w-0 flex-1">
          <DetailsRow
            icon={<Icon />}
            disabled={quick.action === null}
            className="hover:bg-transparent dark:hover:bg-transparent"
            onClick={() => quick.action && press(quick.action)}
          >
            {quick.label}
          </DetailsRow>
        </Why>
        <Menu
          status={status}
          onCommit={() => setCommitting(true)}
          onPush={() => press("push")}
          onPull={() => go("pull")}
        />
      </div>
      {committing && (
        <CommitDialog
          status={status}
          writes={thread !== null}
          onClose={() => setCommitting(false)}
          onCommit={(commit) =>
            void run(engine, space, thread, "commit", commit)
          }
        />
      )}
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

/** The `▾`: Commit… opens the dialog; Push and Pull run at once. What
 * cannot run says why on hover. */
function Menu({
  status,
  onCommit,
  onPush,
  onPull,
}: {
  status: Status
  onCommit: () => void
  onPush: () => void
  onPull: () => void
}) {
  const menu = menuOf(status)
  const item = (
    label: string,
    Icon: typeof GitCommitIcon,
    { can, hint }: Item,
    onClick: () => void
  ) => (
    <Why hint={hint}>
      <DropdownMenuItem disabled={!can} onClick={onClick}>
        <Icon />
        {label}
      </DropdownMenuItem>
    </Why>
  )
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="More git actions"
            className="mr-1 shrink-0 border-l border-transparent group-hover/split:border-border hover:bg-transparent data-popup-open:border-border"
          />
        }
      >
        <ChevronDownIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {item("Commit…", GitCommitIcon, menu.commit, onCommit)}
        {item("Push", CloudUploadIcon, menu.push, onPush)}
        {item("Pull", CloudDownloadIcon, menu.pull, onPull)}
        {menu.follows && (
          <p className="px-2 pt-1.5 pb-1 text-[11px] text-muted-foreground">
            Pull and Push follow the upstream {menu.follows}.
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** What is disabled hears no hover (`pointer-events: none`): what holds
 * it says why. */
function Why({
  hint,
  className,
  children,
}: {
  hint?: string
  className?: string
  children: ReactNode
}) {
  if (!hint) return children
  return (
    <div title={hint} className={className}>
      {children}
    </div>
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
