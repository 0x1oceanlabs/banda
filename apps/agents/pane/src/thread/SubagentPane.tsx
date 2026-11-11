/**
 * A sub-agent opened beside its Thread, as a Pane in the Thread's Group
 * (ADR 0103, decision 21): its lane, read only, drawn as a Thread is, by
 * the Thread's own transcript and entries. Its header names it and its
 * Thread, or, nested, the breadcrumb up to it; its brief is the bubble its
 * parent wrote; a status bar takes the composer's place, with no text box.
 * A Thread has one: Open beside on another of its sub-agents shows that
 * one in it, and one of its own sub-agents opens in it, a level deeper.
 * Banda shows a Harness's sub-agents and manages none (ADR 0103, call
 * 11): no Stop, and no message to it.
 */
import { Fragment, useEffect, useMemo, useRef } from "react"
import { ChevronRightIcon, OrbitIcon } from "lucide-react"
import type { ProjectId } from "@banda/contract"
import type { ThreadId } from "@banda/contract/agents"
import { Bubble, BubbleContent } from "@banda/ui/components/bubble"
import { Emblem, emblemOf, type EmblemOf } from "@banda/ui/components/emblem"
import { MarkdownFiles } from "@banda/ui/components/markdown-file"
import { MarkdownLinks } from "@banda/ui/components/markdown-link"
import { Message, MessageContent } from "@banda/ui/components/message"
import { PaneHeader } from "@banda/ui/components/pane-header"
import { Satellite } from "@banda/ui/components/satellite"
import { Spinner } from "@banda/ui/components/spinner"
import { useScope } from "@banda/ui/hooks/use-scope"
import { useZoom } from "@banda/ui/hooks/use-zoom"
import type { SatelliteState } from "@banda/ui/lib/satellite"
import { cn } from "@banda/ui/lib/utils"
import type { Action } from "@banda/ui/module"
import { definePane, paneOf, type PaneProps } from "@banda/ui/pane"
import { modelNow } from "../composer/picker"
import { useImageReader } from "../entries/parts/MessageImages"
import { THREAD_ZOOM, useClamp } from "../entries/parts/Messages"
import { FADES } from "../entries/parts/RowTrigger"
import { harnessName, harnessShort, useHarnesses } from "../harnesses"
import { textOf } from "../list/answering"
import { SUBAGENT } from "../scopes"
import { threadPane } from "../ThreadPane"
import { visualPane } from "../visual/VisualPane"
import {
  type Asked,
  askedOf,
  type Crumb,
  type Head,
  headOf,
  laneThread,
  litOf,
  OPEN_BESIDE,
  type Status,
  statusOf,
  statusWords,
  type SubagentArgs,
  upOf,
} from "./beside"
import { ThreadAroundProvider, type ThreadActs } from "./context"
import { useSubagent } from "./live-lane"
import { useThread } from "./live-thread"
import { turnDiffPane, zoomKey } from "./session"
import { showBeside } from "./shown-beside"
import { Centered, linkOpener } from "./Thread"
import { useThreadFiles } from "./ThreadFiles"
import { ThreadMedia } from "./ThreadMedia"
import { Transcript } from "./Transcript"

export const subagentPane = definePane<SubagentArgs>({
  // A literal, which the window's kind checker reads.
  kind: "agents.subagent",
  title: () => "Sub-agent",
  icon: OrbitIcon,
  // Its header is its own: the satellite, and the breadcrumb.
  header: false,
  // Not `elsewhere` yet: a Thread of another host offers no Open beside
  // (`opensBeside`).
  // One per Thread, so one in its Group: another of its sub-agents shows
  // in it (ADR 0103, decision 21).
  identity: (args) => args.thread,
  Pane: SubagentPane,
})

/**
 * Whether Thread `thread` offers Open beside: where its sub-agents' Pane
 * opens from it, as the router answers (`PaneProps.runs`). It asks what
 * opens, never where the Thread is (ADR 0106, law 6). Today that is a
 * Thread of this machine alone: the kind does not open elsewhere until
 * the Thread's own passes the kit (laws 5 and 6), so another host's
 * Thread offers none, and its rows opened in place are the way to read
 * its sub-agents. Where no router answers, it does.
 */
export function opensBeside(
  runs: PaneProps<unknown>["runs"],
  thread: ThreadId
): boolean {
  // Any of its sub-agents: the router asks of the kind and its owner.
  return runs?.(paneOf(subagentPane, { thread, sub: "" })).runs ?? true
}

/**
 * Opens a sub-agent beside its Thread (ADR 0103, decision 21): its Pane in
 * the Group of the Thread whose Agent is `agent`, or the one that Thread
 * has, which then shows it and takes the focus. Unlisted: a sub-agent's
 * row runs it.
 */
export const openBeside: Action = {
  id: OPEN_BESIDE,
  title: "Open a sub-agent beside its Thread",
  section: "Threads",
  unlisted: true,
  run: (window, args) => {
    const [project, thread, sub, agent] = [
      "project",
      "thread",
      "sub",
      "agent",
    ].map((key) => textOf(args, key))
    if (!project || !thread || !sub) return
    window.open(paneOf(subagentPane, { thread, sub }), project as ProjectId, {
      again: false,
      update: true,
      ...(agent && { beside: agent }),
    })
  },
}

function SubagentPane(props: PaneProps<SubagentArgs>) {
  const { engine, project, args, run, open, update, close, label, focused } =
    props
  const { thread: threadId, sub } = args
  const thread = useThread(engine, project, threadId)
  const lane = useSubagent(engine, project, threadId, sub)
  const harnesses = useHarnesses(engine)
  const reader = useImageReader(engine, project)
  // The Thread's text size, as its words are the Thread's (ADR 0063,
  // decision 5).
  const zoom = useZoom(zoomKey(threadId))
  const root = useRef<HTMLDivElement>(null)

  const view = thread.state === "ready" ? thread.view : undefined
  const read = lane.state === "ready" ? lane.view : undefined
  // Where it sits, from its Thread's sub-agents and their parents, which
  // stay as it goes up or down a level and its own read starts again.
  const lanes = view?.subagents
  const placed = lanes?.find((one) => one.id === sub)
  // Its Thread lights the row it went from while it shows.
  const lit = placed && lanes && litOf(placed, lanes)
  useEffect(
    () => (lit === undefined ? undefined : showBeside(project, threadId, lit)),
    [project, threadId, lit]
  )

  // Drawn again for what it draws alone: each fact of its Thread is a new
  // record of both reads.
  const drawn = useMemo(
    () => (view && read ? laneThread(view, read) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the parts it reads
    [
      read?.items,
      read?.subagent,
      read?.subagents,
      view?.subagents,
      view?.heard,
      view?.settings,
      view?.offer,
      view?.harness,
      view?.title,
    ]
  )
  const harness = drawn?.harness ?? ""
  const name = harnessName(harnesses, harness)
  const short = harnessShort(harnesses, harness) || name
  const own = read?.subagent
  const said = useMemo(() => {
    if (!drawn || !own) return undefined
    const lanes = drawn.subagents
    const model = modelNow(drawn.settings, drawn.offer.options)
    return {
      head: headOf(threadId, own, lanes, drawn.title),
      asked: askedOf(own, lanes, short),
      status: statusOf(own, lanes, { model, short }),
    }
  }, [drawn, own, threadId, short])

  // Its tab and the overview name it as its header does.
  const head = said?.head
  const title = head?.label
  const detail = head ? (head.of ?? head.title ?? null) : null
  useEffect(() => {
    if (title !== undefined) label?.({ title, detail })
  }, [title, detail, label])
  useEffect(() => () => label?.(null), [label])

  // A crumb goes to its level; the Thread's to the Thread's own Pane.
  const go = (to: Crumb["to"]) => {
    if (to !== "thread") return update(to)
    const pane = paneOf(threadPane, {
      thread: threadId,
      harness,
      title: drawn?.title ?? "",
    })
    run?.("pane.pick", { project, pane })
  }
  // Another level drawn takes away what had the focus in it, as the row
  // clicked: its tile keeps it, for Esc.
  useEffect(() => {
    const tile = root.current?.closest<HTMLElement>("[data-tile]")
    if (focused && tile && !tile.contains(document.activeElement))
      tile.focus({ preventScroll: true })
  }, [sub, focused])
  // Its key (ADR 0071, decision 1): Esc goes one level up; at the top it
  // does nothing new. It keeps the Esc it takes: what holds the Pane, as
  // the drawer, does not take it too.
  const up = placed && upOf(threadId, placed)
  const scope = useScope(
    SUBAGENT,
    {
      "agents.subagent.up": (_, pressed) => {
        if (!up) return false
        pressed?.stopPropagation()
        update(up)
        return true
      },
    },
    { tile: true }
  )
  useEffect(() => scope(root.current), [scope])

  // What its entries ask. It forks, rewinds and tries nothing again: none
  // of them offers it here.
  const acts: ThreadActs = {
    openDiff: (turn, path) => open(turnDiffPane(threadId, turn, path), "group"),
    openVisual: (visual) => open(paneOf(visualPane, visual), "group"),
    openThread: () => {},
    fork: () => {},
    rewind: () => {},
    retry: () => {},
    retryOn: () => {},
    signIn: () => null,
    openLink: (url) => run?.("link.open", { url }),
    // One of its own sub-agents opens here, a level deeper.
    openSubagent: (child) => update({ thread: threadId, sub: child }),
  }
  const files = useThreadFiles(project, drawn?.items, run)
  const prompt = own?.prompt
  const { words, look } = said?.asked ?? {}
  const brief = useMemo(
    () =>
      prompt && words ? (
        <Brief
          asked={{ words, ...(look && { look }) }}
          text={prompt}
          harness={emblemOf(harnesses, harness, name)}
        />
      ) : null,
    [prompt, words, look, harnesses, harness, name]
  )

  const refusal =
    lane.state === "refused"
      ? lane.refusal.message
      : thread.state === "refused"
        ? thread.refusal.message
        : undefined
  return (
    <div
      ref={root}
      data-slot="subagent-pane"
      className="@container/thread flex h-full min-h-0 flex-col"
      style={{ "--thread-zoom": zoom.zoom } as React.CSSProperties}
    >
      <SubagentHead head={head} onCrumb={go} onClose={close} />
      <div className="relative min-h-0 flex-1">
        {refusal !== undefined ? (
          <Centered>
            <p className="text-sm text-muted-foreground">{refusal}</p>
          </Centered>
        ) : !drawn || !said ? (
          <Centered>
            <Spinner />
          </Centered>
        ) : (
          <ThreadMedia project={project}>
            <MarkdownLinks open={linkOpener(run, project)}>
              <MarkdownFiles key={sub} host={files}>
                <ThreadAroundProvider
                  engine={engine}
                  project={project}
                  thread={threadId}
                  reader={reader}
                  acts={acts}
                >
                  <Transcript
                    // Each level scrolls on its own.
                    key={sub}
                    state={drawn}
                    name={name}
                    // Its own sub-agents' rows say it set them to work.
                    short={said.head.label}
                    lane={{ id: sub, brief }}
                  />
                </ThreadAroundProvider>
              </MarkdownFiles>
            </MarkdownLinks>
          </ThreadMedia>
        )}
      </div>
      <div
        data-chat
        className="mx-auto flex w-full max-w-3xl flex-col gap-1.5 px-(--chat-gutter) pb-4"
      >
        {said && <StatusBar status={said.status} />}
      </div>
    </div>
  )
}

/** Its header: its satellite at 12 px, then its label and "sub-agent of
 * ‹Thread›", muted; nested, the breadcrumb before its label and its title
 * after it. Long words fade, with no "…". */
function SubagentHead({
  head,
  onCrumb,
  onClose,
}: {
  head: Head | undefined
  onCrumb: (to: Crumb["to"]) => void
  onClose: () => void
}) {
  const title = head?.label ?? "Sub-agent"
  const after = head?.of ?? head?.title
  return (
    <PaneHeader title={title} onClose={onClose} className="border-b-0">
      {head && (
        <span className="flex size-4 shrink-0 items-center justify-center">
          <Satellite state={head.look} size={12} />
        </span>
      )}
      {head?.crumbs && (
        <nav
          aria-label="Where it is"
          className="flex max-w-[60%] min-w-0 shrink items-center gap-0.5"
        >
          {head.crumbs.map((crumb, at) => (
            <Fragment key={at}>
              <button
                type="button"
                title={
                  crumb.to === "thread" ? "Go to its Thread" : "Go up to it"
                }
                onClick={() => onCrumb(crumb.to)}
                className={cn(
                  "min-w-0 shrink cursor-pointer rounded-small text-meta text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
                  FADES
                )}
              >
                {crumb.words}
              </button>
              <ChevronRightIcon
                aria-hidden
                className="size-3 shrink-0 text-sub-faint"
              />
            </Fragment>
          ))}
        </nav>
      )}
      <h2
        className={cn(
          "min-w-0 shrink-0 font-medium text-muted-foreground group-data-[selected=true]/tile:text-foreground",
          "max-w-[50%]",
          FADES
        )}
      >
        {title}
      </h2>
      {after && (
        <span
          className={cn("min-w-0 flex-1 basis-0 text-muted-foreground", FADES)}
        >
          {after}
        </span>
      )}
    </PaneHeader>
  )
}

/** Its brief: "Claude asked" by its Harness's logo, or "Reviewer asked"
 * by its parent's satellite, over the bubble its parent wrote, on the
 * right as the Person's own; long, clamped until it is opened. */
function Brief({
  asked,
  text,
  harness,
}: {
  asked: Asked
  text: string
  harness: EmblemOf
}) {
  const clamp = useClamp(text, "max-h-44", "Show the whole brief")
  return (
    <Message align="end" data-slot="subagent-brief">
      <MessageContent className="items-end">
        <span className="flex items-center gap-1.5 pr-1 text-meta text-muted-foreground">
          {asked.look ? (
            <Satellite state={asked.look} size={10} />
          ) : (
            <Emblem of={harness} className="size-3" />
          )}
          {asked.words}
        </span>
        <Bubble variant="muted" align="end" className={THREAD_ZOOM}>
          <BubbleContent className={cn("whitespace-pre-wrap", clamp.className)}>
            {text}
          </BubbleContent>
        </Bubble>
        {clamp.toggle}
      </MessageContent>
    </Message>
  )
}

/** The colour of its state's word: grey while it works, the attention's
 * while it asks, the destructive's once it failed, muted once it stopped
 * or was lost (the kit's `.s-statusbar`). */
const WORD: Record<SatelliteState, string> = {
  working: "text-sub-grey",
  queued: "text-sub-grey",
  asks: "text-attention",
  failed: "text-destructive",
  done: "text-foreground",
  stopped: "text-muted-foreground",
  lost: "text-muted-foreground",
}

/** The status bar in the composer's place, its shape and radius with no
 * text box: its satellite, its state's word, and the rest. No buttons
 * yet; nothing in it ticks (decision 20). */
function StatusBar({ status }: { status: Status }) {
  return (
    <div
      data-slot="subagent-status"
      data-look={status.look}
      aria-label={statusWords(status)}
      className="flex min-h-12 items-center gap-2.5 rounded-card border bg-block py-2 pr-2 pl-3.5 text-ui whitespace-nowrap text-muted-foreground"
    >
      <Satellite state={status.look} size={12} />
      <p className={cn("flex min-w-0 flex-1 items-center gap-1.5", FADES)}>
        <span className={cn("shrink-0 font-medium", WORD[status.look])}>
          {status.word}
        </span>
        {status.rest.map((part, at) => (
          <Fragment key={at}>
            <span aria-hidden className="shrink-0 text-sub-faint">
              ·
            </span>
            <span className="shrink-0">{part}</span>
          </Fragment>
        ))}
      </p>
    </div>
  )
}
