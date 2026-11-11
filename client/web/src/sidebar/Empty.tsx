import { type ReactNode, useContext, useEffect, useState } from "react"
import type { ProjectId, ProjectSummary } from "@banda/contract"
import { BandaMark } from "@banda/ui/components/banda-mark"
import { Button } from "@banda/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@banda/ui/components/empty"
import { useKeyLabel } from "@banda/ui/hooks/use-key-of"
import type { MarkState } from "@banda/ui/lib/mark-state"
import { cn } from "@banda/ui/lib/utils"
import { wakes } from "@banda/ui/lib/words"
import { SquarePenIcon } from "lucide-react"
import type { Tab, Zero } from "./inbox"
import { actionDoing, archiving } from "./items"
import { useNewThread } from "./open"
import { ShowTab } from "./Tabs"
import { ToldSomeday } from "./useSidebarView"

/** Someday's head in Later, by the key `inbox.ts` gives it: where inbox
 * zero's Someday line shows Later. */
export const SOMEDAY_HEAD = "later:someday:head"

/** What inbox zero says under its first line (ADR 0098, decision 4): how
 * many work and when the next wakes by its time, what does not apply
 * left out; with neither, that no Agent works. */
export function zeroSays({ working, next }: Zero, now = Date.now()): string {
  const said = [
    ...(working > 0 ? [`${working} at work`] : []),
    ...(next === undefined ? [] : [`next wakes at ${wakes(next, now)}`]),
  ]
  return said.length > 0 ? said.join(" · ") : "No Agent works now"
}

/** What a tab with nothing in it says (decision 25): what goes there,
 * and the key that puts it there, as the keys in force name it. */
export function emptySays(
  tab: Exclude<Tab, "inbox">,
  key?: string
): { big: string; small?: string } {
  switch (tab) {
    case "working":
      return { big: "No Agent works now" }
    case "later":
      return {
        big: "Nothing for later",
        ...(key ? { small: `${key} on a Thread puts it here.` } : {}),
      }
    case "archive":
      return {
        big: "Nothing archived yet",
        ...(key ? { small: `${key} on a Thread closes it here.` } : {}),
      }
  }
}

/** The look each empty place's mark stands in, still. */
const MARKS: Readonly<Record<Exclude<Tab, "inbox">, MarkState>> = {
  working: "later",
  later: "later",
  archive: "done",
}

/**
 * Inbox zero (ADR 0098, decision 4): that nothing waits, and what comes
 * next. On the week's first, from Monday, it also says how many sleep
 * until Someday, which opens Later at Someday; this device keeps that it
 * told.
 */
export function InboxZero({ zero }: { zero: Zero }) {
  const show = useContext(ShowTab)
  const told = useContext(ToldSomeday)
  // How many sleep until Someday, as this inbox zero said it: its line
  // stays while it shows, though the view hears at once that it told, so
  // the next inbox zero this week says no more.
  const [someday, setSomeday] = useState(zero.someday)
  if (zero.someday !== undefined && zero.someday !== someday)
    setSomeday(zero.someday)
  useEffect(() => {
    if (someday !== undefined) told?.(Date.now())
  }, [someday, told])
  return (
    <Place
      mark={
        <BandaMark
          variant="logo"
          state="rest"
          playful={0}
          className="size-10 text-muted-foreground opacity-60"
        />
      }
      big="Nothing waits for you"
      small={zeroSays(zero)}
    >
      {someday !== undefined && (
        <button
          type="button"
          className="rounded-control px-1 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
          onClick={() => show?.("later", SOMEDAY_HEAD)}
        >
          {someday} someday ›
        </button>
      )}
    </Place>
  )
}

/**
 * A tab with nothing in it (ADR 0098, decision 25): what goes there, and
 * one way to fill it; Working's starts a Thread as the header's New Thread
 * does.
 */
export function EmptyTab({
  tab,
  only,
  projects,
}: {
  tab: Exclude<Tab, "inbox">
  /** The Project whose rows alone the list shows, if one. */
  only: ProjectId | undefined
  projects: readonly ProjectSummary[]
}) {
  const keyFor = useKeyLabel()
  const startThread = useNewThread(only, projects)
  // The key of whatever App puts a Thread off, and the list's Archive's.
  const action =
    tab === "later"
      ? actionDoing("later")
      : tab === "archive"
        ? archiving
        : undefined
  const key = action ? keyFor(action.id) : undefined
  const { big, small } = emptySays(tab, key)
  return (
    <Place
      mark={
        <BandaMark
          variant="agent"
          state={MARKS[tab]}
          playful={0}
          className={cn(
            "size-10 text-muted-foreground opacity-55",
            // Done leans, on a pivot left of its middle: back under the
            // words.
            MARKS[tab] === "done" && "translate-x-0.5"
          )}
        />
      }
      big={big}
      small={small}
    >
      {tab === "working" && (
        <Button
          variant="outline"
          size="sm"
          className="mt-1.5"
          onClick={startThread}
        >
          <SquarePenIcon />
          New Thread
        </Button>
      )}
    </Place>
  )
}

/** An empty place's layout, the empty state's own at the sidebar's sizes:
 * its still mark, its line, a quieter one, and at most one way to fill
 * it. */
function Place({
  mark,
  big,
  small,
  children,
}: {
  mark: ReactNode
  big: string
  small?: string
  children?: ReactNode
}) {
  return (
    <Empty className="gap-1 px-4 pt-9 pb-7">
      <EmptyHeader className="gap-1">
        <EmptyMedia>{mark}</EmptyMedia>
        <EmptyTitle>{big}</EmptyTitle>
        {small && (
          <EmptyDescription className="text-xs tabular-nums">
            {small}
          </EmptyDescription>
        )}
      </EmptyHeader>
      {children && <EmptyContent>{children}</EmptyContent>}
    </Empty>
  )
}
