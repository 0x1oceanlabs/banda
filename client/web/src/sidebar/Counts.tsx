/**
 * The sidebar list's counts in the bar's middle (ADR 0035): who waits for
 * the Person and who works, each by its mark, as `[bar]` in `sidebar.toml`
 * says. A click opens the small inbox under them (`SmallInbox`, ADR 0098,
 * decision 22, as amended). While the Sidebar is hidden they name the
 * Thread the Pane in focus shows, an Agent's (ADR 0065, decision 9). What
 * every module lists it reads from the Window's items, and where the
 * Person is from Here.
 *
 *   in    lists      what every App lists, from the Window's items
 *                    (`useLists`), and the Later clock (`useLaterClock`)
 *         Here       whether the Sidebar shows, and the Project and the
 *                    one thing the Pane in focus shows (`useHere`)
 *         settings   `sidebar.toml`'s `[bar]`: what it counts, when it
 *                    shows, colour, words and what shows with nothing
 *                    to count (`useLookSidebar`)
 *   draws nothing where `[bar]`'s `show` says not to; with nothing to
 *         count, the calm Mark, or nothing; else each count's Mark, its
 *         number and its words, after the title of the Agent's Thread
 *         the Pane in focus shows while the Sidebar is hidden. A click
 *         opens the small inbox, Your turn in the sidebar's cards; while
 *         the Sidebar shows, its list takes the focus
 *   runs  what the small inbox's cards and its "7 at work ›" run
 */
import type { Count } from "@banda/contract/sidebar"
import {
  BandaMark,
  type MarkState,
  toneOf,
  works,
} from "@banda/ui/components/banda-mark"
import { type Here, useHere } from "@banda/core/react"
import { cn } from "@banda/ui/lib/utils"
import type { Widget, WidgetProps } from "@banda/ui/module"
import { useMemo, useState } from "react"
import { useLaterClock, useLists } from "../calls/stores"
import { useLookSidebar } from "../look"
import { SmallInbox } from "./SmallInbox"
import { calm, tally } from "./tally"

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
function Counts({ engine }: WidgetProps) {
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
  // How many work, for the small inbox's way to Working, whatever the
  // bar counts.
  const working = useMemo(
    () =>
      tally(lists, ["working"], now).find((t) => t.count === "working")?.things
        .length ?? 0,
    [lists, now]
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
    <SmallInbox engine={engine} working={working} label={words}>
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
    </SmallInbox>
  )
}

/** The counts' widget, the sidebar list's, which the window's own module
 * lists. */
export const countsWidget: Widget = {
  id: "sidebar.counts",
  about:
    "Your turn and who is at work, by their marks; click for the small inbox, Your turn in the sidebar's cards.",
  Widget: Counts,
  compact: true,
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
