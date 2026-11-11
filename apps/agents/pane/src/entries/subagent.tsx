/**
 * A sub-agent where it started in its Thread (ADR 0103, decisions 15–17):
 * one row on the work line's edge, with its satellite, its title, its role
 * and model, what it does now or how it ended, and its time, which does not
 * tick. A click opens it in place, with nothing above it moving: its brief,
 * its work as one line, its report, and Open beside, which the pointer
 * also shows at the row's right in its time's place (decision 21). The row
 * stays lit while the Pane beside shows it. Banda shows a Harness's
 * sub-agents and manages none of them (ADR 0103, call 11), so a row offers
 * no Stop.
 */
import { useState } from "react"
import { LayersIcon, PanelRightIcon } from "lucide-react"
import type { Item } from "@banda/contract/agents"
import { Button } from "@banda/ui/components/button"
import {
  Collapsible,
  CollapsibleContent,
} from "@banda/ui/components/collapsible"
import { Markdown } from "@banda/ui/components/markdown"
import { Satellite } from "@banda/ui/components/satellite"
import { Trace } from "@banda/ui/components/trace"
import type { SatelliteState } from "@banda/ui/lib/satellite"
import { cn } from "@banda/ui/lib/utils"
import { CallEntry } from "./call"
import { THREAD_ZOOM } from "./parts/Messages"
import { FADES, RowTrigger } from "./parts/RowTrigger"
import { Kinds, WorkFold } from "./parts/WorkFold"
import { ThoughtEntry } from "./thought"
import type { EntryOf, EntryProps, SubagentRow } from "./types"
import { useLit, useOpened, useThreadAround } from "../thread/context"
import {
  laneDid,
  type LaneState,
  turnStateOf,
  useSubagent,
  workOfLane,
} from "../thread/live-lane"
import { type Now, nowWords, stateWord } from "../thread/subagents"
import { going } from "../thread/timeline"

export function SubagentEntry({ item, subagentRow }: EntryProps<"subagent">) {
  const [open, setOpen] = useOpened(item.body.subagent)
  const lit = useLit(item.body.subagent)
  const { acts } = useThreadAround()
  if (!subagentRow) return null
  const { lane, said } = subagentRow
  const tone = TONES[said.look]
  // Closed, the pointer shows Open beside; opened, its own button does.
  const beside = open ? undefined : acts.openSubagent
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      data-slot="subagent"
      data-look={said.look}
      data-lit={lit || undefined}
      className="flex min-w-0 flex-col"
    >
      {/* The pointer shows Open beside in its time's place, beside the
          line that opens it in place, not in it. */}
      <div className="group/line relative flex min-w-0 flex-col">
        <RowTrigger
          aria-label={said.label}
          aria-description={[
            stateWord(lane),
            nowWords(said.now),
            said.time,
          ].join(" · ")}
          className={cn(lit && "bg-foreground/5")}
        >
          {/* Not a TraceIcon, which hides itself: the satellite names how
            the row stands. */}
          <span className="flex size-4 shrink-0 items-center justify-center">
            <Satellite state={said.look} size={10} />
          </span>
          <span className={cn("max-w-[58%] min-w-10", FADES, tone.title)}>
            {said.title}
          </span>
          {said.role && (
            <span className={cn("shrink-0 text-meta", tone.role)}>
              {said.role}
            </span>
          )}
          {said.plus && (
            <span
              title="Its own sub-agents"
              className="shrink-0 text-meta text-sub-faint tabular-nums"
            >
              {said.plus}
            </span>
          )}
          {said.failed && (
            <span className="shrink-0 rounded-control bg-destructive/12 px-1.5 py-0.5 text-small font-medium text-destructive">
              Failed
            </span>
          )}
          <span
            className={cn(
              "min-w-0 flex-1 basis-0 text-ui",
              FADES,
              !said.failed && "ml-1.5",
              tone.now
            )}
          >
            <NowSaid now={said.now} />
          </span>
          <span
            className={cn(
              "min-w-11 shrink-0 text-right text-meta tabular-nums",
              tone.time,
              beside &&
                "group-hover/line:invisible group-has-[[data-beside]:focus-visible]/line:invisible"
            )}
          >
            {said.time}
          </span>
        </RowTrigger>
        {beside && (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Open beside"
            title="Open beside"
            data-beside=""
            // Still there for the keys, unseen until the pointer or the
            // focus is on it.
            className="pointer-events-none absolute top-0.5 right-5.5 text-muted-foreground opacity-0 group-hover/line:pointer-events-auto group-hover/line:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100"
            onClick={() => beside(lane.id)}
          >
            <PanelRightIcon className="size-3.5" />
          </Button>
        )}
      </div>
      {/* It opens at once, as the kit's does: what it holds shows whole
          below it, and nothing above it moves. */}
      <CollapsibleContent className="flex min-w-0 flex-col gap-2.5 pt-1 pb-2 pl-6 text-sm wrap-break-word text-muted-foreground">
        <Opened row={subagentRow} />
      </CollapsibleContent>
    </Collapsible>
  )
}

/** The colours of a row's parts by how it looks: grey all through while it
 * works, colour only where it calls, the attention's on its time while it
 * asks (ADR 0103, decision 15). Its satellite takes its own. */
type Tone = { title: string; role: string; now: string; time: string }

const MUTED = "text-muted-foreground"
const AT_WORK: Tone = {
  title: "text-sub-grey",
  role: "text-sub-faint",
  now: "text-sub-faint",
  time: "text-sub-faint",
}
const CALM: Tone = {
  title: "text-foreground",
  role: MUTED,
  now: MUTED,
  time: MUTED,
}
const GONE: Tone = { ...CALM, title: "text-sub-grey", now: "text-sub-faint" }

const TONES: Record<SatelliteState, Tone> = {
  working: AT_WORK,
  queued: AT_WORK,
  asks: { ...CALM, now: "text-foreground", time: "font-medium text-attention" },
  done: CALM,
  failed: CALM,
  stopped: GONE,
  lost: GONE,
}

/** What a row says it does now: what it asks after "Asks:", a command in
 * mono. */
function NowSaid({ now: { lead, text, mono } }: { now: Now }) {
  return (
    <>
      {lead && <span className="font-medium">{lead} </span>}
      {mono ? <code className="font-mono text-meta">{text}</code> : text}
    </>
  )
}

/** A row opened in place: who asked it what, its work as one line, its
 * report, and Open beside, where the Thread can. Its work is read once it
 * opens, and followed while it shows. */
function Opened({ row: { lane, said, asker } }: { row: SubagentRow }) {
  const { engine, project, thread, acts } = useThreadAround()
  const live = useSubagent(engine, project, thread, lane.id)
  return (
    <>
      {lane.prompt && <Brief asker={asker} text={lane.prompt} />}
      {live.state === "ready" && <Work lane={live.view} />}
      {(lane.report || acts.openSubagent) && (
        <Report text={lane.report} done={said.look === "done"}>
          {acts.openSubagent && (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => acts.openSubagent?.(lane.id)}
            >
              <PanelRightIcon data-icon="inline-start" />
              Open beside
            </Button>
          )}
        </Report>
      )}
    </>
  )
}

/** "Claude asked" and the brief, in two full lines until "more" shows it
 * all, as it was written. */
function Brief({ asker, text }: { asker: string; text: string }) {
  const [all, setAll] = useState(false)
  return (
    <div
      data-clamp-scope
      className="flex min-w-0 items-end gap-2 text-ui"
    >
      <p
        data-clamped={all ? undefined : "brief"}
        className={cn(
          "min-w-0 flex-1",
          all ? "whitespace-pre-wrap" : "max-h-10 overflow-hidden"
        )}
      >
        <span className="mr-1 font-medium text-foreground">{asker} asked</span>
        {text}
      </p>
      <button
        type="button"
        data-clamp-more={all ? undefined : ""}
        onClick={() => setAll(!all)}
        className="shrink-0 cursor-pointer rounded-control text-meta text-muted-foreground/80 underline decoration-current/35 underline-offset-3 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {all ? "less" : "more"}
      </button>
    </div>
  )
}

/** Its work as one line, as a turn's (ADR 0058, decision 4), counted from
 * its own entries; a call that still runs shows under it and shimmers.
 * Nothing before it has done any. */
function Work({ lane }: { lane: LaneState }) {
  const turn = turnStateOf(lane.subagent)
  const ended: Item[] = []
  const running: Item[] = []
  for (const item of workOfLane(lane))
    (going(item, turn) ? running : ended).push(item)
  if (ended.length === 0 && running.length === 0) return null
  const last = lane.items.at(-1)
  const step = (item: Item, live: boolean) =>
    item.body.kind === "tool" ? (
      <CallEntry
        key={item.id}
        item={item as EntryOf<"tool">}
        turn={turn}
        asks={false}
        live={false}
      />
    ) : (
      <ThoughtEntry
        key={item.id}
        item={item as EntryOf<"thought">}
        turn={turn}
        asks={false}
        live={live}
      />
    )
  const done = laneDid(lane)
  return (
    <Trace>
      {ended.length > 0 && (
        <WorkFold
          icon={<LayersIcon />}
          title={<Kinds did={done} capital />}
          did={done}
        >
          <div className="flex flex-col gap-2 py-0.5">
            {ended.map((item) =>
              step(item, turn === "running" && item === last)
            )}
          </div>
        </WorkFold>
      )}
      {running.map((item) => step(item, true))}
    </Trace>
  )
}

/** Its report as quoted prose, faded after four lines, and the row's
 * quiet actions under it, `children`; a done one shows all of it on "Show
 * all", there beside them. */
function Report({
  text,
  done,
  children,
}: {
  text?: string
  done: boolean
  children?: React.ReactNode
}) {
  const [all, setAll] = useState(false)
  return (
    <div data-clamp-scope className="flex min-w-0 flex-col gap-1">
      {text && (
        <div
          data-slot="subagent-report"
          data-clamped={all ? undefined : "report"}
          className={cn(
            "border-l-2 border-sub-rule pl-3 text-foreground/88",
            THREAD_ZOOM,
            !all &&
              "max-h-[calc(var(--prose-leading)*4+0.5rem)] scroll-fade-b overflow-hidden [--scroll-fade-reveal:1px] scroll-fade-b-10"
          )}
        >
          <Markdown>{text}</Markdown>
        </div>
      )}
      <div className="-ml-2 flex items-center gap-0.5 empty:hidden">
        {children}
        {text && done && (
          <div data-clamp-more={all ? undefined : ""} className="flex">
            <Button variant="ghost" size="xs" onClick={() => setAll(!all)}>
              {all ? "Show less" : "Show all"}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
