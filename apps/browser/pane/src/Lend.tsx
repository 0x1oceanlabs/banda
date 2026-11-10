/**
 * A tab's lend, at the end of its address (ADR 0083, decision 4), where
 * Chrome keeps its bookmark star. On a tab of the Person's, a button with
 * an empty Agent's mark opens the Threads of the Pane's Project, and the
 * one they pick sees and drives the tab. Once lent, a quiet chip takes the
 * button's place: the Thread's mark in its Agent's state colour, as its
 * Group's plate has it, and its name, which the address gives up its own
 * room for, keeping the mark alone where it is narrow. The chip's card
 * takes the tab back, or goes to the Thread.
 */
import type { ProjectId } from "@banda/contract"
import {
  BandaMark,
  EmptyMark,
  groupState,
  MARK_WORDS,
  ThreadMark,
  works,
} from "@banda/ui/components/banda-mark"
import { Button } from "@banda/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@banda/ui/components/dropdown-menu"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@banda/ui/components/popover"
import { useKeyLabel } from "@banda/ui/hooks/use-key-of"
import { useNow } from "@banda/ui/hooks/use-now"
import { cn } from "@banda/ui/lib/utils"
import { ago, MINUTE } from "@banda/ui/lib/words"
import type { Listed } from "@banda/ui/pane"
import { ArrowRightIcon, Undo2Icon } from "lucide-react"
import { useEffect, useRef } from "react"
import { LEND } from "./keys"
import { useLentTo, useProjectName, useThreadOf, useThreadsOf } from "./threads"

/** What a Thread's state reads: at work, "Working"; at rest, how long
 * ago it changed, or none. */
function wordOf(listed: Listed, now?: number): string | undefined {
  const { mark } = listed
  if (works(mark)) return MARK_WORDS.running
  if (mark !== "rest" && mark !== "idle") return MARK_WORDS[mark]
  return now === undefined ? undefined : ago(listed.changed, now)
}

/**
 * The mark of the Thread of `agent`, which a tab is lent to, still, in
 * its Agent's state colour; at rest while the window does not list it.
 * The tab and the chip wear it.
 */
export function LentMark({
  agent,
  className,
}: {
  agent: string
  className?: string
}) {
  const mark = useThreadOf(agent)?.mark ?? "rest"
  const to = useLentTo(agent)
  return (
    <span
      data-lent
      data-state={groupState(mark)}
      className="flex shrink-0 text-(--group-color)"
    >
      <BandaMark
        variant="agent"
        state={mark}
        playful={0}
        news={false}
        label={`Lent to ${to}`}
        className={cn("size-3", className)}
      />
    </span>
  )
}

/**
 * The button that lends a tab of the Person's: it opens the Threads of
 * `project`, the latest first, each as the sidebar shows it, and lends
 * the tab to the one picked. Its key, or a click, opens it; opened
 * `byKey`, its first Thread has the focus, so Enter picks it.
 */
export function LendButton({
  project,
  open,
  byKey,
  onOpen,
  onLend,
}: {
  project: ProjectId
  open: boolean
  byKey: boolean
  onOpen: (open: boolean) => void
  onLend: (thread: Listed) => void
}) {
  const label = useKeyLabel()
  const threads = useThreadsOf(project)
  const name = useProjectName(project)
  const now = useNow(MINUTE, open)
  const words = "Lend this tab to a Thread"
  const menu = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open || !byKey) return
    // After the menu took the focus as it opened.
    const frame = requestAnimationFrame(() =>
      menu.current
        ?.querySelector<HTMLElement>(
          '[role="menuitem"]:not([aria-disabled="true"])'
        )
        ?.focus()
    )
    return () => cancelAnimationFrame(frame)
  }, [open, byKey])
  return (
    <DropdownMenu open={open} onOpenChange={onOpen}>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={words}
            title={label(LEND, words)}
            className="size-5 shrink-0 rounded-small text-muted-foreground/70 hover:text-foreground data-popup-open:bg-muted data-popup-open:text-foreground"
          />
        }
      >
        <EmptyMark className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent ref={menu} align="end" className="w-66">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="truncate">
            {name ? `${words} in ${name}` : words}
          </DropdownMenuLabel>
          {threads.map((thread) => (
            <DropdownMenuItem
              key={thread.id}
              className="gap-2"
              onClick={() => onLend(thread)}
            >
              <ThreadMark listed={thread} className="size-3.5" />
              <span className="min-w-0 flex-1 truncate">{thread.title}</span>
              <span
                className={cn(
                  "shrink-0 pl-1 text-xs tabular-nums",
                  thread.mark === "asking"
                    ? "text-attention"
                    : "text-muted-foreground"
                )}
              >
                {wordOf(thread, now)}
              </span>
            </DropdownMenuItem>
          ))}
          {!threads.length && (
            <DropdownMenuItem disabled>No Thread here yet</DropdownMenuItem>
          )}
        </DropdownMenuGroup>
        <p className="mt-1 border-t px-1.5 pt-1.5 pb-1 text-xs leading-snug text-muted-foreground">
          It sees and drives only this tab, until you take it back.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * The chip of a tab lent to the Thread of `agent`: its mark and name in
 * its Agent's state colour, and a card with Take back and Go to Thread.
 */
export function LentChip({
  agent,
  open,
  onOpen,
  onBack,
  onThread,
}: {
  agent: string
  open: boolean
  onOpen: (open: boolean) => void
  onBack: () => void
  onThread: () => void
}) {
  const label = useKeyLabel()
  const thread = useThreadOf(agent)
  const title = useLentTo(agent)
  const mark = thread?.mark ?? "rest"
  return (
    <Popover open={open} onOpenChange={onOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={`Lent to ${title}`}
            title={label(LEND, `Lent to ${title}`)}
            data-lent
            data-state={groupState(mark)}
            className="flex h-5 max-w-38 shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-[color-mix(in_oklab,var(--group-color)_13%,transparent)] pr-2 pl-1.5 text-[11px] text-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--group-color)_28%,transparent)] transition-[background-color,--group-color] duration-500 outline-none hover:bg-[color-mix(in_oklab,var(--group-color)_22%,transparent)] focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-[color-mix(in_oklab,var(--group-color)_22%,transparent)] @max-[200px]:pr-1.5"
          />
        }
      >
        <LentMark agent={agent} />
        <span className="min-w-0 truncate @max-[200px]:hidden">{title}</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-68 gap-0 px-3 py-2.5">
        <div className="mb-1.5 flex items-center gap-2">
          <LentMark agent={agent} className="size-3.5" />
          <b className="min-w-0 flex-1 truncate font-semibold">{title}</b>
          <span
            data-lent
            data-state={groupState(mark)}
            className="shrink-0 text-xs text-(--group-color)"
          >
            {(thread && wordOf(thread)) ?? "Idle"}
          </span>
        </div>
        <p className="mb-2.5 text-xs leading-normal text-muted-foreground">
          This Thread sees and drives this tab. The lend ends when you take it
          back, close the tab, or its session ends.
        </p>
        <div className="flex justify-end gap-1.5">
          <Button variant="outline" size="sm" onClick={onThread}>
            <ArrowRightIcon />
            Go to Thread
          </Button>
          <Button size="sm" onClick={onBack}>
            <Undo2Icon />
            Take back
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
