import { Fragment, useEffect, useMemo, useRef, useState } from "react"
import type { AgentId } from "@bandaso/contract"
import type {
  Body,
  Defaults,
  Failure,
  Item,
  ItemId,
  Offer,
  Settings,
  ThreadId,
  Sent,
  ThreadView,
  TurnView,
  Usage,
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
import { RingMeter } from "@bandaso/ui/components/meter"
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
  InfoIcon,
  MessageSquareIcon,
  RotateCcwIcon,
  ShieldQuestionIcon,
  SquareIcon,
} from "lucide-react"
import {
  apply,
  fromView,
  NO_OFFER,
  retryable,
  rows,
  type ThreadState,
  working,
} from "./thread"
import { summary, type Values } from "./form"
import { QuestionForm } from "./QuestionForm"
import { Plan } from "./Plan"
import { ToolCall } from "./ToolCall"
import { SettingsBar } from "./ThreadSettings"

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

  // A Thread not yet started keeps its settings here until its first
  // message, starting from the Agent's.
  const [defaults, setDefaults] = useState<Defaults>()
  const [draft, setDraft] = useState<Settings>()
  useEffect(() => {
    if (thread !== null) return
    let current = true
    engine
      .call<Defaults>("agents.defaults", { agent: args.agent }, { space })
      .then((found) => current && setDefaults(found))
      .catch(() => current && setDefaults(undefined))
    return () => {
      current = false
    }
  }, [engine, space, args.agent, thread])
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

  const send = async (text: string) => {
    const sent = await sending.act(() =>
      engine.command<Sent>(
        "agents.send",
        // A new Thread starts as its composer shows; an existing one runs
        // with its own settings, which the bar changes as it goes.
        {
          agent: args.agent,
          thread,
          text,
          settings: thread === null ? (settings ?? null) : null,
        },
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
  const answer = (item: ItemId, choice: string, values?: Values) =>
    void acting.act(() =>
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
          usage={state?.usage}
          onSend={send}
          onStop={stop}
        >
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

/** How full the Agent's context is: a ring, and the share. */
function ContextUsed({ usage: { used, size } }: { usage: Usage }) {
  const share = size > 0 ? Math.round((used / size) * 100) : 0
  const tokens = new Intl.NumberFormat("en", { notation: "compact" })
  const words = `${share}% of the context used: ${tokens.format(used)} of ${tokens.format(size)} tokens`
  return (
    <span
      title={words}
      data-full={share >= 80 || undefined}
      className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground tabular-nums data-full:text-destructive"
    >
      <RingMeter
        value={used}
        max={Math.max(size, 1)}
        aria-label="Context used"
        getAriaValueText={() => words}
      />
      {share}%
    </span>
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
    case "tool":
      return <ToolCall tool={body} />
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

function Question({
  question: { title, choices, form, state, answer, values },
  answering,
  onAnswer,
}: {
  question: Extract<Body, { kind: "question" }>
  answering: boolean
  onAnswer: (choice: string, values?: Values) => void
}) {
  const first = choices.find((choice) => choice.allows)
  const filledIn =
    state === "answered" && form && values ? summary(form, values) : []
  const answered =
    state !== "answered"
      ? "No longer asked."
      : !form
        ? `You chose: ${choices.find((c) => c.id === answer)?.name ?? answer}`
        : values
          ? "You sent it without filling anything in."
          : "You skipped it."
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
      {state === "open" && form ? (
        <QuestionForm
          form={form}
          choices={choices}
          answering={answering}
          onAnswer={onAnswer}
        />
      ) : state === "open" ? (
        <div className="flex flex-wrap gap-2">
          {choices.map((choice) => (
            <Button
              key={choice.id}
              size="sm"
              variant={choice === first ? "default" : "outline"}
              disabled={answering}
              onClick={() => onAnswer(choice.id)}
            >
              {choice.name}
            </Button>
          ))}
        </div>
      ) : filledIn.length > 0 ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          {filledIn.map(({ id, title, value }) => (
            <Fragment key={id}>
              <dt className="text-muted-foreground">{title}</dt>
              <dd className="min-w-0 wrap-break-word">{value}</dd>
            </Fragment>
          ))}
        </dl>
      ) : (
        <p className="text-xs text-muted-foreground">{answered}</p>
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
  usage,
  onSend,
  onStop,
  children,
}: {
  name: string
  focused: boolean
  busy: boolean
  working: TurnView | undefined
  /** How full the Agent's context is, once its Harness has said. */
  usage?: Usage
  /** Sends the text; resolves whether it went. */
  onSend: (text: string) => Promise<boolean>
  onStop: (turn: TurnView) => void
  /** What the Thread runs with, beside the send button. */
  children?: React.ReactNode
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
        <InputGroupAddon align="block-end" className="justify-between gap-2">
          <div className="min-w-0 flex-1">{children}</div>
          {usage && <ContextUsed usage={usage} />}
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
