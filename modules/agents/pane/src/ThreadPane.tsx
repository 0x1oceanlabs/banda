import { useMemo, useRef, useState } from "react"
import type { Engine, SpaceId } from "@banda/contract"
import type {
  Failure,
  Item,
  ItemId,
  ListedThread,
  TurnView,
} from "@banda/contract/agents"
import { Button } from "@banda/ui/components/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@banda/ui/components/empty"
import { Markdown } from "@banda/ui/components/markdown"
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
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@banda/ui/components/trace"
import { useLive } from "@banda/ui/hooks/use-live"
import { clock } from "@banda/ui/lib/words"
import { definePane, paneOf, type PaneProps } from "@banda/ui/pane"
import {
  ArrowDownIcon,
  BotIcon,
  BrainIcon,
  CircleAlertIcon,
  CircleSlashIcon,
  InfoIcon,
  MessageSquareIcon,
  RotateCcwIcon,
} from "lucide-react"
import {
  firstTurnOf,
  type Listing,
  steerable,
  threadOf,
  type ThreadState,
  type Waiting,
  working,
  writerOf,
} from "./thread"
import { applyThreads, threadsSource } from "./list"
import { threadPaneOf } from "./rows"
import { suggested } from "./slash"
import { Composer, type ComposerHandle } from "./Composer"
import type { ImageReader } from "./MessageImages"
import { AgentMessage, PersonMessage, Writer, type Writers } from "./Messages"
import { QuoteSelection } from "./Quote"
import type { Values } from "./form"
import { Question, QuestionDrawer } from "./Questions"
import { ChangedFiles } from "./ChangedFiles"
import { Plan } from "./Plan"
import { PlanReady, ProposedPlan } from "./ProposedPlan"
import { planTitle } from "./messages"
import { type Line, timeline } from "./timeline"
import { Fold, key, WorkLine, Working } from "./Work"
import { Queue, type QueueActions } from "./Queue"
import { ScrollPlace } from "./ScrollPlace"
import { FindBar, useFound } from "./Find"
import { holds } from "./find"
import { Minimap } from "./Minimap"
import { ToolCall } from "./ToolCall"
import { SettingsMenu } from "./ThreadSettings"
import { SignIn, Warning } from "./SignIn"
import { NewThreadBar } from "./NewThread"
import { NEW_THREAD, type ThreadArgs, useThreadSession } from "./session"

export const threadPane = definePane<ThreadArgs>({
  kind: "agents.thread",
  title: (args) => args.title || "New Thread",
  shows: (args) => args.thread,
  icon: MessageSquareIcon,
  start: NEW_THREAD,
  // A Thread starts with its Harness.
  letter: "H",
  Pane: ThreadPane,
})

function ThreadPane(props: PaneProps<ThreadArgs>) {
  const { engine, space, args, focused, open, update, run } = props
  const { thread } = args
  const {
    live,
    state,
    turn,
    harness,
    harnesses,
    name,
    reader,
    sending,
    acting,
    problem,
    settings,
    offer,
    configure,
    plan,
    setPlan,
    history,
    steering,
    images,
    findFiles,
    keep,
    waits,
    asking,
    planned,
    send,
    implement,
    answer,
    openDiff,
    stop,
    retry,
    fork,
    rewind,
    queue,
    editLast,
  } = useThreadSession(props)
  const [dropping, setDropping] = useState(false)
  // What the Person looks for in the Thread, while the find bar is open.
  const [find, setFind] = useState<{ query: string; at: number }>()
  const area = useRef<HTMLDivElement>(null)
  const composer = useRef<ComposerHandle>(null)
  const findField = useRef<HTMLInputElement>(null)
  const writers = useWriters(engine, space, thread)
  const found = useFound(area, find?.query ?? "", find?.at ?? 0, state)

  return (
    // Files dropped anywhere on the Pane join the message; Mod+F finds in
    // it, as in T3 Code.
    <div
      className="flex h-full min-h-0 flex-col"
      onKeyDown={(event) => {
        const mod = event.ctrlKey || event.metaKey
        // By the key's place, as the window's keys, on any layout.
        if (!mod || event.altKey || event.shiftKey || event.code !== "KeyF")
          return
        event.preventDefault()
        setFind((now) => now ?? { query: "", at: 0 })
        findField.current?.select()
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return
        event.preventDefault()
        setDropping(true)
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setDropping(false)
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return
        event.preventDefault()
        setDropping(false)
        composer.current?.take([...event.dataTransfer.files])
      }}
    >
      <div ref={area} className="relative min-h-0 flex-1">
        <QuoteSelection
          area={area}
          onQuote={(quote) => composer.current?.quote(quote)}
        />
        {find && (
          <FindBar
            field={findField}
            query={find.query}
            found={found}
            onQuery={(query) => setFind({ ...find, query, at: 0 })}
            onStep={(by) => setFind({ ...find, at: found.current + by })}
            onClose={() => setFind(undefined)}
          />
        )}
        {thread === null ? (
          <Start name={name} />
        ) : live.state === "loading" ? (
          <Centered>
            <Spinner />
          </Centered>
        ) : live.state === "refused" ? (
          <Centered>
            <p className="text-sm text-muted-foreground">
              {live.refusal.message}
            </p>
          </Centered>
        ) : (
          <Transcript
            // Each Thread scrolls on its own, from where it was left.
            key={thread}
            thread={thread}
            forYou={Boolean(asking || planned)}
            finding={find?.query ?? ""}
            state={live.view}
            waits={waits}
            name={name}
            reader={reader}
            answering={acting}
            onAnswer={answer}
            onRetry={retry}
            onFork={fork}
            onRewind={(turn, message) =>
              void rewind(turn).then((back) => {
                if (back && message.body.kind === "message")
                  composer.current?.putBack(
                    message.body.text,
                    message.body.images
                  )
              })
            }
            onOpenDiff={openDiff}
            writers={writers}
            onOpenThread={(other) => open(threadPaneOf(other), "right")}
            signIn={(turn) => (
              <SignIn
                engine={engine}
                space={space}
                harness={harness}
                turn={turn.id}
                open={open}
                onSignedIn={() => retry(turn)}
              />
            )}
            queue={queue}
          />
        )}
      </div>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-1.5 px-4 pb-4">
        {offer.outdated && (
          <div className="px-1">
            <Warning>{offer.outdated}</Warning>
          </div>
        )}
        {problem && (
          <p role="alert" className="px-1 text-xs text-destructive">
            {problem}
          </p>
        )}
        {planned && (
          <PlanReady
            title={planTitle(planned.body.text)}
            busy={sending}
            onImplement={implement}
          />
        )}
        {asking?.body.form && (
          <QuestionDrawer
            item={asking}
            answering={acting}
            onAnswer={(choice, values) => answer(asking.id, choice, values)}
          />
        )}
        <Composer
          ref={composer}
          name={name}
          thread={thread}
          history={history}
          placeholder={
            asking
              ? `${asking.body.form ? "Answer above, or write" : "Send a message"} to say no and tell ${name} what to do instead`
              : planned
                ? "Write to refine the plan, or implement it"
                : undefined
          }
          plan={plan}
          focused={focused}
          busy={sending}
          working={turn}
          steering={steering}
          usage={state?.usage}
          commands={suggested(offer)}
          skills={offer.skills}
          images={images}
          dropping={dropping}
          onPlanMode={setPlan}
          onEditLast={editLast}
          findFiles={findFiles}
          keep={keep}
          onSend={send}
          onStop={stop}
        >
          {settings && (
            <SettingsMenu
              settings={settings}
              offer={offer}
              disabled={acting}
              onChange={configure}
            />
          )}
        </Composer>
        {/* A new Thread's Space and Harness, bare under the card. */}
        {thread === null && (
          <NewThreadBar
            engine={engine}
            space={space}
            harness={harness}
            harnesses={harnesses}
            disabled={sending}
            onSpace={(other) =>
              open(paneOf(threadPane, { ...args, harness }), "here", other)
            }
            onHarness={(next) => update({ ...args, harness: next })}
            onAddSpace={run && (() => run("space.add"))}
          />
        )}
      </div>
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      {children}
    </div>
  )
}

function Start({ name }: { name: string }) {
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <BotIcon />
        </EmptyMedia>
        <EmptyTitle>Write to {name}</EmptyTitle>
        <EmptyDescription>
          Say what you need. {name} answers here, and asks you before it does
          anything that needs your yes.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

type Answering = {
  /** Whether an answer is on its way; the choices wait for it. */
  answering: boolean
  onAnswer: (item: ItemId, choice: string, values?: Values) => void
}

function Transcript({
  thread,
  forYou,
  finding,
  state,
  waits,
  name,
  reader,
  onRetry,
  onFork,
  onRewind,
  onOpenDiff,
  signIn,
  queue,
  writers,
  onOpenThread,
  ...answers
}: Answering &
  Writers & {
    thread: string
    /** The Thread waits for its Person: a Question, or a plan. */
    forYou: boolean
    /** What the Person looks for in it, if anything. */
    finding: string
    state: ThreadState
    /** The messages that wait, from {@link waiting}. */
    waits: Waiting[]
    name: string
    reader: ImageReader
    onRetry: (turn: TurnView) => void
    onFork: (turn: TurnView) => void
    /** Takes the Thread back to before `message`, which `turn` ran first. */
    onRewind: (turn: TurnView, message: Item) => void
    onOpenDiff: OpenDiff
    /** How a Person signs in again, below a turn that failed for that. */
    signIn: (turn: TurnView) => React.ReactNode
    queue: QueueActions
  }) {
  const turn = working(state)
  const lines = useMemo(() => timeline(state), [state])
  const last = state.items.at(-1)
  const turns = useMemo(
    () => new Map(state.turns.map((one) => [one.id, one])),
    [state.turns]
  )
  // A reply forks its Thread at the end of its turn, once it may.
  const forkAt = (item: Item) => {
    const its = item.turn === undefined ? undefined : turns.get(item.turn)
    return its && (its.can.fork ? () => onFork(its) : null)
  }
  // A Person's message is edited from the turn that ran it first.
  const editAt = (item: Item) => {
    if (item.author.kind !== "person") return undefined
    const its = firstTurnOf(state.turns, item.id)
    return its && (its.can.rewind ? () => onRewind(its, item) : null)
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
            live={turn?.state === "running" && line.item === last}
            reader={reader}
            onOpenDiff={onOpenDiff}
            writer={writerOf(writers, line.item)}
            onOpenThread={onOpenThread}
            {...answers}
          />
        )
      case "plan":
        return <ProposedPlan text={line.item.body.text} />
      case "changes":
        return (
          <ChangedFiles
            files={line.files}
            onOpen={(path) => onOpenDiff(line.turn.id, path)}
          />
        )
      case "work":
        return (
          <WorkLine
            items={line.items}
            live={line.live}
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
        return <Working turn={line.turn} name={name} />
      case "ended":
        return (
          <Ended
            turn={line.turn}
            busy={answers.answering}
            onRetry={line.turn.can.retry ? () => onRetry(line.turn) : undefined}
            signIn={signIn}
          />
        )
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
          <MessageScrollerContent className="mx-auto w-full max-w-3xl gap-4 px-4 pt-4 pb-2">
            {forkedFrom && (
              <MessageScrollerItem key="forked-from">
                <Writer
                  thread={forkedFrom}
                  says="Forked from"
                  onOpen={onOpenThread}
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
              >
                {render(line)}
              </MessageScrollerItem>
            ))}
            {turn?.state === "queued" && (
              <MessageScrollerItem key="getting-ready">
                <Trace>
                  <TraceLine status="running">
                    <TraceIcon>
                      <Spinner />
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
                  busy={answers.answering}
                  reader={reader}
                  writers={writers}
                  onOpenThread={onOpenThread}
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

/** The button to the end of the Thread, once it is scrolled up: it says
 * what waits there, as T3 Code's does. */
function ScrollToEnd({ queued, forYou }: { queued: number; forYou: boolean }) {
  const below = [
    queued > 0 && `${queued} queued`,
    forYou && "waiting for you",
  ].filter((said) => said !== false)
  return (
    <MessageScrollerButton
      size={below.length > 0 ? "sm" : "icon-sm"}
      className="rounded-full shadow-sm"
    >
      <ArrowDownIcon />
      <span className={below.length === 0 ? "sr-only" : undefined}>
        {["Scroll to end", ...below].join(" · ")}
      </span>
    </MessageScrollerButton>
  )
}

/** Opens the changes of a turn, on one file if `path` names it. */
type OpenDiff = (turn: string, path?: string) => void

function Entry({
  item,
  live,
  reader,
  onOpenDiff,
  writer,
  onOpenThread,
  onFork,
  onEdit,
  answering,
  onAnswer,
}: Answering & {
  item: Item
  /** From {@link AgentMessage}'s `onFork`. */
  onFork?: (() => void) | null
  /** From {@link PersonMessage}'s `onEdit`. */
  onEdit?: (() => void) | null
  /** Whether the Agent is still writing it. */
  live: boolean
  reader: ImageReader
  onOpenDiff: OpenDiff
  /** The other Thread whose Agent wrote it, if one did. */
  writer?: ListedThread | "gone"
  onOpenThread: Writers["onOpenThread"]
}) {
  const body = item.body
  switch (body.kind) {
    case "message":
      return item.author.kind === "person" ? (
        <PersonMessage
          onEdit={onEdit}
          text={body.text}
          images={body.images}
          at={item.at}
          reader={reader}
        />
      ) : (
        <AgentMessage
          text={body.text}
          at={item.at}
          live={live}
          onFork={onFork}
          from={
            writer && (
              <Writer
                thread={writer}
                answers={body.answers}
                onOpen={onOpenThread}
              />
            )
          }
        />
      )
    case "thought":
      return (
        <Trace>
          <TraceCollapsible>
            <TraceCollapsibleTrigger>
              <TraceLine status={live ? "running" : undefined}>
                <TraceIcon>
                  <BrainIcon />
                </TraceIcon>
                <TraceTitle>{live ? "Thinking" : "Thought"}</TraceTitle>
              </TraceLine>
            </TraceCollapsibleTrigger>
            <TraceCollapsibleContent>
              <Markdown streaming={live} className="text-muted-foreground">
                {body.text}
              </Markdown>
            </TraceCollapsibleContent>
          </TraceCollapsible>
        </Trace>
      )
    case "tool": {
      // A call that failed changed nothing the turn's changes show.
      const turn = body.status !== "failed" ? item.turn : undefined
      return (
        <ToolCall
          tool={body}
          onOpenDiff={
            turn === undefined ? undefined : (path) => onOpenDiff(turn, path)
          }
        />
      )
    }
    case "plan":
      return <Plan steps={body.steps} />
    case "question":
      return (
        <Question
          question={body}
          answering={answering}
          onAnswer={(choice, values) => onAnswer(item.id, choice, values)}
        />
      )
    case "notice":
      return (
        <Trace>
          <TraceLine>
            <TraceIcon>
              <InfoIcon />
            </TraceIcon>
            <TraceTitle className="whitespace-normal">{body.text}</TraceTitle>
          </TraceLine>
        </Trace>
      )
  }
}

/** A turn that did not finish: why, what to do about it, and Try again
 * when its message can be sent again. One that failed because its Person
 * must sign in offers the ways to, while it can go again. */
function Ended({
  turn,
  busy,
  onRetry,
  signIn,
}: {
  turn: TurnView
  busy: boolean
  onRetry?: () => void
  signIn: (turn: TurnView) => React.ReactNode
}) {
  const failed = turn.state === "failed"
  const signsIn = turn.failure?.class === "sign_in" && onRetry !== undefined
  const advice = !signsIn && turn.failure && adviceFor(turn.failure)
  return (
    <Trace>
      <TraceLine status={failed ? "error" : undefined}>
        <TraceIcon>
          {turn.state === "stopped" ? <CircleSlashIcon /> : <CircleAlertIcon />}
        </TraceIcon>
        <TraceTitle className="whitespace-normal">
          {turn.reason ?? (failed ? "This turn failed." : "Stopped.")}
        </TraceTitle>
      </TraceLine>
      {(advice || onRetry) && (
        <div className="flex flex-wrap items-center gap-2 pl-6">
          {advice && (
            <span className="text-xs text-muted-foreground">{advice}</span>
          )}
          {onRetry && (
            <Button
              variant="outline"
              size="xs"
              disabled={busy}
              onClick={onRetry}
            >
              <RotateCcwIcon data-icon="inline-start" />
              Try again
            </Button>
          )}
        </div>
      )}
      {signsIn && <div className="pl-6">{signIn(turn)}</div>}
    </Trace>
  )
}

/** What a Person can do about a failure, beyond trying again. */
function adviceFor(failure: Failure): string | undefined {
  switch (failure.class) {
    case "sign_in":
      return "Sign in from a terminal, then try again."
    case "usage_limit":
      return failure.until === undefined
        ? undefined
        : `You can try again after ${clock(failure.until)}.`
    case "harness_stopped":
    case "provider":
      return undefined
  }
}

/** The Space's other Threads by their Agents' IDs, as the sidebar follows
 * them, so a message from one names it as it is now; and this Thread's own
 * Agent, so a message from one the list no longer has still says so. */
function useWriters(
  engine: Engine,
  space: SpaceId,
  thread: string | null
): Listing {
  // Who writes stays as a rewind leaves it: no need to read the list again.
  const source = useMemo(
    () => ({ ...threadsSource(engine, space), apply: applyThreads }),
    [engine, space]
  )
  const live = useLive(engine, space, source)
  const threads = live.state === "ready" ? live.view.threads : undefined
  return useMemo(() => {
    const listing: { threads: Map<string, ListedThread>; self?: string } = {
      threads: new Map(),
    }
    for (const one of threads ?? []) {
      if (one.id === thread) listing.self = one.agent
      else listing.threads.set(one.agent, one)
    }
    return listing
  }, [threads, thread])
}
