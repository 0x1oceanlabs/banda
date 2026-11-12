import { type ReactNode, useContext, useEffect, useState } from "react"
import type { ProjectId, ProjectSummary } from "@banda/contract"
import {
  holds,
  sameData,
  sameEach,
  type Shown,
  useHereNamed,
  useHostsBy,
} from "@banda/core/react"
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
import type { Block, EmptyAt, Zero } from "./inbox"
import { actionDoing, archiving } from "./items"
import { useNewThread } from "./open"
import { HERE, hostNames, type Searched } from "./search"
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

/** `names` in words: "arc", "arc and mac", "arc, mac and pi". */
const listed = (names: readonly string[]) =>
  names.length < 2
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`

/** Where a search looked, by the machines' names: those whose titles,
 * and messages where it read them (`messages`), it searched (`on`), none
 * named where this one is the only one; those away, and those whose
 * engine failed it, whose titles alone it read; and whether a machine
 * has yet to answer. */
export type Looked = {
  on: readonly string[]
  away: readonly string[]
  failed: readonly string[]
  messages: boolean
  pending: boolean
}

/** What a search that found nothing says (decision 25, spec §2.6): the
 * words it ran with, and where it looked (`Looked`); with no word typed,
 * filters alone, it read the titles alone. */
export function noneSays(
  words: string,
  { on, away, failed, messages, pending }: Looked
): { big: string; small: string } {
  const big = `No Thread matches “${words}”`
  const where = on.length > 0 ? ` on ${listed(on)}` : ""
  if (!messages) return { big, small: `Searched titles${where}.` }
  if (pending) return { big, small: "Searching messages…" }
  const said = [
    `Searched titles and messages${where}`,
    ...(away.length > 0
      ? [`${listed(away)} ${away.length > 1 ? "are" : "is"} away, titles only`]
      : []),
    ...(failed.length > 0 ? [`titles only on ${listed(failed)}`] : []),
  ]
  return { big, small: `${said.join("; ")}.` }
}

/** Under what a search found, the machines whose titles alone it read,
 * by their names (S12c). */
export const titlesOnlySays = (names: readonly string[]) =>
  `Titles only on ${listed(names)}`

/** What a tab with nothing in it says (decision 25): what goes there,
 * and the key that puts it there, as the keys in force name it. */
export function emptySays(
  tab: Exclude<EmptyAt, "search">,
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

/** A place the list shows with no card in it: inbox zero, or a tab with
 * nothing in it. */
export type EmptyBlock = Extract<Block, { kind: "zero" | "empty" }>

/**
 * An empty place as the list draws it (ADR 0098, decision 25): every one
 * says what goes there, and `Empty.test.tsx` walks each tab and each part
 * of the Inbox, grouped or not, for one that does not.
 */
export function EmptyPlace({
  place,
  only,
  projects,
  searched,
}: {
  place: EmptyBlock
  /** The Project whose rows alone the list shows, if one. */
  only: ProjectId | undefined
  projects: readonly ProjectSummary[]
  /** What a search found in the messages, while it reads them. */
  searched?: Searched | undefined
}) {
  return place.kind === "zero" ? (
    <InboxZero zero={place} />
  ) : (
    <EmptyTab
      tab={place.tab}
      words={place.words}
      only={only}
      projects={projects}
      searched={searched}
    />
  )
}

/** The look each empty place's mark stands in, still; a search's stands
 * idle, until the Mark has a lens to look with. */
const MARKS: Readonly<Record<EmptyAt, MarkState>> = {
  working: "later",
  later: "later",
  archive: "done",
  search: "idle",
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
          className="rounded-control px-1 text-meta text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
          onClick={() => show?.("later", SOMEDAY_HEAD)}
        >
          {someday} someday ›
        </button>
      )}
    </Place>
  )
}

/** The other machines whose rows the Window shows, by their keys. */
const holding = (hosts: readonly Shown[]) =>
  hosts.filter(holds).map((host) => host.name)

/** The name a machine says it has, by its key in a search (`HERE` for
 * this one). */
function useNameOf(): (key: string) => string {
  const here = useHereNamed()?.name ?? "this machine"
  const named = useHostsBy(hostNames, sameData)
  return (key) => (key === HERE ? here : (named[key] ?? key))
}

/** Where a search looked (`Looked`), by the machines' names: this one,
 * then each other whose rows the Window shows; or, as it read the
 * messages, those `searched` says; none named where this one is the
 * only one. */
function useLooked(searched: Searched | undefined): Looked {
  const name = useNameOf()
  const there = useHostsBy(holding, sameEach)
  const named = (keys: readonly string[]) =>
    there.length === 0 ? [] : keys.map(name)
  if (!searched)
    return {
      on: named([HERE, ...there]),
      away: [],
      failed: [],
      messages: false,
      pending: false,
    }
  return {
    on: named(searched.on),
    away: searched.away.map(name),
    failed: searched.failed.map(name),
    messages: true,
    pending: searched.pending,
  }
}

/** Under what a search found, the machines whose titles alone it read,
 * as they are away or their engine failed it (S12c). */
export function TitlesOnly({ machines }: { machines: readonly string[] }) {
  const name = useNameOf()
  return (
    <p className="px-2 pt-2 pb-1 text-meta text-muted-foreground/70">
      {titlesOnlySays(machines.map(name))}
    </p>
  )
}

/**
 * A place with nothing in it (ADR 0098, decision 25): what goes there, and
 * one way to fill it; Working's starts a Thread as the header's New Thread
 * does. A search that found nothing names its `words`.
 */
export function EmptyTab({
  tab,
  words = "",
  only,
  projects,
  searched,
}: {
  tab: EmptyAt
  words?: string | undefined
  /** The Project whose rows alone the list shows, if one. */
  only: ProjectId | undefined
  projects: readonly ProjectSummary[]
  /** What a search found in the messages, while it reads them. */
  searched?: Searched | undefined
}) {
  const keyFor = useKeyLabel()
  const startThread = useNewThread(only, projects)
  const looked = useLooked(searched)
  // The key of whatever App puts a Thread off, and the list's Archive's.
  const action =
    tab === "later"
      ? actionDoing("later")
      : tab === "archive"
        ? archiving
        : undefined
  const key = action ? keyFor(action.id) : undefined
  const { big, small } =
    tab === "search" ? noneSays(words, looked) : emptySays(tab, key)
  return (
    <Place
      mark={
        <BandaMark
          variant="agent"
          state={MARKS[tab]}
          playful={0}
          className={cn(
            "size-10 text-muted-foreground",
            tab === "search" ? "opacity-60" : "opacity-55",
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
          <EmptyDescription className="text-meta tabular-nums">
            {small}
          </EmptyDescription>
        )}
      </EmptyHeader>
      {children && <EmptyContent>{children}</EmptyContent>}
    </Empty>
  )
}
