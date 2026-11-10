import type { ProjectSummary } from "@banda/contract"
import type { Count } from "@banda/contract/sidebar"
import { BandaMark, type MarkState } from "@banda/ui/components/banda-mark"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@banda/ui/components/dropdown-menu"
import { ProjectSign } from "@banda/ui/components/project-sign"
import { type Here, useHere, useRun } from "@banda/core/react"
import { cn } from "@banda/ui/lib/utils"
import type { Widget, WidgetProps } from "@banda/ui/module"
import type { Lists } from "@banda/ui/pane"
import { useMemo, useState } from "react"
import { useLaterClock, useLists } from "../calls/stores"
import { useLookSidebar } from "../look"
import { ThreadMark, toneOf } from "@banda/ui/components/banda-mark"
import { keysOf, order, useElsewhere } from "./order"
import { markSaid } from "./card"
import { Status } from "./CardStatus"
import { calm, type Counted, inOrder, type Tally, tally } from "./tally"

/** Each count's words, after its number. */
const WORDS: Record<Count, string> = {
  asking: "ask you",
  done: "done",
  waiting: "wait for you",
  working: "working",
}

/** A count's colour, by its loudest mark: work is muted; what calls is in
 * its colour, or the text's. */
function colourOf(mark: MarkState, color: boolean): string {
  if (mark === "running" || mark === "thinking") return "text-muted-foreground"
  return (color && toneOf(mark)) || "text-foreground"
}

/** Whether the Sidebar shows: with it, the counts say the same. */
const sidebarOf = (here: Here) => here.sidebar
/** The one thing the Pane in focus shows, and its Project, each a word:
 * a move of the focus that keeps them, or between Panes that show none,
 * draws the counts not. */
const aheadThingOf = (here: Here) => here.pane?.subject
const aheadProjectOf = (here: Here) =>
  here.pane?.subject ? here.pane.project : undefined

/**
 * The sidebar list's counts in the bar's middle (ADR 0035): who waits for
 * the Person and who works, each by its mark, as `[bar]` in `sidebar.toml`
 * says. A click lists them in the sidebar's order; a row goes to its
 * Thread, as the sidebar's does (`pane.pick`). While the Sidebar is
 * hidden they are the switcher, and name the Thread the Pane in focus
 * shows, an Agent's (ADR 0065, decision 9). What every module lists it
 * reads from the Window's items, and where the Person is from Here.
 */
function Counts({ projects }: WidgetProps) {
  const sidebarShown = useHere(sidebarOf)
  const aheadProject = useHere(aheadProjectOf)
  const aheadThing = useHere(aheadThingOf)
  const lists = useLists()
  const aheadRow = aheadProject
    ? lists[aheadProject]?.find((listed) => listed.id === aheadThing)
    : undefined
  const current = aheadRow?.agent !== undefined ? aheadRow : undefined
  const settings = useLookSidebar().bar
  const now = useLaterClock()
  const tallies = useMemo(
    () => tally(lists, settings.counts, now),
    [lists, settings.counts, now]
  )
  const shows =
    settings.show === "always" || (settings.show === "closed" && !sidebarShown)
  if (!shows) return null
  if (tallies.length === 0) {
    if (settings.empty === "hide" || !calm(lists, now)) return null
    // The calm square, where the counts come.
    return (
      <span className="flex h-6 items-center px-2">
        <BandaMark
          variant="agent"
          state="rest"
          playful={0}
          label="Nothing waits for you, nothing works"
          className="size-4 text-muted-foreground"
        />
      </span>
    )
  }
  const words = tallies
    .map((t) => `${t.things.length} ${WORDS[t.count]}`)
    .join(" · ")
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={words}
            title={words}
            className="flex h-6 items-center gap-2.5 rounded-control px-2 text-xs font-semibold tabular-nums outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 data-popup-open:bg-muted"
          />
        }
      >
        {current && !sidebarShown && (
          <span className="max-w-40 truncate border-r border-border pr-2.5 font-medium text-foreground">
            {current.title}
          </span>
        )}
        {tallies.map((t) => (
          <span
            key={t.count}
            className={cn(
              "flex items-center gap-1",
              colourOf(t.mark, settings.color)
            )}
          >
            <BandaMark
              variant="agent"
              state={t.mark}
              playful={0}
              tone={settings.color}
              className="size-4"
            />
            <Number value={t.things.length} />
            {settings.words && (
              <span className="font-normal text-muted-foreground">
                {WORDS[t.count]}
              </span>
            )}
          </span>
        ))}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="w-96">
        <List tallies={tallies} lists={lists} now={now} projects={projects} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The counts' widget, the sidebar list's, which the window's own module
 * lists. */
export const countsWidget: Widget = {
  id: "sidebar.counts",
  about:
    "Who waits for you and who works, by their marks; click for them in the sidebar's order.",
  Widget: Counts,
  compact: true,
}

/** What the counts count, drawn only while the list is open, in the
 * sidebar's order, which is worked out only then. */
function List({
  tallies,
  lists,
  now,
  projects,
}: {
  tallies: readonly Tally[]
  lists: Lists
  now: number
  projects: readonly ProjectSummary[]
}) {
  const run = useRun()
  // Another machine's Threads stand where the sidebar list places them.
  const elsewhere = useElsewhere()
  const keys = keysOf(order(lists, projects, now, { elsewhere }))
  const { waiting, working } = inOrder(tallies, keys)
  const named = new Map(projects.map((project) => [project.id, project]))
  const rows = (things: Counted[]) =>
    things.map(({ project, listed }) => {
      const where = named.get(project)
      return (
        <DropdownMenuItem
          key={listed.id}
          className="gap-2 py-1.5"
          onClick={() => run("pane.pick", { project, pane: listed.pane })}
        >
          <ThreadMark listed={listed} news={false} />
          <span className="min-w-0 flex-1 truncate">{listed.title}</span>
          {where && <ProjectSign project={where} />}
          <Status said={markSaid(listed)} />
        </DropdownMenuItem>
      )
    })
  return (
    <>
      {waiting.length > 0 && (
        <DropdownMenuGroup>
          <DropdownMenuLabel>Wait for you</DropdownMenuLabel>
          {rows(waiting)}
        </DropdownMenuGroup>
      )}
      {waiting.length > 0 && working.length > 0 && <DropdownMenuSeparator />}
      {working.length > 0 && (
        <DropdownMenuGroup>
          <DropdownMenuLabel>Working</DropdownMenuLabel>
          {rows(working)}
        </DropdownMenuGroup>
      )}
    </>
  )
}

/** A number that rolls in from below as it grows, from above as it falls. */
function Number({ value }: { value: number }) {
  const [last, setLast] = useState({ value, from: "" })
  if (last.value !== value)
    setLast({ value, from: value > last.value ? "below" : "above" })
  const { from } = last
  return (
    <span className="inline-flex h-4 overflow-hidden">
      <span
        key={value}
        className={cn(
          "leading-4 motion-safe:duration-300",
          from && "motion-safe:animate-in motion-safe:fade-in-0",
          from === "below" && "motion-safe:slide-in-from-bottom-3",
          from === "above" && "motion-safe:slide-in-from-top-3"
        )}
      >
        {value}
      </span>
    </span>
  )
}
