import { useEffect, useMemo, useRef, useState } from "react"
import type { AgentId } from "@bandaso/contract"
import type {
  Body,
  Failure,
  Item,
  ItemId,
  ThreadId,
  Sent,
  ThreadView,
  ToolKind,
  ToolStatus,
  TurnView,
} from "@bandaso/contract/agents"
import { Bubble, BubbleContent } from "@bandaso/ui/components/bubble"
import { Button } from "@bandaso/ui/components/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@bandaso/ui/components/empty"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@bandaso/ui/components/input-group"
import { Message, MessageContent } from "@bandaso/ui/components/message"
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
import { useLive } from "@bandaso/ui/hooks/use-live"
import { definePane, type PaneProps } from "@bandaso/ui/pane"
import {
  ArrowUpIcon,
  BotIcon,
  BrainIcon,
  CircleAlertIcon,
  CircleSlashIcon,
  FilePenIcon,
  FileTextIcon,
  GlobeIcon,
  InfoIcon,
  MessageSquareIcon,
  MoveRightIcon,
  RotateCcwIcon,
  SearchIcon,
  ShieldQuestionIcon,
  SquareIcon,
  TerminalIcon,
  Trash2Icon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react"
import {
  apply,
  fromView,
  retryable,
  rows,
  type ThreadState,
  working,
} from "./thread"

/** One Thread with an Agent; without `thread`, the next message starts one. */
export type ThreadArgs = {
  agent: AgentId
  name: string
  thread: ThreadId | null
}

export const threadPane = definePane<ThreadArgs>({
  kind: "agents.thread",
  module: "agents",
  title: (args) => args.name,
  icon: MessageSquareIcon,
  Pane: ThreadPane,
})

function ThreadPane({
  engine,
  space,
  args,
  focused,
  update,
}: PaneProps<ThreadArgs>) {
  const { thread } = args
  const source = useMemo(
    () =>
      thread === null
        ? null
        : {
            read: async () =>
              fromView(
                await engine.call<ThreadView>(
                  "agents.thread",
                  { thread },
                  { space }
                )
              ),
            filter: { module: "agents", subject: thread },
            apply,
          },
    [engine, space, thread]
  )
  const live = useLive(engine, space, source)
  const state = live.state === "ready" ? live.view : undefined
  const turn = state && working(state)
  const sending = useAct()
  const acting = useAct()

  const send = async (text: string) => {
    const sent = await sending.act(() =>
      engine.command<Sent>(
        "agents.send",
        { agent: args.agent, thread, text },
        space
      )
    )
    if (sent && thread === null) update({ ...args, thread: sent.thread })
    return sent !== undefined
  }
  const stop = (turn: TurnView) =>
    void acting.act(() =>
      engine.command("agents.stop", { turn: turn.id }, space)
    )
  const answer = (item: ItemId, choice: string) =>
    void acting.act(() =>
      engine.command("agents.answer", { item, choice }, space)
    )
  const retry = (turn: TurnView) =>
    void acting.act(() =>
      engine.command("agents.retry", { turn: turn.id }, space)
    )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        {thread === null ? (
          <Start name={args.name} />
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
            name={args.name}
            answering={acting.busy}
            onAnswer={answer}
            onRetry={retry}
          />
        )}
      </div>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-1.5 px-4 pb-4">
        {(sending.problem ?? acting.problem) && (
          <p role="alert" className="px-1 text-xs text-destructive">
            {sending.problem ?? acting.problem}
          </p>
        )}
        <Composer
          name={args.name}
          focused={focused}
          busy={sending.busy}
          working={turn}
          onSend={send}
          onStop={stop}
        />
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
  onAnswer: (item: ItemId, choice: string) => void
}

function Transcript({
  state,
  name,
  onRetry,
  ...answers
}: Answering & {
  state: ThreadState
  name: string
  onRetry: (turn: TurnView) => void
}) {
  const turn = working(state)
  const lines = rows(state)
  const last = state.items.at(-1)
  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="end">
      <MessageScroller>
        <MessageScrollerViewport aria-label={`Thread with ${name}`}>
          <MessageScrollerContent className="mx-auto w-full max-w-3xl gap-4 px-4 pt-4 pb-2">
            {lines.map((line) =>
              line.kind === "item" ? (
                <MessageScrollerItem
                  key={line.item.id}
                  messageId={line.item.id}
                >
                  <Entry
                    item={line.item}
                    live={turn?.state === "running" && line.item === last}
                    {...answers}
                  />
                </MessageScrollerItem>
              ) : (
                <MessageScrollerItem key={`ended-${line.turn.id}`}>
                  <Ended
                    turn={line.turn}
                    busy={answers.answering}
                    onRetry={
                      retryable(state, line.turn)
                        ? () => onRetry(line.turn)
                        : undefined
                    }
                  />
                </MessageScrollerItem>
              )
            )}
            {turn && (
              <MessageScrollerItem key="working">
                <Trace>
                  <TraceLine status="running">
                    <TraceIcon>
                      <Spinner />
                    </TraceIcon>
                    <TraceTitle>
                      {turn.state === "queued"
                        ? `${name} is getting ready…`
                        : `${name} is working…`}
                    </TraceTitle>
                  </TraceLine>
                </Trace>
              </MessageScrollerItem>
            )}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}

function Entry({
  item,
  live,
  answering,
  onAnswer,
}: Answering & {
  item: Item
  /** Whether the Agent is still writing it. */
  live: boolean
}) {
  const body = item.body
  switch (body.kind) {
    case "message":
      return item.author.kind === "person" ? (
        <Message align="end">
          <MessageContent>
            <Bubble variant="muted" align="end">
              <BubbleContent className="whitespace-pre-wrap">
                {body.text}
              </BubbleContent>
            </Bubble>
          </MessageContent>
        </Message>
      ) : (
        <Message>
          <MessageContent>
            <Bubble variant="ghost">
              <BubbleContent className="whitespace-pre-wrap">
                {body.text}
              </BubbleContent>
            </Bubble>
          </MessageContent>
        </Message>
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
            <TraceCollapsibleContent className="whitespace-pre-wrap">
              {body.text}
            </TraceCollapsibleContent>
          </TraceCollapsible>
        </Trace>
      )
    case "tool": {
      const Icon = TOOL_ICONS[body.tool]
      return (
        <Trace>
          <TraceLine status={TOOL_STATUS[body.status]}>
            <TraceIcon>
              <Icon />
            </TraceIcon>
            <TraceTitle>{body.title}</TraceTitle>
          </TraceLine>
        </Trace>
      )
    }
    case "question":
      return (
        <Question
          question={body}
          answering={answering}
          onChoose={(choice) => onAnswer(item.id, choice)}
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

const TOOL_ICONS: Record<ToolKind, LucideIcon> = {
  read: FileTextIcon,
  edit: FilePenIcon,
  delete: Trash2Icon,
  move: MoveRightIcon,
  search: SearchIcon,
  execute: TerminalIcon,
  think: BrainIcon,
  fetch: GlobeIcon,
  other: WrenchIcon,
}

const TOOL_STATUS: Record<
  ToolStatus,
  "running" | "error" | "pending" | undefined
> = {
  pending: "pending",
  running: "running",
  done: undefined,
  failed: "error",
}

function Question({
  question: { title, choices, state, answer },
  answering,
  onChoose,
}: {
  question: Extract<Body, { kind: "question" }>
  answering: boolean
  onChoose: (choice: string) => void
}) {
  const first = choices.find((choice) => choice.allows)
  return (
    <div
      role="group"
      aria-label={title}
      className="flex flex-col gap-3 rounded-xl border bg-card p-3 text-sm"
    >
      <div className="flex items-start gap-2 font-medium">
        <ShieldQuestionIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 wrap-break-word">{title}</span>
      </div>
      {state === "open" ? (
        <div className="flex flex-wrap gap-2">
          {choices.map((choice) => (
            <Button
              key={choice.id}
              size="sm"
              variant={choice === first ? "default" : "outline"}
              disabled={answering}
              onClick={() => onChoose(choice.id)}
            >
              {choice.name}
            </Button>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {state === "answered"
            ? `You chose: ${choices.find((c) => c.id === answer)?.name ?? answer}`
            : "No longer asked."}
        </p>
      )}
    </div>
  )
}

/** A turn that did not finish: why, what to do about it, and Try again
 * when its message can be sent again. */
function Ended({
  turn,
  busy,
  onRetry,
}: {
  turn: TurnView
  busy: boolean
  onRetry?: () => void
}) {
  const failed = turn.state === "failed"
  const advice = turn.failure && adviceFor(turn.failure)
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
        : `You can try again after ${moment(failure.until)}.`
    case "harness_stopped":
    case "provider":
      return undefined
  }
}

/** A time as a Person reads it: the hour today, the day too otherwise. */
function moment(at: number): string {
  const today = new Date().toDateString() === new Date(at).toDateString()
  return new Intl.DateTimeFormat(undefined, {
    weekday: today ? undefined : "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(at)
}

function Composer({
  name,
  focused,
  busy,
  working,
  onSend,
  onStop,
}: {
  name: string
  focused: boolean
  busy: boolean
  working: TurnView | undefined
  /** Sends the text; resolves whether it went. */
  onSend: (text: string) => Promise<boolean>
  onStop: (turn: TurnView) => void
}) {
  const [text, setText] = useState("")
  const field = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (focused) field.current?.focus()
  }, [focused])

  const ready = text.trim() !== "" && !busy
  const send = async () => {
    if (!ready) return
    if (await onSend(text)) setText("")
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void send()
      }}
    >
      <InputGroup>
        <InputGroupTextarea
          ref={field}
          value={text}
          rows={1}
          placeholder={`Write to ${name}`}
          aria-label={`Message to ${name}`}
          className="max-h-48 min-h-10"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault()
              void send()
            }
          }}
        />
        <InputGroupAddon align="block-end" className="justify-end">
          {working && text.trim() === "" ? (
            <InputGroupButton
              type="button"
              variant="secondary"
              size="icon-sm"
              aria-label="Stop"
              onClick={() => onStop(working)}
            >
              <SquareIcon className="fill-current" />
            </InputGroupButton>
          ) : (
            <InputGroupButton
              type="submit"
              variant="default"
              size="icon-sm"
              aria-label="Send"
              disabled={!ready}
            >
              {busy ? <Spinner /> : <ArrowUpIcon />}
            </InputGroupButton>
          )}
        </InputGroupAddon>
      </InputGroup>
    </form>
  )
}
