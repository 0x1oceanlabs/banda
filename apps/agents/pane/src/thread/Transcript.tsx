/** A Thread's transcript: its entries and lines, in the scroller that
 * follows the live edge (ADR 0058, ADR 0091). A sub-agent's Pane draws its
 * lane with it (ADR 0103, decision 21). */
import { useCallback, useMemo, useRef } from "react"
import type { Item, Subagent, SubagentId } from "@banda/contract/agents"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@banda/ui/components/message-scroller"
import { Spinner } from "@banda/ui/components/spinner"
import { useNow } from "@banda/ui/hooks/use-now"
import {
  Trace,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@banda/ui/components/trace"
import { ArrowDownIcon } from "lucide-react"
import {
  type Listing,
  steerable,
  threadOf,
  type Waiting,
  working,
} from "./state"
import type { Asker } from "../entries/parts/Brief"
import { Writer } from "../entries/parts/Messages"
import { namesSubagent } from "../entries/parts/messageText"
import type { EntryFacts, SubagentRow } from "../entries/types"
import { modelNow } from "../composer/picker"
import type { Lanes } from "./findIn"
import type { Followed } from "./live-thread"
import { askerOf, byId, byLabel, rowOf } from "./subagents"
import { laneTimeline, timeline } from "./timeline"
import { factsOf, knownOf } from "./entry-facts"
import { key, LineOf } from "../lines"
import type { LineFacts } from "../lines/types"
import { Queue, type QueueActions } from "./Queue"
import { PEEK, ScrollPlace } from "./ScrollPlace"
import { Minimap } from "./Minimap"
import { useThreadAround } from "./context"
import type { Moves } from "./moves"

/** A Listing with no other Thread, as a sub-agent's Pane has: its
 * messages are its own. */
const NO_WRITERS: Listing = { threads: new Map() }

/** No messages that wait, as in a sub-agent's Pane. */
const NO_WAITS: Waiting[] = []

/** A queue there is none of: a sub-agent's Pane sends nothing. */
const NO_QUEUE: QueueActions = {
  onSendNow: () => {},
  onEdit: async () => false,
  onRemove: () => {},
  onContinue: () => {},
  onEditing: () => {},
}

/** A Thread's transcript; a sub-agent's Pane, which sends nothing and
 * finds nothing, gives none of what it may leave out. */
export function Transcript({
  forYou = false,
  finding = "",
  state,
  waits = NO_WAITS,
  name,
  short,
  queue = NO_QUEUE,
  writers = NO_WRITERS,
  answering = false,
  moves,
  whenBack,
  lane,
}: {
  /** The Threads whose Agents wrote to it. */
  writers?: Listing
  /** Whether a command is on its way; what acts waits for it. A Question
   * is answered on the composer (ADR 0058, decision 6). */
  answering?: boolean
  /** The Thread waits for its Person: a Question, or a plan. */
  forYou?: boolean
  /** What the Person looks for in it, if anything. */
  finding?: string
  state: Followed
  /** The messages that wait, from {@link waiting}. */
  waits?: Waiting[]
  name: string
  /** Its Harness's short name, "Claude", who sets its sub-agents to work. */
  short: string
  queue?: QueueActions
  /** Where the Thread may move, for a limit's card. */
  moves?: Moves
  /** The messages that wait for its machine, last (ADR 0105). */
  whenBack?: React.ReactNode
  /** A sub-agent's lane, read only in its own Pane, `state` holding it as
   * a turn for each time it was set to work (ADR 0103, decisions 21 and
   * 25): its brief first, its lines with no clock, its own place to come
   * back to, nothing to fork or edit, and the rows of the sub-agents it
   * started, set to work by it, `short`. What its parent wrote to it
   * after the brief shows under `wrote`'s words (decision 25). */
  lane?: { id: SubagentId; brief: React.ReactNode; wrote?: Asker }
}) {
  const { thread, reader, acts } = useThreadAround()
  // Its Later, to put it off until a usage limit's reset (ADR 0074).
  const later = writers.own?.later
  const turn = working(state)
  const ofLane = lane !== undefined
  const lines = useMemo(
    () => (ofLane ? laneTimeline(state) : timeline(state, short)),
    [state, short, ofLane]
  )
  const last = state.items.at(-1)
  // Its sub-agents, and the model it runs on, which their rows name only
  // when theirs is another (ADR 0103, decision 15).
  const model = useMemo(
    () => modelNow(state.settings, state.offer.options),
    [state.settings, state.offer.options]
  )
  const lanes = useMemo<Lanes>(
    () => ({ byId: byId(state.subagents), model }),
    [state.subagents, model]
  )
  // A working row's time moves by the minute, as the sidebar's ages do;
  // only the live line counts the seconds (ADR 0103, decision 20).
  const now = useNow(
    MINUTE,
    state.subagents.some((lane) => !lane.ended)
  )
  const top = lane?.id
  const rows = useMemo(
    () => rowsOf(state, lanes, short, now, top),
    [state, lanes, short, now, top]
  )
  // The sub-agents a Person's message names as chips (ADR 0103, decision
  // 25).
  const about = useMemo(() => byLabel(state.subagents), [state.subagents])
  // A message to a sub-agent after its brief: in its own Pane who wrote
  // it, elsewhere the label of the one it went to.
  const subagentFacts = useCallback(
    (item: Item): Pick<EntryFacts, "about" | "to" | "wrote"> => {
      const { body } = item
      if (body.kind === "message")
        return item.author.kind === "person" && namesSubagent(body.text)
          ? { about }
          : {}
      if (body.kind !== "messaged") return {}
      if (lane && body.subagent === lane.id) return { wrote: lane.wrote }
      const to = askerOf(body.subagent, state.subagents)
      return to === undefined ? {} : { to }
    },
    [about, lane, state.subagents]
  )
  // What the Thread knows that its lines show (ADR 0091, decision 3).
  const known = useMemo(() => knownOf(state), [state])
  const of = useMemo(
    () => factsOf(known, writers, rows, subagentFacts),
    [known, writers, rows, subagentFacts]
  )
  const facts: LineFacts = {
    of,
    turnState: known.turnState,
    finding,
    lanes,
    name,
    harness: state.harness,
    answering,
    later,
    moves,
  }
  const forkedFrom = useMemo(
    () => state.forkedFrom && threadOf(writers, state.forkedFrom),
    [writers, state.forkedFrom]
  )
  const viewport = useRef<HTMLDivElement>(null)
  const messages = lines.flatMap((line) =>
    line.kind === "item" &&
    line.item.author.kind === "person" &&
    line.item.body.kind === "message" &&
    line.item.body.text
      ? [{ id: line.item.id, text: line.item.body.text }]
      : []
  )
  return (
    <MessageScrollerProvider
      autoScroll
      defaultScrollPosition="end"
      scrollPreviousItemPeek={PEEK}
    >
      <MessageScroller>
        <MessageScrollerViewport
          ref={viewport}
          aria-label={ofLane ? `Sub-agent ${short}` : `Thread with ${name}`}
        >
          <MessageScrollerContent
            data-chat
            className="mx-auto w-full max-w-3xl gap-5 px-(--chat-gutter) pt-4 pb-6"
          >
            {lane?.brief && (
              <MessageScrollerItem key="brief">
                {lane.brief}
              </MessageScrollerItem>
            )}
            {forkedFrom && (
              <MessageScrollerItem key="forked-from">
                <Writer
                  thread={forkedFrom}
                  says="Forked from"
                  onOpen={acts.openThread}
                />
              </MessageScrollerItem>
            )}
            {lines.map((line) => (
              <MessageScrollerItem
                key={key(line)}
                messageId={line.kind === "item" ? line.item.id : undefined}
                // A message the Person sends moves near the top, and the
                // reply grows below it, as in T3 Code.
                scrollAnchor={
                  line.kind === "item" && line.item.author.kind === "person"
                }
                // A message's actions show under it, over the room before
                // the next row: room of its own, so they paint there. The
                // last row keeps its margin: the scroller finds the end by
                // its rows' boxes, and a row reaching past the end kept
                // "Scroll to end" on at the end.
                className={
                  line.kind === "item" && line.item.body.kind === "message"
                    ? "-mb-6 pb-6 [&:not(:has(~[data-slot=message-scroller-item]))]:mb-0"
                    : undefined
                }
              >
                <LineOf line={line} facts={facts} />
              </MessageScrollerItem>
            ))}
            {turn?.state === "queued" && (
              <MessageScrollerItem key="getting-ready">
                <Trace>
                  <TraceLine status="running">
                    <TraceIcon>
                      <Spinner className="motion-reduce:animate-none" />
                    </TraceIcon>
                    <TraceTitle>{`${name} is getting ready…`}</TraceTitle>
                  </TraceLine>
                </Trace>
              </MessageScrollerItem>
            )}
            {waits.length > 0 && (
              <MessageScrollerItem key="waiting">
                <Queue
                  waiting={waits}
                  held={state.held}
                  steerable={steerable(state)}
                  name={name}
                  busy={answering}
                  reader={reader}
                  writers={writers}
                  onOpenThread={acts.openThread}
                  {...queue}
                />
              </MessageScrollerItem>
            )}
            {whenBack && (
              <MessageScrollerItem key="when-back">
                {whenBack}
              </MessageScrollerItem>
            )}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <ScrollToEnd queued={waits.length} forYou={forYou} />
        <Minimap messages={messages} />
        <ScrollPlace
          thread={lane?.id ?? thread}
          viewport={viewport}
          last={last?.id}
        />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}

const MINUTE = 60_000

/** Each row as it was last drawn, by its sub-agent's record: a row that
 * says the same keeps its object, so only one that changed draws again
 * (ADR 0088, decision 9). */
const drawn = new WeakMap<Subagent, SubagentRow>()

/** What a row says, to tell whether it says something else. */
const wording = (row: SubagentRow) => JSON.stringify([row.said, row.asker])

/** The row of each sub-agent the Thread shows, the ones no sub-agent
 * started (ADR 0103, decision 16), or in a sub-agent's Pane the ones `top`
 * started, one level down, by its ID, as the Thread words it: set to work
 * by `short`, its Harness or that sub-agent, its parent's model the
 * Thread's, at `now`. */
function rowsOf(
  state: Followed,
  lanes: Lanes,
  short: string,
  now: number,
  top?: SubagentId
): Map<SubagentId, SubagentRow> {
  return new Map(
    state.subagents
      .filter((lane) => lane.parent === top)
      .map((lane) => {
        const row: SubagentRow = {
          lane,
          said: rowOf(lane, {
            lanes: state.subagents,
            heard: state.heard,
            items: state.items,
            parentModel: lanes.model,
            now,
          }),
          asker: short,
        }
        const was = drawn.get(lane)
        if (was && wording(was) === wording(row)) return [lane.id, was]
        drawn.set(lane, row)
        return [lane.id, row]
      })
  )
}

/** The button to the end of the Thread, once it is scrolled up: a round
 * ↓ that floats as the chat's popups do, and says what waits there, as
 * T3 Code's does; a dot in the attention colour says the Thread waits for
 * its Person (ADR 0058). */
function ScrollToEnd({ queued, forYou }: { queued: number; forYou: boolean }) {
  const says = queued > 0 || forYou
  return (
    <MessageScrollerButton
      size={says ? "sm" : "icon-sm"}
      className="gap-1.5 rounded-full border-transparent bg-popover px-3 text-meta text-popover-foreground shadow-float ring-1 ring-foreground/10 hover:bg-accent data-[size=icon-sm]:px-0"
    >
      <ArrowDownIcon />
      <span className="sr-only">Scroll to end{says && " · "}</span>
      {queued > 0 && `${queued} queued`}
      {queued > 0 && forYou && (
        <span className="text-muted-foreground"> · </span>
      )}
      {forYou && (
        <>
          <span aria-hidden className="size-1.5 rounded-full bg-attention" />
          waiting for you
        </>
      )}
    </MessageScrollerButton>
  )
}
