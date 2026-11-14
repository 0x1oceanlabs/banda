/**
 * The sidebar list's counts in the bar's middle (ADR 0035): who waits for
 * the Person and who works, each by its mark, as `[bar]` in `sidebar.toml`
 * says. A click lists them in the sidebar's order; a row goes to its
 * Thread, as the sidebar's does (`pane.pick`). While the Sidebar is
 * hidden they are the switcher, and name the Thread the Pane in focus
 * shows, an Agent's (ADR 0065, decision 9). What every module lists it
 * reads from the Window's items, and where the Person is from Here.
 *
 *   in    lists      what every App lists, from the Window's items
 *                    (`useLists`), and the Later clock (`useLaterClock`)
 *         Here       whether the Sidebar shows, and the Project and the
 *                    one thing the Pane in focus shows (`useHere`)
 *         settings   `sidebar.toml`'s `[bar]`: what it counts, when it
 *                    shows, colour, words and what shows with nothing
 *                    to count; and `machines`, for the list's cards
 *                    (`useLookSidebar`)
 *         projects   the Projects, for the list's order and its cards
 *         elsewhere  the other machines, where the list places their
 *                    Threads (`useElsewhere`)
 *   draws nothing where `[bar]`'s `show` says not to; with nothing to
 *         count, the calm Mark, or nothing; else each count's Mark, its
 *         number and its words, after the title of the Agent's Thread
 *         the Pane in focus shows while the Sidebar is hidden. A click
 *         opens the list: Wait for you, then Working, a one-line card
 *         each
 *   runs  `pane.pick` on a row of the list
 */
import type { ProjectSummary } from "@banda/contract"
import type { Count, Machines } from "@banda/contract/sidebar"
import {
  BandaMark,
  type MarkState,
  toneOf,
  works,
} from "@banda/ui/components/banda-mark"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@banda/ui/components/dropdown-menu"
import { CutTips } from "@banda/ui/components/fade-text"
import { type Here, useHere } from "@banda/core/react"
import { cn } from "@banda/ui/lib/utils"
import type { Widget, WidgetProps } from "@banda/ui/module"
import type { Lists } from "@banda/ui/pane"
import { useMemo, useState } from "react"
import { useLaterClock, useLists } from "../calls/stores"
import { useLookSidebar } from "../look"
import { order, useElsewhere } from "./order"
import { placedOf, rowKey } from "./rows"
import { type CardRow, type CardView, spokenOf } from "./card"
import { CardLines, useCardClock } from "./CardView"
import { atOf } from "./inbox"
import { EDGE } from "./MachineCard"
import { useOpenRow } from "./open"
import {
  calm,
  type Counted,
  countedKey,
  inOrder,
  type Tally,
  tally,
} from "./tally"
import { useCard } from "./useCard"

/** Each count's words, after its number: the sidebar's own, its Your
 * turn and "7 at work" (ADR 0098), as the bar's count says them. */
const WORDS: Record<Count, string> = {
  asking: "ask you",
  done: "done",
  waiting: "your turn",
  working: "at work",
}

/** A count's colour, by its loudest mark: work is muted; what calls is in
 * its colour, or the text's. */
function colourOf(mark: MarkState, color: boolean): string {
  if (works(mark)) return "text-muted-foreground"
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

/** The counts, as the top of this file says. */
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
            className="flex h-6 items-center gap-2.5 rounded-control px-2 text-meta font-semibold tabular-nums outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 data-popup-open:bg-muted"
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
      {/* The small inbox, where the sidebar's region speaks too. */}
      <DropdownMenuContent align="center" className="w-96" data-small-inbox="">
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
    "Your turn and who is at work, by their marks; click for them in the sidebar's order.",
  Widget: Counts,
  compact: true,
}

/** The counts' list's view: one line, the card of a place it is drawn
 * outside of (ADR 0098, decision 27). */
const ONE_LINE: CardView = { density: 1, group: "none" }

/** What the counts count, drawn only while the list is open, in the
 * sidebar's order, which is worked out only then; one tooltip shows any
 * cut text whole, beside the menu. */
export function List({
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
  // Another machine's Threads stand where the sidebar list places them,
  // and are named as its cards name them.
  const elsewhere = useElsewhere()
  const { machines } = useLookSidebar()
  const { keys, rows } = order(lists, projects, now, { elsewhere })
  const { waiting, working } = inOrder(tallies, keys)
  const rowOf = new Map(rows.map((row) => [rowKey(row), row]))
  // Each that a count counts stands here, as many rows as the bar says:
  // one whose Project the sidebar does not know too, with no Project part.
  const cards = (things: Counted[]) =>
    things.map((thing) => (
      <Item
        key={countedKey(thing)}
        row={rowOf.get(countedKey(thing)) ?? unlistedOf(thing, now)}
        now={now}
        machines={machines}
      />
    ))
  return (
    <CutTips edge={EDGE}>
      {waiting.length > 0 && (
        <DropdownMenuGroup>
          <DropdownMenuLabel>Your turn</DropdownMenuLabel>
          {cards(waiting)}
        </DropdownMenuGroup>
      )}
      {waiting.length > 0 && working.length > 0 && <DropdownMenuSeparator />}
      {working.length > 0 && (
        <DropdownMenuGroup>
          <DropdownMenuLabel>Working</DropdownMenuLabel>
          {cards(working)}
        </DropdownMenuGroup>
      )}
    </CutTips>
  )
}

/** The row of a counted Thread whose Project the sidebar does not know:
 * that Project by its id alone, and where the Thread stands at `now`. */
const unlistedOf = ({ project, listed }: Counted, now: number): CardRow => ({
  project: { id: project },
  ...placedOf(listed, now),
})

/**
 * A Thread in the counts' list, as a one-line card, the sidebar's own (ADR
 * 0098, decision 27; #1067): its mark, its title, its machine's icon as
 * `machines` names it on a card, and its time. A click goes to its
 * Thread, as the card's does; a screen reader hears it by `spokenOf`.
 */
function Item({
  row,
  now,
  machines,
}: {
  row: CardRow
  now: number
  machines: Machines
}) {
  const card = useCard(
    { row, place: row.stand, at: atOf(row), now, view: ONE_LINE },
    { named: false, machines }
  )
  const at = useCardClock(card)
  const spoken = spokenOf(card, at)
  const onOpen = useOpenRow(row)
  return (
    <DropdownMenuItem
      aria-label={spoken.name}
      aria-description={spoken.description || undefined}
      className="flex-col items-stretch gap-0.5 px-2 py-1"
      onClick={onOpen}
    >
      <CardLines card={card} row={row} now={at} />
    </DropdownMenuItem>
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
