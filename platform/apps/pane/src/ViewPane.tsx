/**
 * The Pane `apps.view`: an App's screen (ADR 0062, decision 7). It asks
 * the App's view for its Tree, draws it, and reads it again whenever the
 * App says something happened. A control sends one of the App's own
 * commands as the Person, and stays busy until the screen shows what the
 * command did. One kind for every App: an App an Agent wrote brings no
 * code to the window.
 */
import { type JsonValue, newId } from "@banda/contract"
import type { Tree } from "@banda/contract/apps"
import { Button } from "@banda/ui/components/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@banda/ui/components/empty"
import { READ_AGAIN, type Source, useLive } from "@banda/ui/hooks/use-live"
import { definePane, type PaneProps } from "@banda/ui/pane"
import { AppWindowIcon, ChevronLeftIcon } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Opening, type Opens } from "./nav"
import { type Send, TreeView } from "./TreeView"

export type ViewArgs = {
  /** The App's id: `clients`. */
  app: string
  /** Its view's name, without the App's prefix: `home`. */
  view: string
  /** What the view takes, as its `params` say; none when left out. */
  args?: { [key: string]: JsonValue }
}

/** How long a control waits for the screen to show what its command did,
 * in ms: past it the control is let go, and the screen follows. */
const SHOWN_WITHIN = 5000

/** An App's id as a name, until its screen says its title: `client-notes`
 * as "Client notes". */
export function nameOf(app: string): string {
  const words = app.replace(/[-_]+/g, " ")
  return words.slice(0, 1).toUpperCase() + words.slice(1)
}

export const viewPane = definePane<ViewArgs>({
  kind: "apps.view",
  name: "App",
  title: (args) => nameOf(args.app),
  icon: AppWindowIcon,
  // It reaches its App through the engine alone, so it opens for a
  // Project of another machine too, on that machine's engine.
  elsewhere: true,
  Pane: ViewPane,
})

/** One of the App's screens: its view, and what the view takes. */
type Screen = { view: string; given: string }

/** How many screens deep the way back goes: past it the oldest but the
 * first is let go. */
const DEEP = 12

function ViewPane(props: PaneProps<ViewArgs>) {
  const { app, view } = props.args
  // By what it says, not by the object the window hands over each time.
  const given = JSON.stringify(props.args.args ?? {})
  // Another App or view asked of this Pane starts its way anew.
  return <Screens key={`${app}.${view}.${given}`} {...props} given={given} />
}

/**
 * The screens the Person came through, the one the Pane was opened with
 * first and the one shown last. A control of a screen opens another over
 * it, and each stays as it was left, its tab, its found rows and its
 * place, for the way back. Kept while the Pane lives: the Pane is still
 * the one opened with its first screen, to the menu and to an Agent.
 */
function Screens({
  engine,
  project,
  args,
  label,
  given,
}: PaneProps<ViewArgs> & { given: string }) {
  const { app } = args
  const [opened, setOpened] = useState<readonly Screen[]>([])
  const screens = useMemo(
    () => [{ view: args.view, given }, ...opened],
    [args.view, given, opened]
  )
  /** What each says of itself, for the way back and the Pane's header. */
  const [titles, setTitles] = useState<readonly (string | undefined)[]>([])
  const top = screens.length - 1
  const title = titles[top]
  useEffect(() => {
    label?.(title === undefined ? null : { title, detail: null })
  }, [label, title])

  return screens.map((screen, depth) => (
    <ScreenView
      // The one at this depth, while it is the same screen.
      key={`${depth}.${screen.view}.${screen.given}`}
      engine={engine}
      project={project}
      app={app}
      screen={screen}
      shown={depth === top}
      before={depth > 0 ? (titles[depth - 1] ?? nameOf(app)) : undefined}
      back={() => setOpened((opened) => opened.slice(0, depth - 1))}
      says={(title) =>
        setTitles((titles) => {
          if (titles[depth] === title) return titles
          const next = [...titles]
          next[depth] = title
          return next
        })
      }
      opens={(to, params) => {
        const asked = { view: to, given: JSON.stringify(params) }
        setOpened((opened) => {
          // From this screen: what was opened over it goes.
          const under = [screens[0]!, ...opened].slice(0, depth + 1)
          // One come through already is gone back to, not opened again.
          const at = under.findIndex(
            (one) => one.view === asked.view && one.given === asked.given
          )
          if (at >= 0) return under.slice(1, at + 1)
          return [...under.slice(1), asked].slice(-DEEP)
        })
      }}
    />
  ))
}

function ScreenView({
  engine,
  project,
  app,
  screen,
  shown: top,
  before,
  back,
  says,
  opens,
}: Pick<PaneProps<ViewArgs>, "engine" | "project"> & {
  app: string
  screen: Screen
  /** Whether it is the one shown: the others wait under it. */
  shown: boolean
  /** The title of the screen before it: none for the first. */
  before: string | undefined
  back: () => void
  says: (title: string | undefined) => void
  opens: Opens
}) {
  const { view, given } = screen
  const [round, setRound] = useState(0)
  const source = useMemo<Source<Tree>>(
    () => ({
      // An App's methods are not in the window's own table: it came to
      // the engine after the window was built.
      read: () =>
        engine.call(`${app}.${view}` as never, JSON.parse(given) as never, {
          project,
        }) as Promise<Tree>,
      // Whatever the App says happened, its screen is read again.
      filter: { module: app },
      apply: () => READ_AGAIN,
    }),
    [engine, project, app, view, given]
  )
  const live = useLive(engine, project, source, round)
  const tree = live.state === "ready" ? live.view : undefined

  // What it says of itself: its title, or that it did not open.
  const title =
    tree?.title ?? (live.state === "refused" ? nameOf(app) : undefined)
  const saying = useRef(says)
  useEffect(() => {
    saying.current = says
  })
  useEffect(() => saying.current(title), [title])
  const opening = useRef(opens)
  useEffect(() => {
    opening.current = opens
  })
  // One function for as long as the screen lives: the Tree under it is
  // not drawn again for it.
  const open = useCallback<Opens>(
    (view, params) => opening.current(view, params),
    []
  )

  // The log's place the screen shows, and the controls that wait for it
  // to reach theirs. A screen that does not read lets them all go.
  const shown = useRef(0)
  const waiting = useRef<{ at: number; done: () => void }[]>([])
  /** Those that wait for the screen read again, whatever its place. */
  const reading = useRef<(() => void)[]>([])
  useEffect(() => {
    if (live.state === "loading") return
    const at = live.state === "ready" ? live.view.at : Infinity
    shown.current = at
    for (const one of waiting.current) if (one.at <= at) one.done()
    waiting.current = waiting.current.filter((one) => one.at > at)
    for (const done of reading.current.splice(0)) done()
  }, [live])

  const send = useCallback<Send>(
    async (command, params) => {
      const { at } = await engine.commandAt(
        `${app}.${command}` as never,
        params as never,
        project,
        newId(),
        { once: true }
      )
      if (at === null) {
        // It said nothing on the log, so nothing tells the screen: read
        // again, and the control is done once that shows.
        await new Promise<void>((done) => {
          reading.current.push(done)
          setTimeout(done, SHOWN_WITHIN)
          setRound((round) => round + 1)
        })
        return
      }
      // What it said on the log is the App's own event, which reads the
      // screen again: the control waits until that shows.
      if (at <= shown.current) return
      await new Promise<void>((done) => {
        waiting.current.push({ at, done })
        setTimeout(done, SHOWN_WITHIN)
      })
    },
    [engine, project, app]
  )

  return (
    <div hidden={!top} className="h-full min-h-0 overflow-y-auto">
      {before !== undefined && (
        <div className="px-4 pt-3">
          <Button type="button" variant="ghost" size="xs" onClick={back}>
            <ChevronLeftIcon />
            {before}
          </Button>
        </div>
      )}
      {live.state === "refused" ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{nameOf(app)} did not open</EmptyTitle>
            <EmptyDescription>{live.refusal.message}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        tree && (
          <Opening value={open}>
            <TreeView tree={tree} send={send} />
          </Opening>
        )
      )}
    </div>
  )
}
