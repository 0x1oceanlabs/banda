/**
 * The Crew Pane, `agents.crew` (ADR 0103, decision 22; mock 03): a Crew
 * beside its Thread, last in the Deck right of it, in the Thread's Group.
 * Its header names it, "from ‹Thread›", with one ticking clock below,
 * the Phases and Timeline tabs, and a menu with View script and Copy
 * result. Its body: the Result once it ended, or why it failed or
 * stopped; the counts and tokens; the filter; the strip; then the phases
 * as columns when the Pane is 760 px wide or more, as bands when narrower,
 * or the Timeline. A click on an agent shows its detail, beside the
 * columns or in place of the bands, with a breadcrumb; Esc closes it.
 * It opens by itself once a Crew, and stays closed for that Crew once
 * closed (`crew-pane.ts`, `toOpen`). Where its Thread's Pane is alone, the
 * same view shows over the Thread, as a screen on top, as a sub-agent's
 * does (`CrewScreen`). Banda shows a Crew and stops none of it (call 11):
 * no Stop, no restart, no skip.
 */
import { useEffect, useRef, useState } from "react"
import {
  ArrowLeftIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CheckIcon,
  CopyIcon,
  EllipsisIcon,
  FileCodeIcon,
  UsersIcon,
  XIcon,
} from "lucide-react"
import type { Engine, ProjectId } from "@banda/contract"
import type { Crew, CrewId, ThreadId } from "@banda/contract/agents"
import { Button } from "@banda/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@banda/ui/components/dropdown-menu"
import {
  HeaderSlot,
  InHeader,
  PaneHeader,
} from "@banda/ui/components/pane-header"
import { Satellite } from "@banda/ui/components/satellite"
import { Spinner } from "@banda/ui/components/spinner"
import { useKeyLabel } from "@banda/ui/hooks/use-key-of"
import { useNow } from "@banda/ui/hooks/use-now"
import { useScope } from "@banda/ui/hooks/use-scope"
import { useWiderThan } from "@banda/ui/hooks/use-wider-than"
import { copyText } from "@banda/ui/lib/clipboard"
import { SATELLITE_COLOURS } from "@banda/ui/lib/satellite"
import { cn } from "@banda/ui/lib/utils"
import type { Action } from "@banda/ui/module"
import { definePane, paneOf, type PaneProps } from "@banda/ui/pane"
import { CrewGlyph, Strip } from "../entries/crew"
import { FADES } from "../entries/parts/RowTrigger"
import { harnessName, harnessShort, useHarnesses } from "../harnesses"
import { textOf } from "../list/answering"
import { TONES } from "../lines/subagents"
import { CREW } from "../scopes"
import { threadPane } from "../ThreadPane"
import { draftIn } from "./ask-about"
import { goOnMessage, stripOf } from "./crew"
import {
  agentOf,
  type Band,
  bandsOf,
  clockOf,
  type Column,
  columnsOf,
  type Detail,
  detailOf,
  doneWords,
  type Ending,
  endingOf,
  type Filter,
  FILTERS,
  keyOf,
  type Row,
  type Result,
  summaryOf,
  timelineOf,
  waitingWords,
  WIDE,
} from "./crew-pane"
import { useThread } from "./live-thread"
import { Centered } from "./Thread"
import type { Count } from "./subagents"

/** What a Crew Pane shows: Crew `crew` of Thread `thread`, and the agent
 * `pick` names by its phase and index, "2.4", when one is picked. */
export type CrewArgs = {
  thread: ThreadId
  crew: CrewId
  pick?: string
}

/** The action that opens a Crew beside its Thread. */
export const OPEN_CREW = "agents.crew.open"

export const crewPane = definePane<CrewArgs>({
  // A literal, which the window's kind checker reads.
  kind: "agents.crew",
  name: "Crew",
  title: () => "Crew",
  icon: UsersIcon,
  // Its header is its own: the tabs, the menu and no Stop.
  header: false,
  // One per Thread, so one in its Group: another of its Crews shows in it.
  identity: (args) => args.thread,
  Pane: CrewPane,
})

/** Whether Thread `thread` opens its Crews beside it, as the router
 * answers, as `opensBeside` does for its sub-agents. */
export function opensCrew(
  runs: PaneProps<unknown>["runs"],
  thread: ThreadId
): boolean {
  return runs?.(paneOf(crewPane, { thread, crew: "" })).runs ?? true
}

/**
 * Opens a Crew beside its Thread (decision 22): its Pane in the Group of
 * the Thread whose Agent is `agent`, or the one that Thread has, which
 * then shows it, with the agent `pick` names picked. `quiet`, as it opens
 * by itself, leaves the focus where it is. Unlisted: a Crew's card runs it.
 */
export const openCrew: Action = {
  id: OPEN_CREW,
  title: "Open a Crew beside its Thread",
  section: "Threads",
  unlisted: true,
  run: (window, args) => {
    const [project, thread, crew, agent, pick, quiet] = [
      "project",
      "thread",
      "crew",
      "agent",
      "pick",
      "quiet",
    ].map((key) => textOf(args, key))
    if (!project || !thread || !crew) return
    window.open(
      paneOf(crewPane, { thread, crew, ...(pick && { pick }) }),
      project as ProjectId,
      {
        again: false,
        update: true,
        ...(agent && { beside: agent }),
        ...(quiet && { focus: false }),
      }
    )
  },
}

/** The args that open Crew `crew` of Thread `thread` of `project` beside
 * it ({@link openCrew}): on the agent `pick` names, in the Group of the
 * Thread whose Agent is `agent`, and `quiet`, leaving the focus be. */
export function crewOpening(
  project: string,
  thread: string,
  crew: string,
  { pick, agent, quiet }: { pick?: string; agent?: string; quiet?: boolean }
): { [key: string]: string } {
  return {
    project,
    thread,
    crew,
    ...(pick && { pick }),
    ...(agent && { agent }),
    ...(quiet && { quiet: "1" }),
  }
}

/** Where the Crews a Pane opened by itself are remembered, so that each
 * opens by itself once (decision 22). A convenience of this window: lost
 * with its storage, it opens once more at most. */
const OPENED = "banda.agents.crews-opened"
const MOST_REMEMBERED = 200

/** The Crews opened by themselves so far. */
export function openedCrews(): Set<string> {
  try {
    const kept = JSON.parse(localStorage.getItem(OPENED) ?? "[]")
    return new Set(Array.isArray(kept) ? kept.map(String) : [])
  } catch {
    return new Set()
  }
}

/** Remembers that `crews` opened by themselves. */
export function rememberOpened(crews: readonly string[]) {
  try {
    const kept = [...openedCrews(), ...crews].slice(-MOST_REMEMBERED)
    localStorage.setItem(OPENED, JSON.stringify(kept))
  } catch {
    // No storage: they may open once more.
  }
}

/** Crew `crew` of Thread `thread`, read and followed with its Thread, and
 * what names it: the Thread's title, and its Harness's short name. */
function useCrew(
  engine: Engine,
  project: ProjectId,
  thread: ThreadId,
  crew: CrewId
) {
  const read = useThread(engine, project, thread)
  const harnesses = useHarnesses(engine)
  const view = read.state === "ready" ? read.view : undefined
  const harness = view?.harness ?? ""
  return {
    crew: view?.crews.find((one) => one.id === crew),
    title: view?.title,
    harness,
    short:
      harnessShort(harnesses, harness) ||
      harnessName(harnesses, harness) ||
      "Claude",
    refusal: read.state === "refused" ? read.refusal.message : undefined,
    ready: view !== undefined,
  }
}

/** The view a tab shows. */
type Tab = "phases" | "timeline"

function CrewPane(props: PaneProps<CrewArgs>) {
  const { engine, project, args, update, close, label, run, focused } = props
  const { thread, crew: id, pick } = args
  const read = useCrew(engine, project, thread, id)
  const { crew } = read
  const [tab, setTab] = useState<Tab>("phases")
  const [script, setScript] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  // Its tab and the overview name it as its header does.
  const title = crew && `Crew · ${crew.title}`
  const detail = read.title ? `from ${read.title}` : null
  useEffect(() => {
    if (title !== undefined) label?.({ title, detail })
  }, [title, detail, label])
  useEffect(() => () => label?.(null), [label])

  const onPick = (key: string | undefined) =>
    update({ thread, crew: id, ...(key && { pick: key }) })
  // Its Thread's own Pane, as its header's "from" goes to it.
  const toThread = () =>
    run?.("pane.pick", {
      project,
      pane: paneOf(threadPane, {
        thread,
        harness: read.harness,
        title: read.title ?? "",
      }),
    })

  // Esc closes the agent's detail; with none, it does nothing new. It
  // keeps the Esc it takes.
  const scope = useScope(
    CREW,
    {
      "agents.crew.back": (_, pressed) => {
        if (pick === undefined) return false
        pressed?.stopPropagation()
        onPick(undefined)
        return true
      },
    },
    { tile: true }
  )
  useEffect(() => scope(root.current), [scope])
  // A dot clicked in the Thread picks its agent here: its tile takes the
  // focus, for Esc.
  useEffect(() => {
    const tile = root.current?.closest<HTMLElement>("[data-tile]")
    if (focused && tile && !tile.contains(document.activeElement))
      tile.focus({ preventScroll: true })
  }, [pick, focused])

  return (
    <HeaderSlot>
      <div
        ref={root}
        data-slot="crew-pane"
        className="@container/crew flex h-full min-h-0 flex-col"
      >
        <PaneHeader title={title ?? "Crew"} onClose={close}>
          <CrewHead crew={crew} from={read.title} onFrom={toThread} />
          <InHeader>
            {crew && (
              <>
                <Tabs tab={tab} onTab={setTab} />
                <CrewMenu
                  crew={crew}
                  script={script}
                  onScript={() => setScript(!script)}
                />
              </>
            )}
          </InHeader>
        </PaneHeader>
        <Read read={read}>
          {(crew) => (
            <CrewBody
              crew={crew}
              short={read.short}
              tab={tab}
              script={script}
              pick={pick}
              onPick={onPick}
              onGoOn={() => draftIn(project, thread, goOnMessage(crew))}
            />
          )}
        </Read>
      </div>
    </HeaderSlot>
  )
}

/** What the Pane draws while its Crew is read, refused, or gone. */
function Read({
  read,
  children,
}: {
  read: ReturnType<typeof useCrew>
  children: (crew: Crew) => React.ReactNode
}) {
  if (read.refusal !== undefined)
    return (
      <Centered>
        <p className="text-ui text-muted-foreground">{read.refusal}</p>
      </Centered>
    )
  if (!read.ready)
    return (
      <Centered>
        <Spinner />
      </Centered>
    )
  if (!read.crew)
    return (
      <Centered>
        <p className="text-ui text-muted-foreground">
          This Crew is no longer in its Thread.
        </p>
      </Centered>
    )
  return children(read.crew)
}

/** Its header's words: the glyph, "Crew · audit-routes", and, muted, "from
 * ‹Thread›", which goes to the Thread. Long words fade, with no "…". */
function CrewHead({
  crew,
  from,
  onFrom,
}: {
  crew: Crew | undefined
  from: string | undefined
  onFrom?: () => void
}) {
  return (
    <>
      {crew && <CrewGlyph state={crew.state} />}
      <h2
        className={cn(
          "max-w-[60%] min-w-0 shrink-0 text-muted-foreground",
          FADES
        )}
      >
        Crew ·{" "}
        <span className="font-medium text-foreground">{crew?.title}</span>
      </h2>
      {from && (
        <button
          type="button"
          title="Go to its Thread"
          onClick={onFrom}
          disabled={!onFrom}
          className={cn(
            "min-w-0 flex-1 basis-0 cursor-pointer rounded-small text-left text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default @max-[34rem]/crew:hidden",
            FADES
          )}
        >
          from {from}
        </button>
      )}
    </>
  )
}

/** Phases or the Timeline. */
function Tabs({ tab, onTab }: { tab: Tab; onTab: (tab: Tab) => void }) {
  return (
    <Choices
      kind="tab"
      label="View"
      className="mr-1"
      choices={TABS}
      chosen={tab}
      onChoose={onTab}
    />
  )
}

const TABS: readonly { id: Tab; words: string }[] = [
  { id: "phases", words: "Phases" },
  { id: "timeline", words: "Timeline" },
]

/** A row of quiet buttons of which one is chosen: tabs, or a filter's
 * radios. */
function Choices<Id extends string>({
  kind,
  label,
  className,
  choices,
  chosen,
  onChoose,
}: {
  kind: "tab" | "radio"
  label: string
  className?: string
  choices: readonly { id: Id; words: string }[]
  chosen: Id
  onChoose: (id: Id) => void
}) {
  return (
    <div
      role={kind === "tab" ? "tablist" : "radiogroup"}
      aria-label={label}
      className={cn("flex gap-px", className)}
    >
      {choices.map(({ id, words }) => (
        <Button
          key={id}
          role={kind}
          {...(kind === "tab"
            ? { "aria-selected": chosen === id }
            : { "aria-checked": chosen === id })}
          variant="ghost"
          size="xs"
          className={cn(
            "text-muted-foreground",
            chosen === id && "bg-foreground/8 text-foreground"
          )}
          onClick={() => onChoose(id)}
        >
          {words}
        </Button>
      ))}
    </div>
  )
}

/** The ⋯ menu: View script, and Copy result once it has one. No Stop. */
function CrewMenu({
  crew,
  script,
  onScript,
}: {
  crew: Crew
  script: boolean
  onScript: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon-xs" aria-label="Crew menu">
            <EllipsisIcon />
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled={!crew.script} onClick={onScript}>
          <FileCodeIcon />
          {script ? "Hide script" : "View script"}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={crew.result === undefined}
          onClick={() => void copyText(crew.result ?? "")}
        >
          <CopyIcon />
          Copy result
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * A Crew's view under its header, beside its Thread or over it: what
 * ended it, its summary and filter, the strip, then its phases or the
 * Timeline, and an agent's detail where one is picked.
 */
export function CrewBody({
  crew,
  short,
  tab,
  script,
  pick,
  onPick,
  onGoOn,
}: {
  crew: Crew
  short: string
  tab: Tab
  script: boolean
  pick: string | undefined
  onPick: (key: string | undefined) => void
  onGoOn: () => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const wide = useWiderThan(root, WIDE)
  const [filter, setFilter] = useState<Filter>("all")
  // Rows' times move by the minute while it works: only the clock counts
  // the seconds (decision 20).
  const now = useNow(60_000, crew.state === "working")
  const picked = pick === undefined ? undefined : agentOf(crew, pick)
  const detail = picked && detailOf(crew, picked, now)
  const ending = endingOf(crew, short)
  // Narrow, the detail takes the list's place.
  const alone = detail && !wide
  return (
    <div
      ref={root}
      data-slot="crew-body"
      data-wide={wide || undefined}
      className="flex min-h-0 flex-1 flex-col overflow-auto px-4 pt-3 pb-4 text-ui"
    >
      {crew.description && !alone && (
        <p className="mb-2 text-foreground">{crew.description}</p>
      )}
      {ending && !alone && (
        <EndingCard ending={ending} short={short} onGoOn={onGoOn} />
      )}
      {script && crew.script && !alone && (
        <pre
          data-slot="crew-script"
          className="mb-3 max-h-64 shrink-0 overflow-auto rounded-control bg-raised px-3 py-2 font-mono text-code whitespace-pre-wrap"
        >
          {crew.script}
        </pre>
      )}
      <SummaryRow crew={crew} filter={filter} onFilter={setFilter} />
      {alone ? (
        <AgentDetail detail={detail} crumbs onClose={() => onPick(undefined)} />
      ) : (
        <>
          <Strip
            phases={stripOf(crew)}
            className="mt-3 mb-3 shrink-0"
            onOpen={(agent) => onPick(keyOf(agent))}
          />
          <div className="flex min-h-0 flex-1 gap-3">
            <div className="min-w-0 flex-1">
              {tab === "timeline" ? (
                <TimelineView
                  crew={crew}
                  filter={filter}
                  picked={pick}
                  onPick={onPick}
                />
              ) : wide ? (
                <Columns
                  columns={columnsOf(crew, filter, now)}
                  picked={pick}
                  narrow={detail !== undefined}
                  onPick={onPick}
                />
              ) : (
                <Bands
                  bands={bandsOf(crew, filter, now)}
                  picked={pick}
                  onPick={onPick}
                />
              )}
            </div>
            {detail && (
              <div className="w-[min(24rem,42%)] shrink-0 border-l pl-4">
                <AgentDetail
                  detail={detail}
                  onClose={() => onPick(undefined)}
                />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

/** One line of counts, the clock and the tokens, then the filter. The
 * clock alone ticks, by the second, while it works. */
function SummaryRow({
  crew,
  filter,
  onFilter,
}: {
  crew: Crew
  filter: Filter
  onFilter: (filter: Filter) => void
}) {
  const summary = summaryOf(crew)
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5">
      <p
        data-slot="crew-summary"
        className="flex min-w-0 flex-wrap items-center gap-x-1.5 tabular-nums"
      >
        <Counts counts={summary.counts} />
        <Clock crew={crew} />
        {summary.tokens && (
          <span className="text-muted-foreground">· {summary.tokens}</span>
        )}
      </p>
      <Choices
        kind="radio"
        label="Show"
        className="ml-auto shrink-0"
        choices={FILTERS}
        chosen={filter}
        onChoose={onFilter}
      />
    </div>
  )
}

function Counts({ counts }: { counts: Count[] }) {
  return counts.map((count, at) => (
    <span
      key={at}
      className={cn(
        at === 0 ? "font-medium text-foreground" : "text-muted-foreground",
        count.tone && TONES[count.tone]
      )}
    >
      {at > 0 && <span className="text-muted-foreground">· </span>}
      {count.words}
    </span>
  ))
}

/** The Pane's one clock: by the second while it works, still once it
 * ended, none once Lost. */
function Clock({ crew }: { crew: Crew }) {
  const now = useNow(1000, crew.state === "working")
  const clock = clockOf(crew, now)
  if (!clock) return null
  return (
    <span data-slot="crew-clock" className="font-medium text-foreground">
      <span className="font-normal text-muted-foreground">· </span>
      {clock}
    </span>
  )
}

/** What stands over the summary once the Crew ended. */
function EndingCard({
  ending,
  short,
  onGoOn,
}: {
  ending: Ending
  short: string
  onGoOn: () => void
}) {
  if (ending.kind === "result")
    return (
      <section
        data-slot="crew-result"
        aria-label="Result"
        className="mb-3 shrink-0 rounded-card border bg-block px-3.5 py-3"
      >
        <p className="mb-1.5 flex items-baseline gap-2">
          <span className="font-medium">Result</span>
          <span className="text-meta text-muted-foreground">
            returned to {short} at {ending.at}
          </span>
        </p>
        <ResultText result={ending.result} />
        <Button
          variant="ghost"
          size="xs"
          className="mt-1.5 -ml-1.5 text-muted-foreground"
          onClick={() => void copyText(ending.result.text)}
        >
          <CopyIcon aria-hidden />
          Copy result
        </Button>
      </section>
    )
  if (ending.kind === "failed")
    return (
      <section
        data-slot="crew-failed"
        className="mb-3 shrink-0 rounded-card border bg-block px-3.5 py-3"
      >
        <p className="font-medium text-destructive">Failed</p>
        <p className="text-muted-foreground">{ending.why}</p>
      </section>
    )
  return (
    <section
      data-slot="crew-lost"
      className="mb-3 flex shrink-0 items-center gap-3 rounded-card border bg-block px-3.5 py-3"
    >
      <CrewGlyph state="lost" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{ending.words}</p>
        {ending.then && (
          <p className="text-meta text-muted-foreground">{ending.then}</p>
        )}
      </div>
      {ending.goOn && (
        <Button variant="outline" size="sm" onClick={onGoOn}>
          Ask {short} to go on
        </Button>
      )}
    </section>
  )
}

/** A Result: JSON in code, folded with a fade past a few lines until
 * Show all; text as it is. */
function ResultText({ result }: { result: Result }) {
  const [all, setAll] = useState(false)
  const long = result.text.split("\n").length > 8
  return (
    <>
      <div
        className={cn(
          "relative overflow-hidden",
          long && !all && "max-h-40 mask-b-from-60% mask-b-to-100%"
        )}
      >
        {result.json ? (
          <pre className="rounded-control bg-raised px-3 py-2 font-mono text-code whitespace-pre-wrap">
            {result.text}
          </pre>
        ) : (
          <p className="whitespace-pre-wrap">{result.text}</p>
        )}
      </div>
      {long && (
        <Button
          variant="link"
          size="xs"
          className="-ml-1.5 text-muted-foreground"
          onClick={() => setAll(!all)}
        >
          {all ? "Show less" : "Show all"}
        </Button>
      )}
    </>
  )
}

/** A phase's head: its name, what it does and its model, its count. */
function PhaseTitle({ head }: { head: Column | Band }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2 text-meta whitespace-nowrap">
      <span className="shrink-0 font-medium text-foreground">{head.title}</span>
      {head.about && (
        <span className={cn("min-w-0 text-muted-foreground", FADES)}>
          {head.about}
        </span>
      )}
      {head.count && (
        <span className="ml-auto shrink-0 text-muted-foreground tabular-nums">
          {head.count}
        </span>
      )}
    </div>
  )
}

/** Wide: a column a phase, its agents in index order. Beside a detail,
 * rows show their names alone. */
function Columns({
  columns,
  picked,
  narrow,
  onPick,
}: {
  columns: Column[]
  picked: string | undefined
  narrow: boolean
  onPick: (key: string) => void
}) {
  return (
    <div
      data-slot="crew-columns"
      className="grid h-full min-h-48 gap-2"
      style={{
        gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))`,
      }}
    >
      {columns.map((column) => (
        <section
          key={column.index}
          aria-label={column.title}
          className="flex min-w-0 flex-col gap-1 rounded-card bg-block px-1.5 py-2"
        >
          <div className="px-1.5 pb-1">
            <PhaseTitle head={column} />
          </div>
          {column.waits ? (
            <p className="flex items-center gap-2 px-1.5 text-meta text-muted-foreground">
              <Satellite state="queued" size={8} />
              Not started yet
            </p>
          ) : (
            column.rows.map((row) => (
              <AgentRow
                key={row.key}
                row={row}
                picked={picked === row.key}
                bare={narrow}
                onPick={onPick}
              />
            ))
          )}
        </section>
      ))}
    </div>
  )
}

/** Narrow: a band a phase. Who asks, failed and at work always show;
 * done ones fold into "✓ 38 done", which opens, and the queued into "6
 * waiting for a slot". */
function Bands({
  bands,
  picked,
  onPick,
}: {
  bands: Band[]
  picked: string | undefined
  onPick: (key: string) => void
}) {
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set())
  return (
    <div data-slot="crew-bands" className="flex flex-col gap-2">
      {bands.map((band) => {
        const shown = open.has(band.index)
        return (
          <section
            key={band.index}
            aria-label={band.title}
            className="flex min-w-0 flex-col gap-0.5 rounded-card bg-block px-1.5 py-2"
          >
            <div className="px-1.5 pb-1">
              <PhaseTitle head={band} />
            </div>
            {band.rows.map((row) => (
              <AgentRow
                key={row.key}
                row={row}
                picked={picked === row.key}
                onPick={onPick}
              />
            ))}
            {band.done.length > 0 && (
              <>
                <button
                  type="button"
                  aria-expanded={shown}
                  onClick={() =>
                    setOpen((was) => {
                      const next = new Set(was)
                      if (!next.delete(band.index)) next.add(band.index)
                      return next
                    })
                  }
                  className="flex cursor-pointer items-center gap-2 rounded-control px-1.5 py-1 text-left text-muted-foreground outline-none hover:bg-foreground/5 focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <CheckIcon aria-hidden className="size-3.5 shrink-0" />
                  <span className="flex-1">{doneWords(band.done.length)}</span>
                  {shown ? (
                    <ChevronDownIcon aria-hidden className="size-3.5" />
                  ) : (
                    <ChevronRightIcon aria-hidden className="size-3.5" />
                  )}
                </button>
                {shown &&
                  band.done.map((row) => (
                    <AgentRow
                      key={row.key}
                      row={row}
                      picked={picked === row.key}
                      onPick={onPick}
                    />
                  ))}
              </>
            )}
            {band.waiting > 0 && (
              <p className="flex items-center gap-2 px-1.5 py-1 text-muted-foreground">
                <Satellite state="queued" size={8} />
                {waitingWords(band.waiting)}
              </p>
            )}
            {band.waits && (
              <p className="flex items-center gap-2 px-1.5 text-meta text-muted-foreground">
                <Satellite state="queued" size={8} />
                Not started yet
              </p>
            )}
          </section>
        )
      })}
    </div>
  )
}

/** A label as a path reads: what is before its last "/" muted, cut from
 * its start where it does not fit, so its name stays whole; `bare`, its
 * name alone. */
function Label({ label, bare = false }: { label: string; bare?: boolean }) {
  const cut = label.lastIndexOf("/") + 1
  return (
    <span className="flex min-w-0 flex-1 items-baseline">
      {cut > 0 && !bare && (
        // Right to left, so what overflows is its start.
        <span
          dir="rtl"
          className="min-w-0 shrink overflow-hidden text-left whitespace-nowrap text-muted-foreground"
        >
          <span dir="ltr">{label.slice(0, cut)}</span>
        </span>
      )}
      <span
        className={cn(
          "min-w-0 text-foreground",
          cut > 0 ? "shrink-[0.01]" : "shrink",
          FADES
        )}
      >
        {label.slice(cut)}
      </span>
    </span>
  )
}

/** One agent: its satellite, label, attempt, Failed, time, and its line;
 * a click shows its detail. */
function AgentRow({
  row,
  picked,
  bare = false,
  onPick,
}: {
  row: Row
  picked: boolean
  bare?: boolean
  onPick: (key: string) => void
}) {
  return (
    <button
      type="button"
      data-agent={row.key}
      data-look={row.look}
      aria-pressed={picked}
      onClick={() => onPick(row.key)}
      className={cn(
        "flex w-full min-w-0 cursor-pointer flex-col gap-0.5 rounded-control px-1.5 py-1.5 text-left outline-none hover:bg-foreground/5 focus-visible:ring-3 focus-visible:ring-ring/50",
        picked && "bg-foreground/8 hover:bg-foreground/8"
      )}
    >
      <span className="flex w-full min-w-0 items-center gap-2 whitespace-nowrap">
        <Satellite state={row.look} size={8} />
        <Label label={row.label} bare={bare} />
        {row.attempt && !bare && (
          <span className="shrink-0 rounded-small bg-foreground/8 px-1 text-small text-muted-foreground">
            attempt {row.attempt}
          </span>
        )}
        {row.look === "failed" && !bare && (
          <span className="shrink-0 rounded-small bg-destructive/12 px-1 text-small text-destructive">
            Failed
          </span>
        )}
        {row.time && (
          <span
            className={cn(
              "shrink-0 text-meta tabular-nums",
              row.look === "asks" ? "text-attention" : "text-muted-foreground"
            )}
          >
            {row.time}
          </span>
        )}
      </span>
      {row.line && (
        <span
          className={cn(
            "w-full pl-4 text-meta whitespace-nowrap text-muted-foreground",
            row.look === "asks" && "font-medium text-foreground",
            FADES
          )}
        >
          {row.line}
        </span>
      )}
    </button>
  )
}

/** How near now, on the axis from 0 to 1, a mark gives way to its word. */
const NEAR_NOW = 0.06

/** The Timeline: an axis on top, a lane an agent in its phase's band, and
 * a line for now while it works. */
function TimelineView({
  crew,
  filter,
  picked,
  onPick,
}: {
  crew: Crew
  filter: Filter
  picked: string | undefined
  onPick: (key: string) => void
}) {
  // Now moves with the clock, by the second; the axis stays.
  const now = useNow(1000, crew.state === "working")
  const line = timelineOf(crew, filter, now)
  const track = (children: React.ReactNode) => (
    <div className="relative h-full min-w-0 flex-1">{children}</div>
  )
  return (
    <div
      data-slot="crew-timeline"
      className="relative flex flex-col gap-2 text-meta"
    >
      <div className="flex h-5 items-end">
        <div className="w-[40%] max-w-56 shrink-0" />
        {track(
          <>
            {line.ticks.map((tick) =>
              // Now's word takes the place of a mark it would cover.
              line.now !== undefined &&
              Math.abs(tick.at - line.now) < NEAR_NOW ? null : (
                <span
                  key={tick.at}
                  className="absolute bottom-0 -translate-x-1/2 text-muted-foreground tabular-nums"
                  style={{ left: `${tick.at * 100}%` }}
                >
                  {tick.words}
                </span>
              )
            )}
            {line.now !== undefined && (
              <span
                className="absolute bottom-0 -translate-x-1/2 font-medium text-foreground"
                style={{ left: `${line.now * 100}%` }}
              >
                now
              </span>
            )}
          </>
        )}
      </div>
      {line.phases.map((phase) => (
        <section
          key={phase.index}
          aria-label={phase.title}
          className="relative flex flex-col gap-1 rounded-card bg-block px-3 py-2"
        >
          {line.now !== undefined && (
            // Now, over the tracks, past the names' column.
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 right-3 left-3 flex"
            >
              <div className="w-[40%] max-w-56 shrink-0" />
              {track(
                <span
                  className="absolute inset-y-0 w-px bg-foreground/30"
                  style={{ left: `${line.now * 100}%` }}
                />
              )}
            </div>
          )}
          <p className="flex items-baseline gap-2">
            <span className="font-medium text-foreground">{phase.title}</span>
            <span className="text-muted-foreground">
              {[phase.about, phase.count ?? "not started"]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </p>
          {phase.lanes.map((lane) => (
            <button
              key={lane.key}
              type="button"
              data-agent={lane.key}
              aria-pressed={picked === lane.key}
              onClick={() => onPick(lane.key)}
              className={cn(
                "-mx-1 flex h-6 cursor-pointer items-center rounded-control px-1 text-left outline-none hover:bg-foreground/5 focus-visible:ring-3 focus-visible:ring-ring/50",
                picked === lane.key && "bg-foreground/8"
              )}
            >
              <span className="flex w-[40%] max-w-56 shrink-0 items-center gap-1.5 pr-3 whitespace-nowrap">
                <Label label={lane.label} />
                {lane.attempt && (
                  <span className="shrink-0 rounded-small bg-foreground/8 px-1 text-small text-muted-foreground">
                    attempt {lane.attempt}
                  </span>
                )}
              </span>
              {track(
                <span
                  className="absolute top-1/2 flex h-1.5 min-w-1.5 -translate-y-1/2 items-center rounded-full"
                  style={{
                    left: `${lane.from * 100}%`,
                    width: `${(lane.to - lane.from) * 100}%`,
                    background: SATELLITE_COLOURS[lane.look],
                    opacity: lane.look === "done" ? 0.6 : 1,
                  }}
                />
              )}
            </button>
          ))}
        </section>
      ))}
      <p className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-muted-foreground">
        {(
          [
            ["done", "done"],
            ["working", "working"],
            ["asks", "asks you"],
            ["failed", "failed"],
          ] as const
        ).map(([look, words]) => (
          <span key={look} className="flex items-center gap-1.5">
            <i
              className="block h-1.5 w-4 rounded-full"
              style={{ background: SATELLITE_COLOURS[look] }}
            />
            {words}
          </span>
        ))}
      </p>
    </div>
  )
}

/** An agent's detail: its breadcrumb where it takes the list's place, its
 * facts, brief, what it last did and its result. Its work comes later. */
function AgentDetail({
  detail,
  crumbs = false,
  onClose,
}: {
  detail: Detail
  crumbs?: boolean
  onClose: () => void
}) {
  const keyFor = useKeyLabel()
  const [whole, setWhole] = useState(false)
  return (
    <section
      data-slot="crew-agent"
      aria-label={detail.label}
      className="flex min-w-0 flex-col gap-3 pt-3"
    >
      {crumbs && (
        <nav
          aria-label="Where it is"
          className="flex min-w-0 items-center gap-1 text-meta text-muted-foreground"
        >
          {detail.crumbs.map((crumb, at) => (
            <span key={at} className="flex min-w-0 items-center gap-1">
              {at > 0 && (
                <ChevronRightIcon aria-hidden className="size-3 shrink-0" />
              )}
              {at < 2 ? (
                <button
                  type="button"
                  onClick={onClose}
                  className={cn(
                    "cursor-pointer rounded-small outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
                    FADES
                  )}
                >
                  {crumb}
                </button>
              ) : (
                <span className={cn("text-foreground", FADES)}>{crumb}</span>
              )}
            </span>
          ))}
        </nav>
      )}
      <div className="flex min-w-0 items-center gap-2">
        <Satellite state={detail.look} size={10} />
        <h3 className={cn("min-w-0 flex-1 font-medium", FADES)}>
          <Label label={detail.label} />
        </h3>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Close the agent"
          title={keyFor("agents.crew.back", "Close")}
          onClick={onClose}
        >
          <XIcon />
        </Button>
      </div>
      <dl className="grid grid-cols-[auto_1fr_auto_1fr] gap-x-4 gap-y-1">
        {detail.facts.map((fact) => (
          <div key={fact.name} className="contents">
            <dt className="text-muted-foreground">{fact.name}</dt>
            <dd className="flex min-w-0 items-center gap-1.5">
              {fact.look && <Satellite state={fact.look} size={8} />}
              {fact.value}
            </dd>
          </div>
        ))}
      </dl>
      {detail.why && (
        <p
          className={cn(
            detail.look === "failed"
              ? "text-destructive"
              : "text-muted-foreground"
          )}
        >
          {detail.why}
        </p>
      )}
      {detail.brief && (
        <div>
          <h4 className="mb-0.5 text-meta font-medium text-muted-foreground">
            Brief
          </h4>
          <p className={cn("whitespace-pre-wrap", !whole && "line-clamp-2")}>
            {detail.brief}
          </p>
          {detail.brief.length > 120 && (
            <Button
              variant="link"
              size="xs"
              className="-ml-1.5 text-muted-foreground"
              onClick={() => setWhole(!whole)}
            >
              {whole ? "less" : "more"}
            </Button>
          )}
        </div>
      )}
      {detail.last && (
        <div>
          <h4 className="mb-0.5 text-meta font-medium text-muted-foreground">
            Last
          </h4>
          <p className={FADES}>{detail.last}</p>
        </div>
      )}
      <div>
        <h4 className="mb-0.5 text-meta font-medium text-muted-foreground">
          Result
        </h4>
        {detail.result ? (
          <ResultText result={detail.result} />
        ) : (
          <p className="text-muted-foreground">
            {detail.look === "done" ? "It gave none." : "Comes when it ends."}
          </p>
        )}
      </div>
    </section>
  )
}

/**
 * A Crew over its Thread, as a screen on top, where the Thread's Pane is
 * alone (decision 21 for a sub-agent, here for a Crew): under the Pane's
 * own header, a row with ←, its glyph, its name and the tabs, then the
 * view its Pane draws. ← or Esc closes the agent's detail first, then goes
 * back to the Thread. No Stop.
 */
export function CrewScreen({
  engine,
  project,
  thread,
  crew: id,
  pick,
  focused,
  onPick,
  onBack,
}: {
  engine: Engine
  project: ProjectId
  thread: ThreadId
  crew: CrewId
  pick: string | undefined
  focused: boolean
  onPick: (key: string | undefined) => void
  onBack: () => void
}) {
  const read = useCrew(engine, project, thread, id)
  const [tab, setTab] = useState<Tab>("phases")
  const [script, setScript] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const keyFor = useKeyLabel()
  const back = () => (pick === undefined ? onBack() : onPick(undefined))
  const scope = useScope(CREW, {
    "agents.crew.back": (_, pressed) => {
      pressed?.stopPropagation()
      back()
      return true
    },
  })
  useEffect(() => scope(root.current), [scope])
  // It takes the focus as it opens, again as its Pane does, and as an
  // agent's detail takes the place of the row clicked, for Esc.
  useEffect(() => {
    if (focused && !root.current?.contains(document.activeElement))
      root.current?.focus({ preventScroll: true })
  }, [focused, pick])
  const crew = read.crew
  const title = crew && `Crew ${crew.title}`
  return (
    <div
      ref={root}
      tabIndex={-1}
      role="region"
      aria-label={title ?? "Crew"}
      data-slot="crew-screen"
      className="@container/crew absolute inset-0 flex flex-col outline-none"
    >
      <div className="flex h-9 shrink-0 items-center gap-2 px-2.5 text-ui">
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Back"
          title={keyFor("agents.crew.back", "Back")}
          className="shrink-0"
          onClick={back}
        >
          <ArrowLeftIcon />
        </Button>
        <CrewHead crew={crew} from={undefined} />
        <span className="ml-auto flex shrink-0 items-center">
          {crew && (
            <>
              <Tabs tab={tab} onTab={setTab} />
              <CrewMenu
                crew={crew}
                script={script}
                onScript={() => setScript(!script)}
              />
            </>
          )}
        </span>
      </div>
      <Read read={read}>
        {(crew) => (
          <CrewBody
            crew={crew}
            short={read.short}
            tab={tab}
            script={script}
            pick={pick}
            onPick={onPick}
            onGoOn={() => {
              draftIn(project, thread, goOnMessage(crew))
              onBack()
            }}
          />
        )}
      </Read>
    </div>
  )
}
