import { useEffect, useMemo, useState } from "react"
import type { Engine, SpaceId } from "@bandaso/contract"
import type {
  Defaults,
  Failure,
  Item,
  ItemId,
  Offer,
  Settings,
  ThreadId,
  Sent,
  TurnView,
  Image,
} from "@bandaso/contract/agents"
import { Button } from "@bandaso/ui/components/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@bandaso/ui/components/empty"
import { Markdown } from "@bandaso/ui/components/markdown"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@bandaso/ui/components/message-scroller"
import { Spinner } from "@bandaso/ui/components/spinner"
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@bandaso/ui/components/trace"
import { useAct } from "@bandaso/ui/hooks/use-act"
import { useInFront } from "@bandaso/ui/hooks/use-in-front"
import { clock } from "@bandaso/ui/lib/words"
import { READ_AGAIN, type Source, useLive } from "@bandaso/ui/hooks/use-live"
import { definePane, paneOf, type PaneProps } from "@bandaso/ui/pane"
import {
  BotIcon,
  BrainIcon,
  CircleAlertIcon,
  CircleSlashIcon,
  InfoIcon,
  MessageSquareIcon,
  RotateCcwIcon,
} from "lucide-react"
import { settledTurn } from "./marks"
import { markSeen } from "./seen"
import {
  asked,
  declineOnce,
  NO_OFFER,
  proposedPlan,
  retryable,
  sent,
  steerable,
  type ThreadState,
  waiting,
  type Waiting,
  working,
} from "./thread"
import { suggested } from "./slash"
import { type Attached, type Attaching, useAttachments } from "./Attachments"
import { Composer } from "./Composer"
import { type ImageReader, useImageReader } from "./MessageImages"
import { AgentMessage, PersonMessage } from "./Messages"
import type { Values } from "./form"
import { Question, QuestionDrawer } from "./Questions"
import { ChangedFiles } from "./ChangedFiles"
import { diffPane } from "./DiffPane"
import { Plan } from "./Plan"
import { PlanReady, ProposedPlan } from "./ProposedPlan"
import { planTitle } from "./messages"
import { type Line, timeline } from "./timeline"
import { Fold, key, WorkLine, Working } from "./Work"
import { Queue, type QueueActions } from "./Queue"
import { ToolCall } from "./ToolCall"
import { SettingsBar } from "./ThreadSettings"
import { SignIn, Warning } from "./SignIn"
import { harnessName, useHarnesses } from "./harnesses"
import { useThread } from "./live-thread"
import { NewThreadBar } from "./NewThread"

/**
 * One Thread: a session with a Harness in a Space (ADR 0006). Without
 * `thread`, the next message starts one on `harness`, or on this computer's
 * first Harness when it names none. `title` keeps the header's words while
 * the Thread loads.
 */
export type ThreadArgs = {
  thread: ThreadId | null
  harness: string
  title: string
}

/** A Thread not yet started, on this computer's first Harness. */
export const NEW_THREAD: ThreadArgs = { thread: null, harness: "", title: "" }

export const threadPane = definePane<ThreadArgs>({
  kind: "agents.thread",
  module: "agents",
  title: (args) => args.title || "New Thread",
  shows: (args) => args.thread,
  icon: MessageSquareIcon,
  start: NEW_THREAD,
  Pane: ThreadPane,
})

function ThreadPane({
  engine,
  space,
  args,
  focused,
  open,
  update,
}: PaneProps<ThreadArgs>) {
  const { thread } = args
  const live = useThread(engine, space, thread)
  const state = live.state === "ready" ? live.view : undefined
  const turn = state && working(state)
  const sending = useAct()
  const acting = useAct()
  const reader = useImageReader(engine, space)
  const harnesses = useHarnesses(engine, space)
  const harness =
    thread === null
      ? args.harness || harnesses[0]?.id || ""
      : (state?.harness ?? args.harness)
  const name = harnessName(harnesses, harness) || "the Agent"

  // The header follows the Thread: its title, once the first message gives
  // it one, and its Harness come back with the Pane.
  useEffect(() => {
    if (
      thread !== null &&
      state &&
      (state.title !== args.title || state.harness !== args.harness)
    )
      update({ thread, harness: state.harness, title: state.title })
  }, [thread, state, args.title, args.harness, update])

  // A Person who looks at the Thread, its Pane focused in the window in
  // front, sees how its latest turn ended, which settles its mark in the
  // sidebar and the bar (ADR 0011, decision 1).
  const front = useInFront()
  const settled = state && settledTurn(state.turns)
  useEffect(() => {
    if (focused && front && thread !== null && settled)
      markSeen(thread, settled)
  }, [focused, front, thread, settled])

  // A Thread not yet started keeps its settings here until its first
  // message, starting from its Harness's.
  const defaults = useHarnessDefaults(
    engine,
    space,
    thread === null && harness !== "" ? harness : null
  )
  const [drafts, setDrafts] = useState<Record<string, Settings>>({})
  const draft = drafts[harness]
  const setDraft = (next: Settings) =>
    setDrafts((drafts) => ({ ...drafts, [harness]: next }))
  const settings =
    thread === null ? (draft ?? defaults?.settings) : state?.settings
  const offer: Offer =
    (thread === null ? defaults?.offer : state?.offer) ?? NO_OFFER
  const configure = (next: Settings) => {
    if (thread === null) {
      setDraft(next)
      return
    }
    void acting.act(() =>
      engine.command("agents.configure", { thread, settings: next }, space)
    )
  }

  const images = useAttachments({
    attach: (image: Attaching) =>
      engine.command<Image>("agents.attach", image, space),
    closed: offer.no_images ? `${name} does not take images.` : undefined,
  })
  const [dropping, setDropping] = useState(false)
  // The waiting message open to edit, from its Edit or ↑ in the composer.
  const [editing, setEditing] = useState<ItemId>()
  const waits = state ? waiting(state) : []
  const last = waits.at(-1)
  // The Question the Agent waits on: one with a form opens on the composer,
  // and a message sent while any waits says no to it first, as in T3 Code.
  const asking = state && asked(state)
  // A plan the Agent proposed waits for Implement, or for a message that
  // refines it.
  const planned = state && proposedPlan(state)
  /** Sends `text`; an existing Thread changes to `next` first, if given. */
  const send = async (
    text: string,
    images: Attached[],
    steer: boolean,
    next?: Settings
  ) => {
    const no = asking && declineOnce(asking.body)
    if (no && text && (await answer(asking.id, no)) === undefined) return false
    for (const { image, url } of images) reader.remember(image.id, url)
    const sent = await sending.act(() =>
      engine.command<Sent>(
        "agents.send",
        // A new Thread starts as its composer shows; an existing one runs
        // with its own settings, which the bar changes as it goes.
        {
          ...(thread === null ? { harness } : { thread }),
          text,
          images: images.map(({ image }) => image.id),
          settings: thread === null ? (settings ?? null) : (next ?? null),
          steer,
        },
        space
      )
    )
    if (sent && thread === null)
      update({ thread: sent.thread, harness, title: args.title })
    return sent !== undefined
  }
  // A turn's changes open in a Diff Pane beside the Thread, or in the one
  // already open, which then shows them.
  const openDiff = (turn: string, path?: string) => {
    if (thread === null) return
    const title = state?.title ?? args.title
    open(paneOf(diffPane, { thread, turn, path: path ?? null, title }), "right")
  }
  // Implement turns plan mode off and asks for the plan, in one command.
  const implement = () => {
    if (settings) void send(IMPLEMENT, [], false, { ...settings, plan: false })
  }
  const stop = (turn: TurnView) =>
    void acting.act(() =>
      engine.command("agents.stop", { turn: turn.id }, space)
    )
  const answer = (item: ItemId, choice: string, values?: Values) =>
    acting.act(() =>
      engine.command(
        "agents.answer",
        { item, choice, ...(values && { values }) },
        space
      )
    )
  const retry = (turn: TurnView) =>
    void acting.act(() =>
      engine.command("agents.retry", { turn: turn.id }, space)
    )
  const queue: QueueActions = {
    onSendNow: ({ turn }) =>
      void acting.act(() =>
        engine.command("agents.steer", { turn: turn.id }, space)
      ),
    onEdit: async ({ turn }, text) =>
      (await acting.act(() =>
        engine.command("agents.edit", { turn: turn.id, text }, space)
      )) !== undefined,
    onRemove: ({ turn }) =>
      void acting.act(() =>
        engine.command("agents.withdraw", { turn: turn.id }, space)
      ),
    editing,
    onEditing: setEditing,
    onContinue: () => {
      if (thread === null) return
      void acting.act(() => engine.command("agents.resume", { thread }, space))
    },
  }

  return (
    // Images dropped anywhere on the Pane join the message.
    <div
      className="flex h-full min-h-0 flex-col"
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
        images.add([...event.dataTransfer.files])
      }}
    >
      <div className="min-h-0 flex-1">
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
            state={live.view}
            waits={waits}
            name={name}
            reader={reader}
            answering={acting.busy}
            onAnswer={answer}
            onRetry={retry}
            onOpenDiff={openDiff}
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
        {(sending.problem ?? acting.problem) && (
          <p role="alert" className="px-1 text-xs text-destructive">
            {sending.problem ?? acting.problem}
          </p>
        )}
        {planned && (
          <PlanReady
            title={planTitle(planned.body.text)}
            busy={sending.busy}
            onImplement={implement}
          />
        )}
        {asking?.body.form && (
          <QuestionDrawer
            item={asking}
            answering={acting.busy}
            onAnswer={(choice, values) => answer(asking.id, choice, values)}
          />
        )}
        <Composer
          name={name}
          thread={thread}
          history={() => (state ? sent(state) : [])}
          placeholder={
            asking
              ? `Send a message to say no and tell ${name} what to do instead`
              : planned
                ? "Write to refine the plan, or implement it"
                : undefined
          }
          plan={offer.plans ? settings?.plan : undefined}
          focused={focused}
          busy={sending.busy}
          working={turn}
          steering={state !== undefined && steerable(state)}
          usage={state?.usage}
          commands={suggested(offer)}
          images={images}
          dropping={dropping}
          onPlanMode={(plan) => settings && configure({ ...settings, plan })}
          onEditLast={last && (() => setEditing(last.item.id))}
          onSend={send}
          onStop={stop}
        >
          {thread === null && (
            <NewThreadBar
              engine={engine}
              space={space}
              harness={harness}
              harnesses={harnesses}
              disabled={sending.busy}
              onSpace={(other) =>
                open(paneOf(threadPane, { ...args, harness }), "here", other)
              }
              onHarness={(next) => update({ ...args, harness: next })}
            />
          )}
          {settings && (
            <SettingsBar
              settings={settings}
              offer={offer}
              disabled={acting.busy}
              onChange={configure}
            />
          )}
        </Composer>
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

/** The facts that say a Harness offers something new. */
const OFFERED = { module: "agents", kinds: ["thread.offered"] }

/**
 * What a new Thread on `harness` starts with: full access, and what the
 * Harness last offered, such as its models.
 */
function useHarnessDefaults(
  engine: Engine,
  space: SpaceId,
  harness: string | null
): Defaults | undefined {
  const source = useMemo<Source<Defaults> | null>(
    () =>
      harness === null
        ? null
        : {
            read: () =>
              engine.call<Defaults>("agents.defaults", { harness }, { space }),
            filter: OFFERED,
            apply: () => READ_AGAIN,
          },
    [engine, space, harness]
  )
  const live = useLive(engine, space, source)
  return live.state === "ready" ? live.view : undefined
}

type Answering = {
  /** Whether an answer is on its way; the choices wait for it. */
  answering: boolean
  onAnswer: (item: ItemId, choice: string, values?: Values) => void
}

function Transcript({
  state,
  waits,
  name,
  reader,
  onRetry,
  onOpenDiff,
  signIn,
  queue,
  ...answers
}: Answering & {
  state: ThreadState
  /** The messages that wait, from {@link waiting}. */
  waits: Waiting[]
  name: string
  reader: ImageReader
  onRetry: (turn: TurnView) => void
  onOpenDiff: OpenDiff
  /** How a Person signs in again, below a turn that failed for that. */
  signIn: (turn: TurnView) => React.ReactNode
  queue: QueueActions
}) {
  const turn = working(state)
  const lines = useMemo(() => timeline(state), [state])
  const last = state.items.at(-1)
  const render = (line: Line): React.ReactNode => {
    switch (line.kind) {
      case "item":
        return (
          <Entry
            item={line.item}
            live={turn?.state === "running" && line.item === last}
            reader={reader}
            onOpenDiff={onOpenDiff}
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
        return <WorkLine items={line.items} live={line.live} render={render} />
      case "fold":
        return <Fold turn={line.turn} lines={line.lines} render={render} />
      case "working":
        return <Working turn={line.turn} name={name} />
      case "ended":
        return (
          <Ended
            turn={line.turn}
            busy={answers.answering}
            onRetry={
              retryable(state, line.turn) ? () => onRetry(line.turn) : undefined
            }
            signIn={signIn}
          />
        )
    }
  }
  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="end">
      <MessageScroller>
        <MessageScrollerViewport aria-label={`Thread with ${name}`}>
          <MessageScrollerContent className="mx-auto w-full max-w-3xl gap-4 px-4 pt-4 pb-2">
            {lines.map((line) => (
              <MessageScrollerItem
                key={key(line)}
                messageId={line.kind === "item" ? line.item.id : undefined}
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
                  {...queue}
                />
              </MessageScrollerItem>
            )}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}

/** Opens the changes of a turn, on one file if `path` names it. */
type OpenDiff = (turn: string, path?: string) => void

function Entry({
  item,
  live,
  reader,
  onOpenDiff,
  answering,
  onAnswer,
}: Answering & {
  item: Item
  /** Whether the Agent is still writing it. */
  live: boolean
  reader: ImageReader
  onOpenDiff: OpenDiff
}) {
  const body = item.body
  switch (body.kind) {
    case "message":
      return item.author.kind === "person" ? (
        <PersonMessage
          text={body.text}
          images={body.images}
          at={item.at}
          reader={reader}
        />
      ) : (
        <AgentMessage text={body.text} at={item.at} live={live} />
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

/** What Implement asks the Agent, once plan mode is off. */
const IMPLEMENT = "Implement the plan."
