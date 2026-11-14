/**
 * A sub-agent opened beside its Thread, as a Pane in the Thread's Group
 * (ADR 0103, decision 21): its lane, read only, drawn as a Thread is, by
 * the Thread's own transcript and entries. Its header names it and its
 * Thread, or, nested, the breadcrumb up to it; its brief is the bubble its
 * parent wrote, and so is each message after it; a status bar takes the
 * composer's place, with no text box, and asks the Thread's Agent about it
 * (decision 25).
 * A Thread has one: Open beside on another of its sub-agents shows that
 * one in it, and one of its own sub-agents opens in it, a level deeper.
 * Where its Thread's Pane is alone, the same view shows over the Thread,
 * as a screen (`SubagentScreen.tsx`): what both draw is here.
 * Banda shows a Harness's sub-agents and manages none (ADR 0103, call
 * 11): no Stop, and no message to it but through its Thread's Agent.
 */
import { Fragment, useEffect, useMemo, useRef } from "react"
import { AtSignIcon, ChevronRightIcon, OrbitIcon } from "lucide-react"
import type { Engine, ProjectId } from "@banda/contract"
import type { SubagentId, ThreadId } from "@banda/contract/agents"
import { Button } from "@banda/ui/components/button"
import { emblemOf } from "@banda/ui/components/emblem"
import { MarkdownFiles } from "@banda/ui/components/markdown-file"
import { MarkdownLinks } from "@banda/ui/components/markdown-link"
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
import { Brief } from "../entries/parts/Brief"
import { useImageReader } from "../entries/parts/MessageImages"
import { FADES } from "../entries/parts/RowTrigger"
import { harnessName, harnessShort, useHarnesses } from "../harnesses"
import { textOf } from "../list/answering"
import { SUBAGENT } from "../scopes"
import { threadPane } from "../ThreadPane"
import { visualPane } from "../visual/VisualPane"
import { askAbout } from "./ask-about"
import {
  askedOf,
  askWords,
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
import type { Opens } from "./screens"
import { useSubagent } from "./live-lane"
import { useThread } from "./live-thread"
import { turnDiffPane, zoomKey } from "./session"
import { showBeside } from "./shown-beside"
import { Centered } from "./Thread"
import { linksOf } from "./links"
import { useThreadFiles } from "./ThreadFiles"
import { ThreadMedia } from "./ThreadMedia"
import { Transcript } from "./Transcript"

export const subagentPane = definePane<SubagentArgs>({
  // A literal, which the window's kind checker reads.
  kind: "agents.subagent",
  name: "Sub-agent",
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
  const {
    engine,
    project,
    args,
    run,
    runs,
    device,
    file,
    open,
    update,
    close,
    label,
    focused,
  } = props
  const { thread: threadId, sub } = args
  const lane = useSubagentLane(engine, project, threadId, sub)
  const { lanes, placed, drawn, harness, said } = lane
  // The Thread's text size, as its words are the Thread's (ADR 0063,
  // decision 5).
  const zoom = useZoom(zoomKey(threadId))
  const root = useRef<HTMLDivElement>(null)

  // Its Thread lights the row it went from while it shows.
  const lit = placed && lanes && litOf(placed, lanes)
  useEffect(
    () => (lit === undefined ? undefined : showBeside(project, threadId, lit)),
    [project, threadId, lit]
  )

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

  return (
    <div
      ref={root}
      data-slot="subagent-pane"
      className="@container/thread flex h-full min-h-0 flex-col"
      style={{ "--thread-zoom": zoom.zoom } as React.CSSProperties}
    >
      <SubagentHead head={head} onCrumb={go} onClose={close} />
      <SubagentBody
        lane={lane}
        engine={engine}
        project={project}
        thread={threadId}
        sub={sub}
        run={run}
        runs={runs}
        device={device}
        file={file}
        open={open}
        // One of its own sub-agents opens here, a level deeper.
        onSub={(child) => update({ thread: threadId, sub: child })}
        // Its Thread's composer takes the ask: the Thread's Pane.
        onAsk={() => go("thread")}
      />
    </div>
  )
}

/**
 * What a sub-agent's view reads and says, beside its Thread or over it
 * (ADR 0103, decision 21): its Thread and its own lane, each read and
 * followed, drawn as one Thread (`laneThread`); where it sits among its
 * Thread's sub-agents; and what its header, its brief and its status bar
 * say.
 */
export function useSubagentLane(
  engine: Engine,
  project: ProjectId,
  threadId: ThreadId,
  sub: SubagentId
) {
  const thread = useThread(engine, project, threadId)
  const lane = useSubagent(engine, project, threadId, sub)
  const harnesses = useHarnesses(engine)

  const view = thread.state === "ready" ? thread.view : undefined
  const read = lane.state === "ready" ? lane.view : undefined
  // Where it sits, from its Thread's sub-agents and their parents, which
  // stay as it goes up or down a level and its own read starts again.
  const lanes = view?.subagents
  const placed = lanes?.find((one) => one.id === sub)

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
      wrote: askedOf(own, lanes, short, "wrote"),
      status: statusOf(own, lanes, { model, short }),
    }
  }, [drawn, own, threadId, short])
  const emblem = useMemo(
    () => emblemOf(harnesses, harness, name),
    [harnesses, harness, name]
  )
  const refusal =
    lane.state === "refused"
      ? lane.refusal.message
      : thread.state === "refused"
        ? thread.refusal.message
        : undefined
  return {
    lanes,
    placed,
    drawn,
    own,
    harness,
    name,
    short,
    emblem,
    said,
    refusal,
  }
}

/** What {@link useSubagentLane} reads and says. */
export type SubagentLane = ReturnType<typeof useSubagentLane>

/**
 * A sub-agent's view under its header, beside its Thread or over it: its
 * lane, read only, drawn as a Thread is, by the Thread's own transcript
 * and entries, its brief the bubble its parent wrote, and its status bar
 * in the composer's place, which asks the Thread's Agent about it
 * (decision 25), then does `onAsk`. One of its own sub-agents opens as
 * `onSub` says, a level deeper; `opens` says how, for its rows' words.
 */
export function SubagentBody({
  lane,
  engine,
  project,
  thread: threadId,
  sub,
  run,
  runs,
  device,
  file,
  open,
  opens,
  onSub,
  onAsk,
}: {
  lane: SubagentLane
  engine: Engine
  project: ProjectId
  thread: ThreadId
  sub: SubagentId
  run: PaneProps<unknown>["run"]
  runs: PaneProps<unknown>["runs"]
  device: PaneProps<unknown>["device"]
  file: PaneProps<unknown>["file"]
  open: PaneProps<unknown>["open"]
  opens?: Opens
  onSub: (child: SubagentId) => void
  onAsk: () => void
}) {
  const { drawn, own, name, short, emblem, said, refusal } = lane
  const reader = useImageReader(engine, project)
  // Ask Claude about it: its Thread's composer, a message started about it
  // with its chip (ADR 0103, decision 25).
  const ask = () => {
    if (!said) return
    askAbout(project, threadId, said.head.label)
    onAsk()
  }

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
    openSubagent: onSub,
  }
  const files = useThreadFiles(engine, project, drawn?.items, {
    run,
    device,
    file,
  })
  const links = useMemo(
    () => linksOf({ run, runs }, project),
    [run, runs, project]
  )
  const prompt = own?.prompt
  const { words, look } = said?.asked ?? {}
  const brief = useMemo(
    () =>
      prompt && words ? (
        <Brief
          asker={{ words, harness: emblem, ...(look && { look }) }}
          text={prompt}
        />
      ) : null,
    [prompt, words, look, emblem]
  )
  // Over what its parent wrote to it after the brief.
  const { words: wroteWords, look: wroteLook } = said?.wrote ?? {}
  const wrote = useMemo(
    () =>
      wroteWords === undefined
        ? undefined
        : {
            words: wroteWords,
            harness: emblem,
            ...(wroteLook && { look: wroteLook }),
          },
    [wroteWords, wroteLook, emblem]
  )

  return (
    <>
      <div className="relative min-h-0 flex-1">
        {refusal !== undefined ? (
          <Centered>
            <p className="text-ui text-muted-foreground">{refusal}</p>
          </Centered>
        ) : !drawn || !said ? (
          <Centered>
            <Spinner />
          </Centered>
        ) : (
          <ThreadMedia engine={engine} project={project}>
            <MarkdownLinks open={links.open} hint={links.title}>
              <MarkdownFiles key={sub} host={files}>
                <ThreadAroundProvider
                  engine={engine}
                  project={project}
                  thread={threadId}
                  reader={reader}
                  acts={acts}
                  opens={opens}
                >
                  <Transcript
                    // Each level scrolls on its own.
                    key={sub}
                    state={drawn}
                    name={name}
                    // Its own sub-agents' rows say it set them to work.
                    short={said.head.label}
                    lane={{ id: sub, brief, wrote }}
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
        {said && (
          <StatusBar
            status={said.status}
            ask={{ words: askWords(short), onAsk: ask }}
          />
        )}
      </div>
    </>
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
 * text box: its satellite, its state's word, and the rest; at its end, in
 * every state, the button that asks the Thread's Agent about it (decision
 * 25), or, where the bar is narrow, on a second line under its words, as
 * on a phone. Nothing in it ticks (decision 20). */
function StatusBar({
  status,
  ask,
}: {
  status: Status
  ask: { words: string; onAsk: () => void }
}) {
  return (
    <div className="@container/status">
      <div
        data-slot="subagent-status"
        data-look={status.look}
        aria-label={statusWords(status)}
        className="flex min-h-12 items-center gap-2.5 rounded-card border bg-block py-2 pr-2 pl-3.5 text-ui whitespace-nowrap text-muted-foreground @max-[26rem]/status:flex-wrap @max-[26rem]/status:gap-y-2"
      >
        <Satellite state={status.look} size={12} />
        {/* Narrow, its words take the first line whole, past the satellite. */}
        <p
          className={cn(
            "flex min-w-0 flex-1 items-center gap-1.5 @max-[26rem]/status:basis-[calc(100%-1.375rem)]",
            FADES
          )}
        >
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
        <Button
          variant="outline"
          size="sm"
          // Under its words, on a second line.
          className="shrink-0 @max-[26rem]/status:ml-5.5"
          onClick={ask.onAsk}
        >
          <AtSignIcon aria-hidden />
          {ask.words}
        </Button>
      </div>
    </div>
  )
}
