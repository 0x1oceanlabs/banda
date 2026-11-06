import type { ProjectId, ProjectSummary } from "@banda/contract"
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
import { ProjectBadge } from "@banda/ui/components/project-badge"
import { cn } from "@banda/ui/lib/utils"
import type { Listed, Lists, PaneState } from "@banda/ui/pane"
import { useMemo, useState } from "react"
import { useLookSidebar } from "../look"
import { Status, ThreadMark, toneOf } from "../sidebar/Row"
import { useSnoozes } from "../sidebar/snoozed"
import { type Counted, inOrder, type Tally, tally } from "./tally"

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

type Open = (project: ProjectId, pane: PaneState) => void

/**
 * The sidebar's counts in the bar's middle (ADR 0035): who waits for the
 * Person and who works, each by its mark, as `[bar]` in `sidebar.toml`
 * says. A click lists them; a row opens its Thread, as the sidebar's does.
 */
export function Counts({
  lists,
  projects,
  sidebarShown,
  current,
  onOpen,
}: {
  lists: Lists
  projects: readonly ProjectSummary[]
  /** Whether the sidebar shows, and with it the same. */
  sidebarShown: boolean
  /** The Agent's Thread in front, named while the sidebar is hidden: the
   * counts are then the switcher (ADR 0065, decision 9). */
  current?: Listed
  onOpen: Open
}) {
  const settings = useLookSidebar().bar
  const { away } = useSnoozes(lists)
  const tallies = useMemo(
    () => tally(lists, settings.counts, away),
    [lists, settings.counts, away]
  )
  const shows =
    settings.show === "always" || (settings.show === "closed" && !sidebarShown)
  if (!shows) return null
  if (tallies.length === 0) {
    if (settings.empty === "hide") return null
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
            className="flex h-6 items-center gap-2.5 rounded-md px-2 text-xs font-semibold tabular-nums outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 data-popup-open:bg-muted"
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
        <List tallies={tallies} projects={projects} onOpen={onOpen} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** What the counts count, drawn only while the list is open. */
function List({
  tallies,
  projects,
  onOpen,
}: {
  tallies: readonly Tally[]
  projects: readonly ProjectSummary[]
  onOpen: Open
}) {
  const { waiting, working } = inOrder(tallies)
  const named = new Map(projects.map((project) => [project.id, project]))
  const rows = (things: Counted[]) =>
    things.map(({ project, listed }) => {
      const where = named.get(project)
      return (
        <DropdownMenuItem
          key={listed.id}
          className="gap-2 py-1.5"
          onClick={() => onOpen(project, listed.pane)}
        >
          <ThreadMark listed={listed} news={false} />
          <span className="min-w-0 flex-1 truncate">{listed.title}</span>
          {where && <ProjectBadge project={where} />}
          <Status listed={listed} />
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
