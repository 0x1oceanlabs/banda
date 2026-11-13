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
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@banda/ui/components/empty"
import { READ_AGAIN, type Source, useLive } from "@banda/ui/hooks/use-live"
import { definePane, type PaneProps } from "@banda/ui/pane"
import { AppWindowIcon } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
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

function ViewPane({ engine, project, args, label }: PaneProps<ViewArgs>) {
  const { app, view } = args
  // By what it says, not by the object the window hands over each time.
  const given = JSON.stringify(args.args ?? {})
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

  const title = tree?.title
  useEffect(() => {
    if (title !== undefined) label?.({ title, detail: null })
  }, [label, title])

  // The log's place the screen shows, and the controls that wait for it
  // to reach theirs. A screen that does not read lets them all go.
  const shown = useRef(0)
  const waiting = useRef<{ at: number; done: () => void }[]>([])
  useEffect(() => {
    if (live.state === "loading") return
    const at = live.state === "ready" ? live.view.at : Infinity
    shown.current = at
    for (const one of waiting.current) if (one.at <= at) one.done()
    waiting.current = waiting.current.filter((one) => one.at > at)
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
        // again, and the control is done.
        setRound((round) => round + 1)
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

  if (live.state === "refused")
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{nameOf(app)} did not open</EmptyTitle>
          <EmptyDescription>{live.refusal.message}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  if (!tree) return null
  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <TreeView tree={tree} send={send} />
    </div>
  )
}
