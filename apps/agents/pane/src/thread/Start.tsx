/**
 * A Thread not yet started (ADR 0114, decisions 1 to 3): one phrase,
 * "Write to [who] in [where]", in the middle; a line under it when the
 * account it starts on needs saying; then the Project's latest Threads.
 * The Message box stays at the foot.
 */
import { useMemo, useState } from "react"
import type { Engine, ProjectId } from "@banda/contract"
import type { ListedThread } from "@banda/contract/agents"
import { Emblem } from "@banda/ui/components/emblem"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@banda/ui/components/popover"
import { Button } from "@banda/ui/components/button"
import { useLive } from "@banda/ui/hooks/use-live"
import { useNow } from "@banda/ui/hooks/use-now"
import type { PaneState } from "@banda/ui/pane"
import { ChevronDownIcon, MessageSquareIcon } from "lucide-react"
import { ago } from "@banda/ui/lib/words"
import { Heading, Row } from "../composer/WhoPicker"
import type { WhoGroup } from "../composer/who"
import { PHRASE_WORD } from "../settings/ThreadSettings"
import type { HarnessView } from "@banda/contract/harnesses"
import { threadsSource } from "../list/list"
import { threadPaneOf } from "../list/rows"

/** How many of the Project's Threads the start shows. */
const RECENT = 3

export function Start({
  now,
  groups,
  where,
  why,
  asks,
  engine,
  project,
  disabled,
  onWho,
  onOpen,
}: {
  /** The account it starts on. */
  now: HarnessView | undefined
  /** Whom it may start on, each Harness's accounts under its title. */
  groups: readonly WhoGroup[]
  /** The "where", as `NewThreadBar` draws it in the phrase. */
  where: React.ReactNode
  /** Why it starts on this account, when that needs saying: the default
   * is out. */
  why?: string
  /** Its mode asks before anything that needs a yes. */
  asks: boolean
  engine: Engine
  project: ProjectId
  disabled: boolean
  onWho: (account: string) => void
  /** Opens one of the Project's Threads instead. */
  onOpen: (pane: PaneState) => void
}) {
  const [open, setOpen] = useState(false)
  const recent = useRecent(engine, project)
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
      <div className="flex flex-wrap items-center justify-center gap-x-1 gap-y-0.5 text-heading font-medium text-muted-foreground">
        <span>Write to</span>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            disabled={disabled || groups.length === 0}
            render={
              <Button
                variant="ghost"
                className={PHRASE_WORD}
                aria-label={`Account: ${now?.name ?? "none"}`}
              />
            }
          >
            {now && <Emblem of={now} className="size-4.5" />}
            {now?.name ?? "No account"}
            <ChevronDownIcon className="text-muted-foreground" />
          </PopoverTrigger>
          <PopoverContent side="bottom" className="w-80 gap-0 rounded-card p-1">
            {groups.map((group) => (
              <div key={group.title} role="group" aria-label={group.title}>
                <Heading>{group.title}</Heading>
                {group.rows.map((row) => (
                  <Row
                    key={row.move.harness.id}
                    row={row}
                    onPick={() => {
                      setOpen(false)
                      onWho(row.move.harness.id)
                    }}
                  />
                ))}
              </div>
            ))}
          </PopoverContent>
        </Popover>
        <span>in</span>
        {where}
      </div>
      {(why || asks) && (
        <p className="-mt-2 max-w-md text-center text-meta text-muted-foreground">
          {why ?? "It asks you before anything that needs your yes."}
        </p>
      )}
      {recent.shown.length > 0 && (
        <Recent threads={recent.shown} count={recent.count} onOpen={onOpen} />
      )}
    </div>
  )
}

/** The Project's latest Threads, read from its engine and followed. */
function useRecent(
  engine: Engine,
  project: ProjectId
): { shown: ListedThread[]; count: number } {
  const source = useMemo(
    () => threadsSource(engine, project),
    [engine, project]
  )
  const live = useLive(engine, project, source)
  const threads = live.state === "ready" ? live.view.threads : undefined
  return useMemo(() => recentOf(threads ?? []), [threads])
}

/** Of a Project's Threads, those the start shows: the latest first, none
 * archived and no sub-agent's, and how many there are. */
export function recentOf(threads: readonly ListedThread[]): {
  shown: ListedThread[]
  count: number
} {
  const own = threads.filter((one) => !one.archived && !one.parent)
  const shown = [...own]
    .sort((a, b) => b.updated_at - a.updated_at)
    .slice(0, RECENT)
  return { shown, count: own.length }
}

function Recent({
  threads,
  count,
  onOpen,
}: {
  threads: readonly ListedThread[]
  count: number
  onOpen: (pane: PaneState) => void
}) {
  const now = useNow(60_000)
  return (
    <div className="flex w-full max-w-md flex-col gap-px">
      <div className="flex justify-between px-2 pb-1 text-meta text-muted-foreground">
        <span>Recent</span>
        {count > threads.length && <span>{count} in all</span>}
      </div>
      {threads.map((thread) => (
        <button
          key={thread.id}
          type="button"
          className="flex items-center gap-2 rounded-control px-2 py-1 text-left text-ui outline-none hover:bg-accent focus-visible:bg-accent"
          onClick={() => onOpen(threadPaneOf(thread))}
        >
          <MessageSquareIcon
            aria-hidden
            className="size-4 shrink-0 text-muted-foreground"
          />
          <span className="min-w-0 flex-1 truncate">
            {thread.title || "New Thread"}
          </span>
          <span className="shrink-0 text-meta text-muted-foreground tabular-nums">
            {ago(thread.updated_at, now)}
          </span>
        </button>
      ))}
    </div>
  )
}
