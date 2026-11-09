/** A Thread's transcript: its entries and lines, in the scroller that
 * follows the live edge (ADR 0058, ADR 0091). */
import { useMemo, useRef } from "react"
import type { Item, TurnView } from "@banda/contract/agents"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@banda/ui/components/message-scroller"
import { Spinner } from "@banda/ui/components/spinner"
import {
  Trace,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@banda/ui/components/trace"
import { ArrowDownIcon } from "lucide-react"
import {
  firstTurnOf,
  type Listing,
  steerable,
  threadOf,
  type ThreadState,
  type Waiting,
  working,
  writerOf,
} from "./state"
import { Writer } from "../entries/parts/Messages"
import { awaiting, thoughtTimes, timeline } from "./timeline"
import { key, LineOf } from "../lines"
import type { LineFacts } from "../lines/types"
import { Queue, type QueueActions } from "./Queue"
import { PEEK, ScrollPlace } from "./ScrollPlace"
import { Minimap } from "./Minimap"
import { useThreadAround } from "./context"
import type { Moves } from "./moves"

type Answering = {
  /** Whether a command is on its way; what acts waits for it. A Question
   * is answered on the composer (ADR 0058, decision 6). */
  answering: boolean
}

export function Transcript({
  forYou,
  finding,
  state,
  waits,
  name,
  queue,
  writers,
  answering,
  moves,
}: Answering & {
  writers: Listing
  /** The Thread waits for its Person: a Question, or a plan. */
  forYou: boolean
  /** What the Person looks for in it, if anything. */
  finding: string
  state: ThreadState
  /** The messages that wait, from {@link waiting}. */
  waits: Waiting[]
  name: string
  queue: QueueActions
  /** Where the Thread may move, for a limit's card. */
  moves?: Moves
}) {
  const { thread, reader, acts } = useThreadAround()
  // Its Later, to put it off until a usage limit's reset (ADR 0074).
  const later = writers.own?.later
  const turn = working(state)
  const lines = useMemo(() => timeline(state), [state])
  const asks = useMemo(() => awaiting(state), [state])
  const thoughts = useMemo(() => thoughtTimes(state), [state])
  const last = state.items.at(-1)
  const turns = useMemo(
    () => new Map(state.turns.map((one) => [one.id, one])),
    [state.turns]
  )
  // What the Thread knows that its lines show (ADR 0091, decision 3).
  const turnState = (id: string | undefined) =>
    id === undefined ? undefined : turns.get(id)?.state
  const facts: LineFacts = {
    of: (item) => ({
      turn: turnState(item.turn),
      asks: asks.has(item.id),
      took: thoughts.get(item.id),
      live: turn?.state === "running" && item === last,
      writer: writerOf(writers, item),
      forks: forkAt(turns, item),
      edits: editAt(state.turns, item),
    }),
    turnState,
    finding,
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
          aria-label={`Thread with ${name}`}
        >
          <MessageScrollerContent
            data-chat
            className="mx-auto w-full max-w-3xl gap-5 px-(--chat-gutter) pt-4 pb-6"
          >
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
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <ScrollToEnd queued={waits.length} forYou={forYou} />
        <Minimap messages={messages} />
        <ScrollPlace thread={thread} viewport={viewport} last={last?.id} />
      </MessageScroller>
    </MessageScrollerProvider>
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
      className="gap-1.5 rounded-full border-transparent bg-popover px-3 text-xs text-popover-foreground shadow-md ring-1 ring-foreground/10 hover:bg-accent data-[size=icon-sm]:px-0"
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

/** A reply's turn, to fork the Thread at its end; null while it may not. */
function forkAt(turns: Map<string, TurnView>, item: Item) {
  const its = item.turn === undefined ? undefined : turns.get(item.turn)
  return its && (its.can.fork ? its : null)
}

/** The turn that ran a Person's message first, to edit it from; null while
 * it may not. */
function editAt(turns: TurnView[], item: Item) {
  if (item.author.kind !== "person") return undefined
  const its = firstTurnOf(turns, item.id)
  return its && (its.can.rewind ? its : null)
}
