import { AGENTS_FILE } from "@banda/contract/agents"
import { fileNow } from "@banda/ui/lib/look"
import { ThreadMedia } from "./ThreadMedia"
import { MarkdownFiles } from "@banda/ui/components/markdown-file"
import { MarkdownLinks } from "@banda/ui/components/markdown-link"
import {
  ContextMenu,
  ContextMenuTrigger,
} from "@banda/ui/components/context-menu"
import { useMemo, useRef, useState } from "react"
import type { Engine, ProjectId } from "@banda/contract"
import type {
  Failure,
  Item,
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
import { HarnessLogo } from "@banda/ui/components/harness-logo"
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
import { ZoomBadge } from "@banda/ui/components/zoom-badge"
import { useZoom } from "@banda/ui/hooks/use-zoom"
import { matches } from "@banda/ui/lib/keys"
import { copyAsMarkdown } from "@banda/ui/lib/markdown-copy"
import { clock, duration } from "@banda/ui/lib/words"
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
import { type MenuAt, menuAt, ThreadMenu } from "./ThreadMenu"
import { useThreadFiles } from "./ThreadFiles"
import { type AnswerKeys, pressOf, Question, QuestionDrawer } from "./Questions"
import { aboutOf, keyAnswer } from "./asking"
import { drafted } from "./drafts"
import { ChangedFiles } from "./ChangedFiles"
import { DETAILS_KEY, ThreadDetails, useWide } from "./Details"
import { Plan } from "./Plan"
import { PlanReady, ProposedPlan } from "./ProposedPlan"
import { planTitle } from "./messageText"
import { awaiting, type Line, thoughtTimes, timeline } from "./timeline"
import { Fold, key, WorkLine, Working } from "./Work"
import { Queue, type QueueActions } from "./Queue"
import { ScrollPlace } from "./ScrollPlace"
import { FindBar, useFound } from "./Find"
import { holds } from "./findIn"
import { Minimap } from "./Minimap"
import { ToolCall } from "./ToolCall"
import { Issue } from "./Issue"
import { Visual, type VisualArgs } from "./Visual"
import { visualPane } from "./VisualPane"
import { ModelPicker } from "./ModelPicker"
import { pickedOf } from "./picker"
import { ModeMenu } from "./ThreadSettings"
import { SignIn, Warning } from "./SignIn"
import { useMachine } from "@banda/ui/hooks/use-status"
import { NewThreadBar } from "./NewThread"
import {
  NEW_THREAD,
  type ThreadArgs,
  useThreadSession,
  zoomKey,
} from "./session"

export const threadPane = definePane<ThreadArgs>({
  kind: "agents.thread",
  title: (args) => args.title || "New Thread",
  shows: (args) => args.thread,
  icon: MessageSquareIcon,
  // No line under it: the messages fade out under it (ADR 0031).
  header: "bare",
  start: NEW_THREAD,
  // A Thread starts with its Harness.
  letter: "H",
  // On its Project's workspace, with the Project's other Agents (ADR 0065).
  home: () => fileNow(AGENTS_FILE).workspaces === "project",
  Pane: ThreadPane,
})

function ThreadPane(props: PaneProps<ThreadArgs>) {
  const project = props.args.scratch ?? props.project
  return (
    <ThreadMedia project={project}>
      <MarkdownLinks open={linkOpener(props.run, project)}>
        <ThreadContent {...props} project={project} />
      </MarkdownLinks>
    </ThreadMedia>
  )
}

/** Opens a web link in Banda's browser, or outside it (ADR 0051). */
function linkOpener(run: PaneProps<ThreadArgs>["run"], project: ProjectId) {
  return (address: string, outside: boolean) => {
    if (outside) window.open(address, "_blank", "noopener,noreferrer")
    else run?.("browser.open", { address, project })
  }
}

function ThreadContent(props: PaneProps<ThreadArgs>) {
  const { engine, project, args, focused, open, update, run } = props
  const machine = useMachine(engine)
  const unplaced = project === machine
  const { thread } = args
  const {
    live,
    state,
    turn,
    harness,
    name,
    short,
    reader,
    sending,
    acting,
    problem,
    settings,
    offer,
    configure,
    starts,
    startOn,
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
  const picked = useMemo(() => pickedOf(offer.options), [offer.options])
  const [dropping, setDropping] = useState(false)
  // What the Person looks for in the Thread, while the find bar is open.
  const [find, setFind] = useState<{ query: string; at: number }>()
  const area = useRef<HTMLDivElement>(null)
  // What a right click found, for the Thread's menu (ADR 0063, decision 3).
  const [menu, setMenu] = useState<MenuAt | null>(null)
  // Where the paths in its replies lead (ADR 0063, decision 2).
  const files = useThreadFiles(project, state?.items, run)
  const root = useRef<HTMLDivElement>(null)
  const composer = useRef<ComposerHandle>(null)
  const findField = useRef<HTMLInputElement>(null)
  const dock = useRef<HTMLDivElement>(null)
  // Esc and Enter answer the Question that waits, from anywhere in the
  // Pane that leaves them free (ADR 0058, decision 6).
  const answerKeys = useRef<AnswerKeys>(null)
  // Whether the composer held a message as a key went down: by the time
  // the key reaches the Pane, Enter may have sent it.
  const written = useRef(false)
  const writers = useWriters(engine, project, thread)
  const found = useFound(area, find?.query ?? "", find?.at ?? 0, state)
  // The details card: kept open on a wide Thread until hidden, popped
  // open for a moment on a narrow one.
  const wide = useWide(root)
  const [popped, setPopped] = useState(false)
  // Ctrl or ⌘ with + − 0 sizes its words, kept till the window starts
  // again (ADR 0063, decision 5).
  const zoom = useZoom(zoomKey(thread))
  const detailsShown = wide ? args.details !== false : popped
  const setDetailsShown = wide
    ? (shown: boolean) =>
        update({ ...args, details: shown ? undefined : false })
    : setPopped

  return (
    // Files dropped anywhere on the Pane join the message; Mod+F finds in
    // it, as in T3 Code.
    <div
      ref={root}
      className="@container/thread flex h-full min-h-0 flex-col"
      style={{ "--thread-zoom": zoom.zoom } as React.CSSProperties}
      onKeyDownCapture={() => {
        written.current = thread !== null && drafted(thread)
      }}
      onKeyDown={(event) => {
        if (zoom.press(event)) {
          event.preventDefault()
          return
        }
        if (matches(event, DETAILS_KEY)) {
          event.preventDefault()
          setDetailsShown(!detailsShown)
          return
        }
        const press =
          asking && thread !== null
            ? pressOf(event, root.current, dock.current, written.current)
            : undefined
        const answer = press && keyAnswer(press)
        if (answer && answerKeys.current?.(answer)) {
          // Its own: not the workspace drawer's Esc, nor the composer's.
          event.preventDefault()
          event.stopPropagation()
          return
        }
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
      <ContextMenu
        onOpenChangeComplete={(open) => {
          if (!open) setMenu(null)
        }}
      >
        <ContextMenuTrigger
          onContextMenu={(event) => {
            const at = menuAt(event.target as Element, event.currentTarget, {
              x: event.clientX,
              y: event.clientY,
            })
            if (at && !event.defaultPrevented) setMenu(at)
            else event.preventBaseUIHandler()
          }}
          render={<div ref={area} className="relative min-h-0 flex-1" />}
          // A reply copies as Markdown and HTML (ADR 0063, decision 4).
          onCopy={copyAsMarkdown}
        >
          <ZoomBadge zoom={zoom.shown} />
          <QuoteSelection
            area={area}
            onQuote={(quote) => composer.current?.quote(quote)}
          />
          {!unplaced && (
            <ThreadDetails
              engine={engine}
              project={project}
              thread={thread}
              harness={harness ? { id: harness, name: short } : null}
              open={open}
              focused={focused}
              wide={wide}
              shown={detailsShown}
              onShown={setDetailsShown}
            />
          )}
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
            <Start harness={harness} name={name} />
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
            // A Thread's own: another's tools worked elsewhere.
            <MarkdownFiles key={thread} host={files}>
              <Transcript
                // Each Thread scrolls on its own, from where it was left.
                key={thread}
                engine={engine}
                project={project}
                thread={thread}
                forYou={Boolean(asking || planned)}
                finding={find?.query ?? ""}
                state={live.view}
                waits={waits}
                name={name}
                reader={reader}
                answering={acting}
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
                onOpenVisual={(visual) =>
                  open(paneOf(visualPane, visual), "group")
                }
                writers={writers}
                onOpenThread={(other) => open(threadPaneOf(other), "right")}
                signIn={(turn) => (
                  <SignIn
                    engine={engine}
                    project={project}
                    harness={harness}
                    turn={turn.id}
                    open={open}
                    onSignedIn={() => retry(turn)}
                  />
                )}
                queue={queue}
              />
            </MarkdownFiles>
          )}
        </ContextMenuTrigger>
        <ThreadMenu
          at={menu}
          acts={{
            quote: (text) => composer.current?.quote(text),
            find: (words) => {
              // A bar not yet open takes the focus itself.
              setFind({ query: words, at: 0 })
              findField.current?.select()
            },
            search: run && ((words) => run("browser.open", { words, project })),
            open: linkOpener(run, project),
            copyImage: run && ((x, y) => run("edit.copy-image", { x, y })),
            file: files ?? undefined,
            point: (path) => composer.current?.point(path),
          }}
        />
      </ContextMenu>
      <div
        ref={dock}
        data-chat
        className="mx-auto flex w-full max-w-3xl flex-col gap-1.5 px-(--chat-gutter) pb-4"
      >
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
        {asking && (
          <QuestionDrawer
            // A new Question opens afresh.
            key={asking.id}
            item={asking}
            about={state && aboutOf(state.items, asking)}
            name={name}
            answering={acting}
            onAnswer={(choice, values) => answer(asking.id, choice, values)}
            keys={answerKeys}
          />
        )}
        <Composer
          ref={composer}
          name={name}
          thread={thread}
          history={history}
          placeholder={
            asking
              ? `Answer above, or write to say no and tell ${name} what to do instead`
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
          paste={
            run && ((plain) => run(plain ? "edit.paste-plain" : "edit.paste"))
          }
        >
          {settings && (
            <>
              {!unplaced && (
                <ModeMenu
                  settings={settings}
                  options={picked.rest}
                  disabled={acting}
                  onChange={configure}
                />
              )}
              <ModelPicker
                harness={harness}
                name={name}
                settings={settings}
                picked={picked}
                disabled={acting}
                onChange={configure}
                starts={starts}
                onStart={startOn}
              />
            </>
          )}
        </Composer>
        {/* A new Thread's Project, bare under the card; its Harness is chosen
          with the model. */}
        {thread === null && (
          <NewThreadBar
            engine={engine}
            project={project}
            disabled={sending}
            onProject={(other) =>
              open(
                paneOf(threadPane, { ...args, scratch: undefined, harness }),
                "here",
                other
              )
            }
            onAddProject={run && (() => run("project.add"))}
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

/** A Thread not yet started: whom it writes to, by the Harness's logo,
 * and one quiet line (ADR 0058). */
function Start({ harness, name }: { harness: string; name: string }) {
  return (
    <Empty className="h-full">
      <EmptyHeader className="gap-1">
        <EmptyMedia className="mb-2">
          <HarnessLogo
            id={harness}
            name={name}
            className="size-6"
            fallback={<BotIcon className="size-6 text-muted-foreground" />}
          />
        </EmptyMedia>
        <EmptyTitle>Write to {name}</EmptyTitle>
        <EmptyDescription>
          It asks you before anything that needs your yes.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

type Answering = {
  /** Whether a command is on its way; what acts waits for it. A Question
   * is answered on the composer (ADR 0058, decision 6). */
  answering: boolean
}

function Transcript({
  engine,
  project,
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
  onOpenVisual,
  signIn,
  queue,
  writers,
  onOpenThread,
  ...answers
}: Answering &
  Writers & {
    engine: Engine
    project: ProjectId
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
    onOpenVisual: OpenVisual
    /** How a Person signs in again, below a turn that failed for that. */
    signIn: (turn: TurnView) => React.ReactNode
    queue: QueueActions
  }) {
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
            engine={engine}
            project={project}
            item={line.item}
            onFork={forkAt(line.item)}
            onEdit={editAt(line.item)}
            turn={line.item.turn ? turns.get(line.item.turn)?.state : undefined}
            asks={asks.has(line.item.id)}
            took={thoughts.get(line.item.id)}
            live={turn?.state === "running" && line.item === last}
            reader={reader}
            onOpenDiff={onOpenDiff}
            onOpenVisual={onOpenVisual}
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
          <MessageScrollerContent
            data-chat
            className="mx-auto w-full max-w-3xl gap-5 px-(--chat-gutter) pt-4 pb-6"
          >
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

/** Opens the changes of a turn, on one file if `path` names it. */
type OpenDiff = (turn: string, path?: string) => void

/** Opens a Visual as a Pane of its own, beside the Thread. */
type OpenVisual = (visual: VisualArgs) => void

function Entry({
  engine,
  project,
  item,
  turn,
  asks,
  took,
  live,
  reader,
  onOpenDiff,
  onOpenVisual,
  writer,
  onOpenThread,
  onFork,
  onEdit,
}: Answering & {
  engine: Engine
  project: ProjectId
  item: Item
  /** How its turn stands, if it has one. */
  turn?: TurnView["state"]
  /** It is a call that waits for its Person's answer. */
  asks: boolean
  /** How long it took, in ms, when it is a thought and that is known. */
  took?: number
  /** From {@link AgentMessage}'s `onFork`. */
  onFork?: (() => void) | null
  /** From {@link PersonMessage}'s `onEdit`. */
  onEdit?: (() => void) | null
  /** Whether the Agent is still writing it. */
  live: boolean
  reader: ImageReader
  onOpenDiff: OpenDiff
  onOpenVisual: OpenVisual
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
                <TraceTitle>
                  {live
                    ? "Thinking"
                    : took !== undefined && took >= 1000
                      ? `Thought for ${duration(took)}`
                      : "Thought"}
                </TraceTitle>
              </TraceLine>
            </TraceCollapsibleTrigger>
            <TraceCollapsibleContent inset>
              <Markdown streaming={live} className="text-muted-foreground">
                {body.text}
              </Markdown>
            </TraceCollapsibleContent>
          </TraceCollapsible>
        </Trace>
      )
    case "tool": {
      // A call that failed changed nothing the turn's changes show.
      const changed = body.status !== "failed" ? item.turn : undefined
      return (
        <ToolCall
          tool={body}
          reader={reader}
          turn={turn}
          asks={asks}
          onOpenDiff={
            changed === undefined
              ? undefined
              : (path) => onOpenDiff(changed, path)
          }
        />
      )
    }
    case "plan":
      return <Plan steps={body.steps} />
    case "question":
      return <Question question={body} />
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
    case "issue":
      return (
        <Issue engine={engine} project={project} item={item.id} issue={body} />
      )
    case "visual": {
      const { visual, title, height, heights } = body
      const args = { visual, title, height, heights }
      return (
        <Visual
          project={project}
          visual={args}
          onOpen={() => onOpenVisual(args)}
        />
      )
    }
  }
}

/** A turn that did not finish: why, what to do about it, and Try again
 * when its message can be sent again. One that failed says so in plain
 * words beside a red icon (ADR 0058, decision 1). One that failed because
 * its Person must sign in offers the ways to, while it can go again. */
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
      <TraceLine
        status={failed ? "error" : undefined}
        className={failed ? "text-foreground" : undefined}
      >
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
            <span className="text-meta text-muted-foreground">{advice}</span>
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

/** The Project's other Threads by their Agents' IDs, as the sidebar follows
 * them, so a message from one names it as it is now; and this Thread's own
 * Agent, so a message from one the list no longer has still says so. */
function useWriters(
  engine: Engine,
  project: ProjectId,
  thread: string | null
): Listing {
  // Who writes stays as a rewind leaves it: no need to read the list again.
  const source = useMemo(
    () =>
      thread === null
        ? null
        : { ...threadsSource(engine, project), apply: applyThreads },
    [engine, project, thread]
  )
  const live = useLive(engine, project, source)
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
