/** A Thread's transcript: its entries and lines, in the scroller that
 * follows the live edge (ADR 0058, ADR 0091). */
import { useMemo, useRef } from "react"
import type { Item } from "@banda/contract/agents"
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
} from "../thread"
import { Writer } from "../Messages"
import { ChangedFiles } from "../ChangedFiles"
import { ProposedPlan } from "../ProposedPlan"
import { awaiting, type Line, thoughtTimes, timeline } from "../timeline"
import { Fold, key, WorkLine, Working } from "../Work"
import { Queue, type QueueActions } from "../Queue"
import { ScrollPlace } from "../ScrollPlace"
import { holds } from "../findIn"
import { Minimap } from "../Minimap"
import { Ended } from "./Ended"
import { Entry } from "./Entry"
import { useThreadAround } from "./context"

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
}) {
  const { thread, reader, acts } = useThreadAround()
  // Its snooze, to snooze it until a usage limit's reset (ADR 0074).
  const snooze = writers.own?.snooze
  const turn = working(state)
  const lines = useMemo(() => timeline(state), [state])
  const asks = useMemo(() => awaiting(state), [state])
  const thoughts = useMemo(() => thoughtTimes(state), [state])
  const last = state.items.at(-1)
  const turns = useMemo(
    () => new Map(state.turns.map((one) => [one.id, one])),
    [state.turns]
  )
  // A reply forks its Thread at the end of its turn, once it may.
  const forkAt = (item: Item) => {
    const its = item.turn === undefined ? undefined : turns.get(item.turn)
    return its && (its.can.fork ? () => acts.fork(its) : null)
  }
  // A Person's message is edited from the turn that ran it first.
  const editAt = (item: Item) => {
    if (item.author.kind !== "person") return undefined
    const its = firstTurnOf(state.turns, item.id)
    return its && (its.can.rewind ? () => acts.rewind(its, item) : null)
  }
  const forkedFrom = useMemo(
    () => state.forkedFrom && threadOf(writers, state.forkedFrom),
    [writers, state.forkedFrom]
  )
  const render = (line: Line): React.ReactNode => {
    switch (line.kind) {
      case "item":
        return (
          <Entry
            item={line.item}
            onFork={forkAt(line.item)}
            onEdit={editAt(line.item)}
            turn={line.item.turn ? turns.get(line.item.turn)?.state : undefined}
            asks={asks.has(line.item.id)}
            took={thoughts.get(line.item.id)}
            live={turn?.state === "running" && line.item === last}
            writer={writerOf(writers, line.item)}
          />
        )
      case "plan":
        return <ProposedPlan text={line.item.body.text} />
      case "changes":
        return (
          <ChangedFiles
            files={line.files}
            onOpen={(path) => acts.openDiff(line.turn.id, path)}
          />
        )
      case "work":
        return (
          <WorkLine
            items={line.items}
            turn={line.turn ? turns.get(line.turn)?.state : undefined}
            found={holds(line, finding)}
            render={render}
          />
        )
      case "fold":
        return (
          <Fold
            turn={line.turn}
            lines={line.lines}
            found={holds(line, finding)}
            render={render}
          />
        )
      case "working":
        return <Working turn={line.turn} name={name} doing={line.doing} />
      case "ended":
        return <Ended turn={line.turn} busy={answering} snooze={snooze} />
    }
  }
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
    <MessageScrollerProvider autoScroll defaultScrollPosition="end">
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
                // the next row: room of its own, so they paint there.
                className={
                  line.kind === "item" && line.item.body.kind === "message"
                    ? "-mb-6 pb-6"
                    : undefined
                }
              >
                {render(line)}
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
        <ScrollPlace thread={thread} viewport={viewport} />
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
