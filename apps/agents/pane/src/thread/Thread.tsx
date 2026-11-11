/**
 * A Thread: its transcript, what docks on its message box, and the box
 * (ADR 0058, ADR 0091 decision 5). The Pane only holds it.
 */
import { MarkdownFiles } from "@banda/ui/components/markdown-file"
import {
  ContextMenu,
  ContextMenuTrigger,
} from "@banda/ui/components/context-menu"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ProjectId } from "@banda/contract"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@banda/ui/components/empty"
import { Emblem, emblemOf, type EmblemOf } from "@banda/ui/components/emblem"
import { harnessTitle, useAccounts, useHarnesses } from "../harnesses"
import { Spinner } from "@banda/ui/components/spinner"
import { ZoomBadge } from "@banda/ui/components/zoom-badge"
import { useZoom, zoomHandlers } from "@banda/ui/hooks/use-zoom"
import { useScope } from "@banda/ui/hooks/use-scope"
import { THREAD } from "../scopes"
import { carries, droppedPaths } from "@banda/ui/lib/file-drag"
import { copyAsMarkdown } from "@banda/ui/lib/markdown-copy"
import { fromFolder } from "@banda/ui/lib/paths"
import type { Chip } from "@banda/ui/module"
import { paneOf, type PaneProps } from "@banda/ui/pane"
import { BotIcon } from "lucide-react"
import { threadPaneOf } from "../list/rows"
import { suggested } from "../composer/slash"
import { type Comment, isComment } from "../composer/comments"
import { Composer, type ComposerHandle } from "../composer/Composer"
import { QuoteSelection } from "./Quote"
import { type MenuAt, menuAt, ThreadMenu } from "./ThreadMenu"
import { useThreadFiles } from "./ThreadFiles"
import { type AnswerKeys, pressOf, QuestionDrawer } from "../asking/Questions"
import { aboutOf, keyAnswer } from "../asking/asking"
import { drafted } from "../composer/drafts"
import { ThreadDetails, useWide } from "./Details"
import { PlanReady } from "../entries/parts/ProposedPlan"
import { planTitle } from "../entries/parts/messageText"
import { FindBar, useFound } from "./Find"
import { visualPane } from "../visual/VisualPane"
import { ModelPicker } from "../composer/ModelPicker"
import { movesOf, stepped } from "./moves"
import { useLimitsNow } from "./starts-on"
import { pickedOf } from "../composer/picker"
import { ModeMenu } from "../settings/ThreadSettings"
import { SignIn, Warning } from "./SignIn"
import { LaterLine, useSeeWoke } from "./Later"
import { SupervisedLine, useHeardSupervised } from "./Supervised"
import { FENCE_LINK } from "../settings/fence"
import {
  holdsWhole,
  seenNamed,
  useFence,
  useMachine,
  useSeenNamed,
  useStatus,
} from "@banda/ui/hooks/use-status"
import { heldWords, useShownOf } from "@banda/core/react"
import { movedArgs, NewThreadBar } from "../composer/NewThread"
import { type ThreadArgs, useThreadSession, zoomKey } from "./session"
import { threadPane } from "../ThreadPane"
import { Transcript } from "./Transcript"
import { WaitsAlone, WaitsFor } from "./WhenBack"
import { useWriters } from "./writers"
import { ThreadAroundProvider, type ThreadActs } from "./context"
/** Opens a web link in Banda's browser, or outside it (ADR 0051): always
 * outside where no window runs the browser for it (`run` none). */
export function linkOpener(
  run: PaneProps<ThreadArgs>["run"],
  project: ProjectId
) {
  return (address: string, outside: boolean) => {
    if (outside || !run) window.open(address, "_blank", "noopener,noreferrer")
    else run("browser.open", { address, project })
  }
}

export function Thread(props: PaneProps<ThreadArgs>) {
  const {
    engine,
    project,
    args,
    focused,
    open,
    update,
    run,
    composer: says,
  } = props
  const machine = useMachine(engine)
  const accounts = useAccounts(engine)
  const harnesses = useHarnesses(engine)
  const { limits, now } = useLimitsNow(engine)
  const unplaced = project === machine
  const fence = useFence(engine)
  // Another host's (ADR 0081): what would reach this machine's files, or
  // ask its Person there, stays off.
  const { thread, host } = args
  const here = host === undefined
  // That machine, by the name it says it has. While the window cannot
  // reach it, Send waits, and says why as its pill does (ADR 0095,
  // decision 7).
  const on = useSeenNamed(host)?.name
  const shown = useShownOf(host)
  const { state: status } = useStatus(engine)
  const held =
    host === undefined ? undefined : heldWords(host, shown, status, seenNamed)
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
    startsOut,
    startOn,
    plan,
    setPlan,
    draft,
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
    retryOn,
    moveTo,
    fork,
    rewind,
    queue,
    editLast,
    looking,
    acted,
    unsent,
    whenBack,
    waitsHere,
    whenBackActions,
  } = useThreadSession(props)
  const picked = useMemo(() => pickedOf(offer.options), [offer.options])
  // Where a started Thread may move, and whether a move to another
  // Harness asks first: until its first handoff (ADR 0078, decision 5).
  const moves = useMemo(() => {
    if (thread === null || !state || !harness) return undefined
    const ran = state.turns.flatMap((turn) =>
      turn.harness ? [turn.harness] : []
    )
    const confirm = !state.items.some(
      (item) => item.body.kind === "moved" && item.body.how.kind !== "same"
    )
    const of = harnesses.find((one) => one.id === harness)?.harness ?? harness
    const title = harnessTitle(accounts, of)
    return { ...movesOf(harnesses, harness, ran, limits, now), confirm, title }
  }, [thread, state, harness, harnesses, accounts, limits, now])
  // Learn more, wherever the fence is spoken of: Settings → General, at
  // the Fence row (ADR 0083).
  const learn = () => run?.("settings.open", { link: FENCE_LINK })
  useHeardSupervised(thread, machine, state?.supervised, run)
  const [dropping, setDropping] = useState(false)
  // What the Person looks for in the Thread, while the find bar is open.
  const [find, setFind] = useState<{ query: string; at: number }>()
  const area = useRef<HTMLDivElement>(null)
  // What a right click found, for the Thread's menu (ADR 0063, decision 3).
  const [menu, setMenu] = useState<MenuAt | null>(null)
  // Where the paths in its replies lead (ADR 0063, decision 2).
  const files = useThreadFiles(here ? project : null, state?.items, run)
  const root = useRef<HTMLDivElement>(null)
  const composer = useRef<ComposerHandle>(null)
  // The Banda menu's words that did not go wait in the composer.
  useEffect(() => {
    if (unsent) composer.current?.putBack(unsent.text, [])
  }, [unsent])
  const findField = useRef<HTMLInputElement>(null)
  const dock = useRef<HTMLDivElement>(null)
  // Esc and Enter answer the Question that waits, from anywhere in the
  // Pane that leaves them free (ADR 0058, decision 6).
  const answerKeys = useRef<AnswerKeys>(null)
  // Whether the composer held a message as a key went down: by the time
  // the key reaches the Pane, Enter may have sent it.
  const written = useRef(false)
  const writers = useWriters(engine, project, thread)
  // A Thread that woke by itself is seen as its Person looks at it.
  useSeeWoke(engine, project, thread, writers.own?.later, looking)
  const found = useFound(area, find?.query ?? "", find?.at ?? 0, state)
  // The details card: kept open on a wide Thread until hidden, popped
  // open for a moment on a narrow one.
  const wide = useWide(root)
  const [popped, setPopped] = useState(false)
  // Ctrl or ⌘ with + − 0 sizes its words, kept till the window starts
  // again (ADR 0063, decision 5).
  const zoom = useZoom(zoomKey(thread))
  // Files an App attaches, and Files' rows dropped here, are named in the
  // message as `@` names one: from the Project's folder when inside it
  // (ADR 0073, decision 14).
  // A comment on lines waits above the text, its path named the same way
  // (ADR 0034, decision 9).
  const take = useCallback(
    async (chips: readonly Chip[]) => {
      const projects = await engine.call("projects.list", {}).catch(() => [])
      const folder = projects.find((one) => one.id === project)?.folder
      const commented: Comment[] = []
      for (const chip of chips) {
        const path = fromFolder(chip.path, folder)
        if (!isComment(chip)) composer.current?.point(path)
        else commented.push({ ...chip, path, id: crypto.randomUUID() })
      }
      if (commented.length > 0) composer.current?.comment(commented)
    },
    [engine, project]
  )
  const point = useCallback(
    (paths: readonly string[]) => take(paths.map((path) => ({ path }))),
    [take]
  )
  useEffect(() => {
    says?.((chips) => void take(chips))
    return () => says?.(null)
  }, [says, take])
  const detailsShown = wide ? args.details !== false : popped
  const setDetailsShown = wide
    ? (shown: boolean) =>
        update({ ...args, details: shown ? undefined : false })
    : setPopped
  // What the key last asked for: a wide Thread's card is in its args, which
  // come back from the engine a moment later, and a second press before
  // then would read the old value and hide the card again.
  const detailsWanted = useRef(detailsShown)
  useEffect(() => {
    detailsWanted.current = detailsShown
  }, [detailsShown])
  // The part of its rows an App asked the card to open, as git's Switch
  // branch its picker, till that part is drawn and opened; hidden, the
  // card forgets it.
  const [opening, setOpening] = useState<string | null>(null)
  const [wasShown, setWasShown] = useState(detailsShown)
  if (wasShown !== detailsShown) {
    setWasShown(detailsShown)
    if (!detailsShown) setOpening(null)
  }
  // Its keys (ADR 0071, decision 1): its zoom, which sizes its words, its
  // details, and Ctrl+F (⌘F) to find in it, as in T3 Code.
  const scope = useScope(
    THREAD,
    {
      ...zoomHandlers("agents.thread", zoom.by),
      "agents.thread.details": (args) => {
        const part = typeof args?.part === "string" ? args.part : null
        if (part === null) detailsWanted.current = !detailsWanted.current
        // A part to open shows the card, where this Thread draws one.
        else if (unplaced) return false
        else {
          detailsWanted.current = true
          setOpening(part)
        }
        setDetailsShown(detailsWanted.current)
        return true
      },
      // Ctrl+Shift+↑ and ↓: the previous or next account of its Harness
      // that is not out (ADR 0078, decision 11).
      "agents.thread.account-previous": () => {
        const to = moves && stepped(moves.same, -1)
        if (to) moveTo(to.harness.id)
        return !!to
      },
      "agents.thread.account-next": () => {
        const to = moves && stepped(moves.same, 1)
        if (to) moveTo(to.harness.id)
        return !!to
      },
      "agents.thread.find": () => {
        setFind((now) => now ?? { query: "", at: 0 })
        findField.current?.select()
        return true
      },
    },
    { tile: true }
  )
  useEffect(() => scope(root.current), [scope])

  // What the Thread's parts ask, and the Pane does (ADR 0091, decision 4).
  const acts: ThreadActs = {
    openDiff,
    openVisual: (visual) => open(paneOf(visualPane, visual), "group"),
    openThread: (other) => open(threadPaneOf(other), "right"),
    fork,
    rewind: (turn, message) =>
      void rewind(turn).then((back) => {
        if (back && message.body.kind === "message")
          composer.current?.putBack(message.body.text, message.body.images)
      }),
    retry,
    retryOn,
    putOff:
      run &&
      ((until, resume) =>
        run("thread.later", { project, item: thread, until, resume })),
    accounts: run && (() => run("settings.open", { link: "agents" })),
    signIn: (turn) => (
      <SignIn
        engine={engine}
        project={project}
        harness={harness}
        turn={turn.id}
        open={open}
        elsewhere={on === undefined ? undefined : { on, name: short }}
        onSignedIn={() => retry(turn)}
      />
    ),
    // Through the router, to this device's browser (ADR 0106, law 2).
    openLink: (url) => run?.("link.open", { url }),
  }

  return (
    // Files dropped anywhere on the Pane join the message.
    <div
      ref={root}
      className="@container/thread flex h-full min-h-0 flex-col"
      style={{ "--thread-zoom": zoom.zoom } as React.CSSProperties}
      onPointerDownCapture={(event) => acted(event.nativeEvent)}
      onKeyDownCapture={(event) => {
        acted(event.nativeEvent)
        written.current = thread !== null && drafted(thread)
      }}
      onKeyDown={(event) => {
        const press =
          asking && thread !== null
            ? pressOf(event, root.current, dock.current, written.current)
            : undefined
        const answer = press && keyAnswer(press)
        if (answer && answerKeys.current?.(answer)) {
          // Its own: not the workspace drawer's Esc, nor the composer's.
          event.preventDefault()
          event.stopPropagation()
        }
      }}
      onDragOver={(event) => {
        const data = event.dataTransfer
        if (!data.types.includes("Files") && !carries(data)) return
        event.preventDefault()
        setDropping(true)
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setDropping(false)
      }}
      // Files' rows are named, before the composer's text takes them as
      // text; files from another app are kept, as below. Another host's
      // Thread takes no path of this machine's.
      onDropCapture={(event) => {
        const paths = droppedPaths(event.dataTransfer)
        if (!paths) return
        event.preventDefault()
        event.stopPropagation()
        setDropping(false)
        if (here) void point(paths)
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
              opening={opening}
              opened={() => setOpening(null)}
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
            <Start
              harness={harness}
              name={name}
              on={on}
              harnesses={harnesses}
              // Full access never asks; a No Space draft's mode is the
              // engine's, which is Full access where the fence holds
              // whole (ADR 0083).
              asks={
                settings?.mode !== "full_access" &&
                !(unplaced && holdsWhole(fence))
              }
            />
          ) : live.state !== "ready" && waitsHere.length > 0 && on ? (
            // What waits for its machine shows before the Thread can (ADR
            // 0105).
            <WaitsAlone
              why={live.state === "refused" ? live.refusal.message : undefined}
            >
              <WaitsFor
                waits={waitsHere}
                machine={on}
                reader={reader}
                {...whenBackActions}
              />
            </WaitsAlone>
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
              <ThreadAroundProvider
                engine={engine}
                project={project}
                thread={thread}
                host={host}
                reader={reader}
                acts={acts}
              >
                <Transcript
                  // Each Thread scrolls on its own, from where it was left.
                  key={thread}
                  forYou={Boolean(asking || planned)}
                  finding={find?.query ?? ""}
                  state={live.view}
                  waits={waits}
                  name={name}
                  short={short}
                  answering={acting}
                  writers={writers}
                  queue={queue}
                  moves={moves}
                  whenBack={
                    waitsHere.length > 0 &&
                    on && (
                      <WaitsFor
                        waits={waitsHere}
                        machine={on}
                        reader={reader}
                        {...whenBackActions}
                      />
                    )
                  }
                />
              </ThreadAroundProvider>
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
            search:
              here && run
                ? (words) => run("browser.open", { words, project })
                : undefined,
            open: linkOpener(here ? run : undefined, project),
            copyImage: run && ((x, y) => run("edit.copy-image", { x, y })),
            file: files ?? undefined,
            attach: (path) => run?.("file.attach", { file: path }),
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
        {thread && run && (
          <LaterLine
            engine={engine}
            project={project}
            thread={thread}
            later={writers.own?.later}
            turns={state?.turns ?? []}
            onWake={() => run("thread.wake", { project, item: thread })}
          />
        )}
        {thread && state && (
          <SupervisedLine
            thread={thread}
            mode={settings?.mode}
            turns={state.turns}
            onLearn={learn}
          />
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
          machine={on}
          held={whenBack === undefined ? held : undefined}
          whenBack={whenBack}
          thread={draft}
          history={history}
          placeholder={
            asking
              ? asking.body.sub === undefined
                ? `Answer above, or write to say no and tell ${name} what to do instead`
                : `Answer above, or write to ${name}`
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
                  fence={{ fence, onLearn: learn }}
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
                out={startsOut}
                onStart={startOn}
                harnesses={harnesses}
                moves={moves}
                onMove={(move) => moveTo(move.harness.id)}
              />
            </>
          )}
        </Composer>
        {/* A new Thread's Project, bare under the card, and the machine it
          starts on: another machine's opens it there, on its engine (ADR
          0095, decision 7). Its Harness is chosen with the model. A Project
          is added on this machine only. */}
        {thread === null && (
          <NewThreadBar
            engine={engine}
            project={project}
            host={host}
            disabled={sending}
            onProject={(other, same) =>
              open(
                paneOf(threadPane, movedArgs(args, harness, same)),
                "instead",
                other
              )
            }
            onAddProject={here && run ? () => run("project.add") : undefined}
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

/** A Thread not yet started: whom it writes to, by its account's emblem,
 * and on which machine when it is another's (ADR 0095, decision 7), and
 * one quiet line (ADR 0058), where its mode asks at all. */
function Start({
  harness,
  name,
  on,
  asks,
  harnesses,
}: {
  harness: string
  name: string
  /** The other machine it writes to, by its name. */
  on?: string
  asks: boolean
  harnesses: readonly EmblemOf[]
}) {
  return (
    <Empty className="h-full">
      <EmptyHeader className="gap-1">
        <EmptyMedia className="mb-2">
          {harness ? (
            <Emblem
              of={emblemOf(harnesses, harness, name)}
              className="size-6"
            />
          ) : (
            <BotIcon className="size-6 text-muted-foreground" />
          )}
        </EmptyMedia>
        <EmptyTitle>
          Write to {name}
          {on !== undefined && ` on ${on}`}
        </EmptyTitle>
        {asks && (
          <EmptyDescription>
            It asks you before anything that needs your yes.
          </EmptyDescription>
        )}
      </EmptyHeader>
    </Empty>
  )
}
